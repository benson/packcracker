#!/usr/bin/env node

/**
 * Cache card data from Scryfall for all sets.
 * Run this script periodically via GitHub Actions to keep prices fresh.
 */

const fs = require('fs');
const path = require('path');

const SCRYFALL_API = 'https://api.scryfall.com';
const SET_CONFIGS_URL = 'https://bensonperry.com/shared/set-configs.json';
const MIN_PRICE = 1; // Cache cards worth $1+
const RATE_LIMIT_MS = 100; // Scryfall asks for 50-100ms between requests

// Jumpstart sets have their own booster type (no play/collector distinction)
const JUMPSTART_SETS = new Set(['jmp', 'j22', 'j25']);

// Collector exclusives - fetched from shared config at runtime
// Source of truth: https://bensonperry.com/shared/collector-exclusives.json
let COLLECTOR_EXCLUSIVE_PROMOS = [];
let COLLECTOR_EXCLUSIVE_FRAMES = [];

// Set configs loaded from shared config (per-set CN ranges)
let setConfigs = {};

async function loadCollectorExclusives() {
  try {
    const response = await fetch('https://bensonperry.com/shared/collector-exclusives.json');
    const data = await response.json();
    COLLECTOR_EXCLUSIVE_PROMOS = data.promos;
    COLLECTOR_EXCLUSIVE_FRAMES = data.frames;
    console.log('Loaded collector exclusives from shared config');
  } catch (error) {
    // Fallback to hardcoded values if fetch fails
    console.warn('Failed to fetch collector exclusives, using fallback values');
    COLLECTOR_EXCLUSIVE_PROMOS = [
      'fracturefoil', 'texturedfoil', 'ripplefoil',
      'halofoil', 'confettifoil', 'galaxyfoil', 'surgefoil',
      'raisedfoil', 'headliner'
    ];
    COLLECTOR_EXCLUSIVE_FRAMES = ['inverted', 'extendedart'];
  }
}

// Load set configs for accurate play booster filtering
async function loadSetConfigs() {
  // Try local file first (for development), then remote
  const localPath = path.join(__dirname, '..', '..', 'homepage', 'shared', 'set-configs.json');
  try {
    if (fs.existsSync(localPath)) {
      setConfigs = JSON.parse(fs.readFileSync(localPath, 'utf8'));
      console.log(`Loaded set configs from local file for ${Object.keys(setConfigs).filter(k => k !== '_comment').length} sets`);
      return;
    }
  } catch (e) {
    // Fall through to remote
  }

  try {
    const response = await fetch(SET_CONFIGS_URL);
    setConfigs = await response.json();
    console.log(`Loaded set configs from remote for ${Object.keys(setConfigs).filter(k => k !== '_comment').length} sets`);
  } catch (e) {
    console.log('Warning: Could not load set configs, using default rules');
    setConfigs = {};
  }
}

// Check if collector number is in a range like "262-281" or "342"
function isInRange(cn, rangeStr) {
  const cnNum = parseInt(cn, 10);
  if (isNaN(cnNum)) return false;
  if (rangeStr.includes('-')) {
    const [start, end] = rangeStr.split('-').map(n => parseInt(n, 10));
    return cnNum >= start && cnNum <= end;
  }
  return cnNum === parseInt(rangeStr, 10);
}

// Check if card is in play booster based on set config
function isInPlayBoosterByConfig(card, setCode) {
  const config = setConfigs[setCode];
  if (!config?.playBooster?.includeCollectorNumbers) return null;
  const cn = card.collector_number;
  return config.playBooster.includeCollectorNumbers.some(range => isInRange(cn, range));
}

// Check if card is collector-exclusive based on set config
function isCollectorExclusiveByConfig(card, setCode) {
  const config = setConfigs[setCode];
  if (!config?.collectorExclusive?.collectorNumbers) return null;
  const cn = card.collector_number;
  return config.collectorExclusive.collectorNumbers.some(range => isInRange(cn, range));
}

// Check if card is collector-exclusive using generic rules
function isCollectorExclusive(card) {
  const promos = card.promo_types || [];
  const frames = card.frame_effects || [];
  return promos.some(p => COLLECTOR_EXCLUSIVE_PROMOS.includes(p)) ||
         frames.some(f => COLLECTOR_EXCLUSIVE_FRAMES.includes(f));
}

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function fetchWithRetry(url, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url);
      if (response.status === 429) {
        console.log('  Rate limited, waiting 2s...');
        await delay(2000);
        continue;
      }
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      if (i === retries - 1) throw error;
      await delay(500 * (i + 1));
    }
  }
}

async function fetchSetCards(setCode, boosterType) {
  const hasSetConfig = setConfigs[setCode]?.playBooster?.includeCollectorNumbers;

  let query = `set:${setCode} lang:en`;

  // If we have a set config, fetch all cards and filter client-side
  // Otherwise use Scryfall's is:booster filter
  if (!hasSetConfig && boosterType !== 'collector' && !JUMPSTART_SETS.has(setCode)) {
    query += ' is:booster -is:boosterfun';
    COLLECTOR_EXCLUSIVE_PROMOS.forEach(promo => {
      query += ` -promo:${promo}`;
    });
  }

  // Fetch cards worth $0.50+ to have some buffer
  query += ` (usd>=0.5 OR usd_foil>=0.5)`;

  const url = `${SCRYFALL_API}/cards/search?q=${encodeURIComponent(query)}&unique=prints&order=usd&dir=desc`;

  let allCards = [];
  let nextUrl = url;

  try {
    while (nextUrl) {
      await delay(RATE_LIMIT_MS);
      const data = await fetchWithRetry(nextUrl);
      allCards = allCards.concat(data.data || []);
      nextUrl = data.has_more ? data.next_page : null;

      // Limit to first 2 pages (350 cards) to keep files reasonable
      if (allCards.length >= 350) break;
    }
  } catch (error) {
    if (error.message === 'HTTP 404') {
      return []; // No cards match - that's fine
    }
    throw error;
  }

  // If we have a set config, filter for play boosters client-side
  if (hasSetConfig && boosterType !== 'collector') {
    allCards = allCards.filter(card => {
      const inPlayBooster = isInPlayBoosterByConfig(card, setCode);
      if (inPlayBooster === true) return true;
      if (isCollectorExclusiveByConfig(card, setCode) === true) return false;
      // Fall back to Scryfall booster flag and generic rules
      return card.booster && !isCollectorExclusive(card);
    });
  }

  return allCards;
}

function processCard(card) {
  // Extract only the fields we need to minimize file size
  const prices = card.prices || {};
  const finishes = card.finishes || [];

  const result = {
    id: card.id,
    name: card.name,
    set: card.set,
    collector_number: card.collector_number,
    rarity: card.rarity,
    booster: card.booster,
    image: card.image_uris?.normal || card.card_faces?.[0]?.image_uris?.normal || '',
    uri: card.scryfall_uri,
    finishes: [],
    // Treatment detection
    showcase: card.frame_effects?.includes('showcase') || false,
    extendedart: card.frame_effects?.includes('extendedart') || false,
    inverted: card.frame_effects?.includes('inverted') || false,
    borderless: card.border_color === 'borderless',
    fullart: card.full_art || false,
    etched: card.frame_effects?.includes('etched') || false,
    promo: card.promo || false,
    // Store promo_types for client-side filtering (important for new sets)
    promo_types: card.promo_types || [],
  };

  // Add available finishes with prices
  if (finishes.includes('nonfoil') && prices.usd) {
    result.finishes.push({ type: 'nonfoil', price: parseFloat(prices.usd) });
  }
  if (finishes.includes('foil') && prices.usd_foil) {
    result.finishes.push({ type: 'foil', price: parseFloat(prices.usd_foil) });
  }
  if (finishes.includes('etched') && prices.usd_etched) {
    result.finishes.push({ type: 'etched', price: parseFloat(prices.usd_etched) });
  }

  // Only include cards with at least one finish worth $0.50+
  if (result.finishes.some(f => f.price >= 0.5)) {
    return result;
  }
  return null;
}

async function cacheSet(set) {
  console.log(`Caching ${set.code} (${set.name})...`);

  // Fetch both booster types
  const [playCards, collectorCards] = await Promise.all([
    fetchSetCards(set.code, 'play'),
    delay(RATE_LIMIT_MS).then(() => fetchSetCards(set.code, 'collector'))
  ]);

  // Process and dedupe
  const seenIds = new Set();
  const processedPlay = [];
  const processedCollector = [];

  for (const card of playCards) {
    const processed = processCard(card);
    if (processed && !seenIds.has(processed.id)) {
      seenIds.add(processed.id);
      processedPlay.push(processed);
    }
  }

  for (const card of collectorCards) {
    const processed = processCard(card);
    if (processed && !seenIds.has(processed.id)) {
      seenIds.add(processed.id);
      processedCollector.push(processed);
    }
  }

  // Collector includes all play cards plus collector-only cards
  const allCollector = [...processedPlay, ...processedCollector];

  const cacheData = {
    set: set.code,
    name: set.name,
    updated: new Date().toISOString(),
    play: processedPlay,
    collector: allCollector,
  };

  console.log(`  Play: ${processedPlay.length} cards, Collector: ${allCollector.length} cards`);

  return cacheData;
}

async function main() {
  // Load shared configs
  await loadCollectorExclusives();
  await loadSetConfigs();

  const setsPath = path.join(__dirname, '..', 'sets.json');
  const dataDir = path.join(__dirname, '..', 'data');

  // Load sets
  const sets = JSON.parse(fs.readFileSync(setsPath, 'utf8'));
  console.log(`Found ${sets.length} sets to cache\n`);

  // Process sets in batches to avoid overwhelming Scryfall
  const BATCH_SIZE = 5;
  let processed = 0;
  let errors = [];

  for (let i = 0; i < sets.length; i += BATCH_SIZE) {
    const batch = sets.slice(i, i + BATCH_SIZE);

    for (const set of batch) {
      try {
        const cacheData = await cacheSet(set);
        const filePath = path.join(dataDir, `${set.code}.json`);
        fs.writeFileSync(filePath, JSON.stringify(cacheData));
        processed++;
      } catch (error) {
        console.error(`  Error caching ${set.code}: ${error.message}`);
        errors.push({ set: set.code, error: error.message });
      }
    }

    // Longer pause between batches
    if (i + BATCH_SIZE < sets.length) {
      console.log(`\nPausing between batches... (${processed}/${sets.length} done)\n`);
      await delay(1000);
    }
  }

  console.log(`\nDone! Cached ${processed} sets.`);
  if (errors.length > 0) {
    console.log(`Errors: ${errors.length}`);
    errors.forEach(e => console.log(`  - ${e.set}: ${e.error}`));
  }

  // Cache Special Guests (spg) and The Big Score (big) for Play Booster sets
  console.log('\nCaching Special Guests and The Big Score...');
  const specialSets = [
    { code: 'spg', name: 'Special Guests' },
    { code: 'big', name: 'The Big Score' }
  ];

  for (const specialSet of specialSets) {
    try {
      const cacheData = await cacheSet(specialSet);
      const filePath = path.join(dataDir, `${specialSet.code}.json`);
      fs.writeFileSync(filePath, JSON.stringify(cacheData));
    } catch (error) {
      console.error(`  Error caching ${specialSet.code}: ${error.message}`);
    }
  }

  // Write a manifest file with last update time
  const manifest = {
    updated: new Date().toISOString(),
    sets: processed,
    errors: errors.length,
  };
  fs.writeFileSync(path.join(dataDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
}

main().catch(console.error);
