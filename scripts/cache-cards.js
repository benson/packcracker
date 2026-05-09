#!/usr/bin/env node

/**
 * Cache card data from Scryfall for all sets.
 * Run this script periodically via GitHub Actions to keep prices fresh.
 */

const fs = require('fs');
const path = require('path');

const SCRYFALL_API = 'https://api.scryfall.com';
const BOOSTER_DATA_URL = 'https://bensonperry.com/booster-data';
const MIN_PRICE = 1; // Cache cards worth $1+
const RATE_LIMIT_MS = 200; // Scryfall asks for 50-100ms between requests; keep a cushion for Actions.
const DEFAULT_ACTIVE_RELEASE_DAYS = 120;
const DEFAULT_UPCOMING_DAYS = 90;
const DEFAULT_STALE_HOURS = 20;
const DEFAULT_MAX_INCREMENTAL_TARGETS = 25;
const SHARED_SETS_URL = 'https://bensonperry.com/shared/sets.json';
const SHARED_METADATA_URL = 'https://bensonperry.com/shared/metadata.json';
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const SCRYFALL_HEADERS = {
  Accept: 'application/json;q=0.9,*/*;q=0.8',
  'User-Agent': 'packcracker-card-cache/1.0 (https://github.com/benson/packcracker)',
};

// Jumpstart sets have their own booster type (no play/collector distinction)
const JUMPSTART_SETS = new Set(['jmp', 'j22', 'j25']);

// Collector exclusives - fetched from shared config at runtime
// Source of truth: https://bensonperry.com/shared/collector-exclusives.json
let COLLECTOR_EXCLUSIVE_PROMOS = [];
let COLLECTOR_EXCLUSIVE_FRAMES = [];

// Booster data loaded from booster-data project
let boosterIndex = {};
let boosterFileCache = {};
let scryfallSearchCache = new Map();

async function loadCollectorExclusives() {
  const localPath = path.join(__dirname, '..', '..', 'homepage', 'shared', 'collector-exclusives.json');
  try {
    if (fs.existsSync(localPath)) {
      const data = JSON.parse(fs.readFileSync(localPath, 'utf8'));
      COLLECTOR_EXCLUSIVE_PROMOS = data.promos;
      COLLECTOR_EXCLUSIVE_FRAMES = data.frames;
      console.log('Loaded collector exclusives from local shared config');
      return;
    }
  } catch (error) {
    // Fall through to remote
  }

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
      'fracturefoil', 'texturedfoil', 'textured', 'ripplefoil',
      'halofoil', 'confettifoil', 'galaxyfoil', 'surgefoil',
      'raisedfoil', 'serialized', 'manafoil', 'invisibleink', 'neonink',
      'headliner'
    ];
    COLLECTOR_EXCLUSIVE_FRAMES = ['inverted', 'extendedart'];
  }
}

// Load booster data index
async function loadBoosterIndex() {
  // Try local file first (for development), then remote
  const localPath = path.join(__dirname, '..', '..', 'booster-data', 'index.json');
  try {
    if (fs.existsSync(localPath)) {
      boosterIndex = JSON.parse(fs.readFileSync(localPath, 'utf8'));
      console.log(`Loaded booster index from local file for ${Object.keys(boosterIndex.boosters || {}).length} sets`);
      return;
    }
  } catch (e) {
    // Fall through to remote
  }

  try {
    const response = await fetch(BOOSTER_DATA_URL + '/index.json');
    boosterIndex = await response.json();
    console.log(`Loaded booster index from remote for ${Object.keys(boosterIndex.boosters || {}).length} sets`);
  } catch (e) {
    console.log('Warning: Could not load booster index, using default rules');
    boosterIndex = { boosters: {} };
  }
}

// Load a specific booster file
async function loadBoosterFile(setCode, boosterType) {
  const key = `${setCode}-${boosterType}`;
  if (boosterFileCache[key]) return boosterFileCache[key];

  // Try local file first
  const localPath = path.join(__dirname, '..', '..', 'booster-data', 'boosters', `${key}.json`);
  try {
    if (fs.existsSync(localPath)) {
      boosterFileCache[key] = JSON.parse(fs.readFileSync(localPath, 'utf8'));
      return boosterFileCache[key];
    }
  } catch (e) {
    // Fall through to remote
  }

  try {
    const response = await fetch(`${BOOSTER_DATA_URL}/boosters/${key}.json`);
    boosterFileCache[key] = await response.json();
  } catch (e) {
    boosterFileCache[key] = null;
  }
  return boosterFileCache[key];
}

// Get CN ranges from booster file for play boosters
function getPlayBoosterRanges(boosterFile) {
  if (!boosterFile?.slots) return null;
  const ranges = [];
  for (const slot of boosterFile.slots) {
    if (!slot.pool || slot.bonusSet) continue;
    for (const finishRanges of Object.values(slot.pool)) {
      if (Array.isArray(finishRanges)) ranges.push(...finishRanges);
    }
  }
  return [...new Set(ranges)];
}

// Get CN ranges from booster file for collector exclusives
function getCollectorExclusiveRanges(boosterFile) {
  if (!boosterFile?.slots) return null;
  const ranges = [];
  for (const slot of boosterFile.slots) {
    if (slot.name === 'collectorExclusive' && slot.pool) {
      for (const finishRanges of Object.values(slot.pool)) {
        ranges.push(...finishRanges);
      }
    }
  }
  return ranges.length > 0 ? [...new Set(ranges)] : null;
}

// Check if collector number is in a range like "262-281" or "342"
function isInRange(cn, rangeStr) {
  const cnText = String(cn ?? '').trim();
  // Scryfall uses a "z" suffix for serialized variants of existing collector
  // numbers (e.g. MKM 321z). Numeric booster ranges should not match those.
  if (/^\d+z$/i.test(cnText)) return false;

  const cnNum = parseInt(cnText, 10);
  if (isNaN(cnNum)) return false;
  if (rangeStr.includes('-')) {
    const [start, end] = rangeStr.split('-').map(n => parseInt(n, 10));
    return cnNum >= start && cnNum <= end;
  }
  return cnNum === parseInt(rangeStr, 10);
}

// Check if card is in play booster based on booster data
async function isInPlayBoosterByConfig(card, setCode) {
  if (hasCollectorExclusivePromo(card)) return false;

  const types = boosterIndex.boosters?.[setCode];
  if (!types) return null;

  const playType = types.includes('play') ? 'play' : types.includes('draft') ? 'draft' : null;
  if (!playType) return null;

  const boosterFile = await loadBoosterFile(setCode, playType);
  const ranges = getPlayBoosterRanges(boosterFile);
  if (!ranges) return null;

  const cn = card.collector_number;
  return ranges.some(range => isInRange(cn, range));
}

// Check if card is collector-exclusive based on booster data
async function isCollectorExclusiveByConfig(card, setCode) {
  const types = boosterIndex.boosters?.[setCode];
  if (!types || !types.includes('collector')) return null;

  const boosterFile = await loadBoosterFile(setCode, 'collector');
  const ranges = getCollectorExclusiveRanges(boosterFile);
  if (!ranges) return null;

  const cn = card.collector_number;
  return ranges.some(range => isInRange(cn, range));
}

function hasCollectorExclusivePromo(card) {
  const promos = card.promo_types || [];
  return promos.some(p => COLLECTOR_EXCLUSIVE_PROMOS.includes(p));
}

// Check if card is collector-exclusive using generic rules
function isCollectorExclusive(card) {
  const promos = card.promo_types || [];
  const frames = card.frame_effects || [];
  return promos.some(p => COLLECTOR_EXCLUSIVE_PROMOS.includes(p)) ||
         frames.some(f => COLLECTOR_EXCLUSIVE_FRAMES.includes(f));
}

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function getRetryDelayMs(response, attempt) {
  const retryAfter = response.headers?.get('retry-after');
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (!Number.isNaN(seconds)) return seconds * 1000;

    const dateMs = Date.parse(retryAfter);
    if (!Number.isNaN(dateMs)) return Math.max(dateMs - Date.now(), RATE_LIMIT_MS);
  }

  return Math.min(2000 * attempt, 30000);
}

async function fetchWithRetry(url, retries = 6) {
  let lastError = null;

  for (let i = 0; i < retries; i++) {
    const attempt = i + 1;
    try {
      const response = await fetch(url, { headers: SCRYFALL_HEADERS });
      if (response.status === 429) {
        lastError = new Error(`HTTP 429 after ${attempt} attempt(s)`);
        if (attempt >= retries) break;

        const waitMs = getRetryDelayMs(response, attempt);
        console.log(`  Rate limited, waiting ${Math.ceil(waitMs / 1000)}s...`);
        await delay(waitMs);
        continue;
      }
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt >= retries) break;
      await delay(500 * attempt);
    }
  }

  throw lastError || new Error(`Failed to fetch ${url}`);
}

async function fetchScryfallSearch(url) {
  if (scryfallSearchCache.has(url)) {
    return scryfallSearchCache.get(url);
  }

  const fetchPromise = (async () => {
    let allCards = [];
    let nextUrl = url;

    while (nextUrl) {
      await delay(RATE_LIMIT_MS);
      const data = await fetchWithRetry(nextUrl);
      allCards = allCards.concat(data.data || []);
      nextUrl = data.has_more ? data.next_page : null;

      // Limit to first 2 pages (350 cards) to keep files reasonable
      if (allCards.length >= 350) break;
    }

    return allCards;
  })();

  scryfallSearchCache.set(url, fetchPromise);

  try {
    const cards = await fetchPromise;
    scryfallSearchCache.set(url, cards);
    return cards;
  } catch (error) {
    scryfallSearchCache.delete(url);
    throw error;
  }
}

async function fetchSetCards(setCode, boosterType) {
  const hasBoosterData = boosterIndex.boosters?.[setCode];

  let query = `set:${setCode} lang:en`;

  // If we have booster data, fetch all cards and filter client-side
  // Otherwise use Scryfall's is:booster filter
  if (!hasBoosterData && boosterType !== 'collector' && !JUMPSTART_SETS.has(setCode)) {
    query += ' is:booster -is:boosterfun';
    COLLECTOR_EXCLUSIVE_PROMOS.forEach(promo => {
      query += ` -promo:${promo}`;
    });
  }

  // Fetch cards worth $0.50+ to have some buffer
  query += ` (usd>=0.5 OR usd_foil>=0.5)`;

  const url = `${SCRYFALL_API}/cards/search?q=${encodeURIComponent(query)}&unique=prints&order=usd&dir=desc`;

  let allCards = [];

  try {
    allCards = await fetchScryfallSearch(url);
  } catch (error) {
    if (error.message === 'HTTP 404') {
      return []; // No cards match - that's fine
    }
    throw error;
  }

  // If we have booster data, filter for play boosters client-side
  if (hasBoosterData && boosterType !== 'collector') {
    const filteredCards = [];
    for (const card of allCards) {
      const inPlayBooster = await isInPlayBoosterByConfig(card, setCode);
      if (inPlayBooster === true) {
        // Trust booster-data ranges as source of truth
        filteredCards.push(card);
        continue;
      }
      const inCollectorExclusive = await isCollectorExclusiveByConfig(card, setCode);
      if (inCollectorExclusive === true) continue;
      // Fall back to Scryfall booster flag and generic rules
      if (card.booster && !isCollectorExclusive(card)) {
        filteredCards.push(card);
      }
    }
    return filteredCards;
  }

  return allCards;
}

async function fetchAllPricedCards(setCode) {
  const query = `set:${setCode} lang:en (usd>=0.5 OR usd_foil>=0.5)`;
  const url = `${SCRYFALL_API}/cards/search?q=${encodeURIComponent(query)}&unique=prints&order=usd&dir=desc`;

  try {
    return await fetchScryfallSearch(url);
  } catch (error) {
    if (error.message === 'HTTP 404') {
      return [];
    }
    throw error;
  }
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

function buildCacheData(set, playCards, collectorCards) {
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

async function cacheMainSet(set) {
  // Fetch booster types sequentially so the scheduled job stays inside Scryfall's rate limits.
  const playCards = await fetchSetCards(set.code, 'play');
  const collectorCards = await fetchSetCards(set.code, 'collector');
  return buildCacheData(set, playCards, collectorCards);
}

async function cacheAuxiliarySet(set) {
  const cards = await fetchAllPricedCards(set.code);
  return buildCacheData(set, cards, cards);
}

async function cacheTarget(target) {
  console.log(`Caching ${target.code} (${target.name}) [${target.reason}]...`);
  return target.strategy === 'all'
    ? cacheAuxiliarySet(target)
    : cacheMainSet(target);
}

async function loadSets() {
  const res = await fetch(SHARED_SETS_URL);
  if (!res.ok) throw new Error(`Failed to fetch ${SHARED_SETS_URL}: HTTP ${res.status}`);
  return res.json();
}

async function loadMetadata() {
  try {
    const res = await fetch(SHARED_METADATA_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data?.sets || {};
  } catch (error) {
    console.warn(`Warning: could not load shared metadata: ${error.message}`);
    return {};
  }
}

function splitCodes(value) {
  return String(value || '')
    .split(/[,\s]+/)
    .map(code => code.trim().toLowerCase())
    .filter(Boolean);
}

function parseNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseArgs(argv) {
  const options = {
    mode: (process.env.CACHE_MODE || 'incremental').toLowerCase(),
    setCodes: splitCodes(process.env.CACHE_SETS),
    activeReleaseDays: parseNumber(process.env.CACHE_ACTIVE_RELEASE_DAYS, DEFAULT_ACTIVE_RELEASE_DAYS),
    upcomingDays: parseNumber(process.env.CACHE_UPCOMING_DAYS, DEFAULT_UPCOMING_DAYS),
    staleHours: parseNumber(process.env.CACHE_STALE_HOURS, DEFAULT_STALE_HOURS),
    maxTargets: parseNumber(process.env.CACHE_MAX_TARGETS, DEFAULT_MAX_INCREMENTAL_TARGETS),
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--full') {
      options.mode = 'full';
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--mode' && argv[i + 1]) {
      options.mode = argv[++i].toLowerCase();
    } else if (arg.startsWith('--mode=')) {
      options.mode = arg.slice('--mode='.length).toLowerCase();
    } else if ((arg === '--set' || arg === '--sets') && argv[i + 1]) {
      options.setCodes.push(...splitCodes(argv[++i]));
    } else if (arg.startsWith('--set=')) {
      options.setCodes.push(...splitCodes(arg.slice('--set='.length)));
    } else if (arg.startsWith('--sets=')) {
      options.setCodes.push(...splitCodes(arg.slice('--sets='.length)));
    } else if (arg === '--active-release-days' && argv[i + 1]) {
      options.activeReleaseDays = parseNumber(argv[++i], options.activeReleaseDays);
    } else if (arg.startsWith('--active-release-days=')) {
      options.activeReleaseDays = parseNumber(arg.slice('--active-release-days='.length), options.activeReleaseDays);
    } else if (arg === '--upcoming-days' && argv[i + 1]) {
      options.upcomingDays = parseNumber(argv[++i], options.upcomingDays);
    } else if (arg.startsWith('--upcoming-days=')) {
      options.upcomingDays = parseNumber(arg.slice('--upcoming-days='.length), options.upcomingDays);
    } else if (arg === '--stale-hours' && argv[i + 1]) {
      options.staleHours = parseNumber(argv[++i], options.staleHours);
    } else if (arg.startsWith('--stale-hours=')) {
      options.staleHours = parseNumber(arg.slice('--stale-hours='.length), options.staleHours);
    } else if (arg === '--max-targets' && argv[i + 1]) {
      options.maxTargets = parseNumber(argv[++i], options.maxTargets);
    } else if (arg.startsWith('--max-targets=')) {
      options.maxTargets = parseNumber(arg.slice('--max-targets='.length), options.maxTargets);
    }
  }

  options.setCodes = [...new Set(options.setCodes)];

  if (options.mode !== 'incremental' && options.mode !== 'full') {
    throw new Error(`Unknown cache mode "${options.mode}". Use "incremental" or "full".`);
  }

  return options;
}

function readCacheInfo(dataDir, code) {
  const filePath = path.join(dataDir, `${code}.json`);
  if (!fs.existsSync(filePath)) return { exists: false, updated: null };

  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return { exists: true, updated: data.updated || null };
  } catch (error) {
    return { exists: true, updated: null };
  }
}

function isStale(cacheInfo, now, staleHours) {
  if (!cacheInfo.exists || !cacheInfo.updated) return true;
  const updatedMs = Date.parse(cacheInfo.updated);
  if (Number.isNaN(updatedMs)) return true;
  return now - updatedMs >= staleHours * HOUR_MS;
}

function releaseWindowReason(set, now, options) {
  const releasedMs = Date.parse(set.released);
  if (Number.isNaN(releasedMs)) return null;

  const daysFromRelease = (now - releasedMs) / DAY_MS;
  if (daysFromRelease < 0 && Math.abs(daysFromRelease) <= options.upcomingDays) {
    return 'upcoming';
  }
  if (daysFromRelease >= 0 && daysFromRelease <= options.activeReleaseDays) {
    return 'active-release-window';
  }
  return null;
}

function makeTarget({ code, name, strategy = 'booster', reason }) {
  return { code: code.toLowerCase(), name, strategy, reason };
}

function addTarget(targets, target) {
  const existing = targets.get(target.code);
  if (existing) {
    existing.reason = `${existing.reason}, ${target.reason}`;
    return;
  }
  targets.set(target.code, target);
}

function selectMainTargets(sets, dataDir, options, now) {
  const explicit = new Set(options.setCodes);
  const targets = new Map();

  for (const set of sets) {
    const code = set.code.toLowerCase();
    const cacheInfo = readCacheInfo(dataDir, code);
    const explicitlySelected = explicit.has(code);

    if (options.mode === 'full') {
      addTarget(targets, makeTarget({ ...set, reason: 'full-refresh' }));
      continue;
    }

    if (explicitlySelected) {
      addTarget(targets, makeTarget({ ...set, reason: 'manual-set' }));
      continue;
    }

    if (!cacheInfo.exists) {
      addTarget(targets, makeTarget({ ...set, reason: 'missing-cache' }));
      continue;
    }

    const windowReason = releaseWindowReason(set, now, options);
    if (windowReason && isStale(cacheInfo, now, options.staleHours)) {
      addTarget(targets, makeTarget({ ...set, reason: windowReason }));
    }
  }

  return targets;
}

function buildAuxiliaryIndex(metadata) {
  const auxiliary = new Map();

  function remember(code, name, parentCode, reason) {
    const normalized = code.toLowerCase();
    if (!auxiliary.has(normalized)) {
      auxiliary.set(normalized, {
        code: normalized,
        name,
        parents: new Set(),
        reasons: new Set(),
      });
    }
    const entry = auxiliary.get(normalized);
    entry.parents.add(parentCode);
    entry.reasons.add(reason);
  }

  for (const [parentCode, meta] of Object.entries(metadata || {})) {
    if (meta.specialGuests) {
      remember('spg', 'Special Guests', parentCode, 'special-guests');
    }
    if (meta.hasBigScore) {
      remember('big', 'The Big Score', parentCode, 'big-score');
    }
    if (meta.bonusSheet) {
      remember(meta.bonusSheet, `${meta.bonusSheet.toUpperCase()} bonus sheet`, parentCode, 'bonus-sheet');
    }
  }

  return auxiliary;
}

function selectAuxiliaryTargets(metadata, mainTargets, dataDir, options) {
  const explicit = new Set(options.setCodes);
  const selectedMainCodes = new Set(mainTargets.keys());
  const auxiliary = buildAuxiliaryIndex(metadata);
  const targets = new Map();

  for (const entry of auxiliary.values()) {
    const parentSelected = [...entry.parents].some(parent => selectedMainCodes.has(parent));
    const explicitlySelected = explicit.has(entry.code);
    const cacheInfo = readCacheInfo(dataDir, entry.code);

    if (options.mode === 'full' || parentSelected || explicitlySelected || !cacheInfo.exists) {
      const reason = options.mode === 'full'
        ? 'full-refresh'
        : [
            parentSelected && `paired-with-${[...entry.parents].filter(parent => selectedMainCodes.has(parent)).join('+')}`,
            explicitlySelected && 'manual-set',
            !cacheInfo.exists && 'missing-cache',
          ].filter(Boolean).join(', ');

      addTarget(targets, makeTarget({
        code: entry.code,
        name: entry.name,
        strategy: 'all',
        reason,
      }));
    }
  }

  return targets;
}

function combineTargets(...targetMaps) {
  const combined = new Map();
  for (const targetMap of targetMaps) {
    for (const target of targetMap.values()) {
      addTarget(combined, target);
    }
  }
  return [...combined.values()];
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  // Load shared configs
  await loadCollectorExclusives();
  await loadBoosterIndex();

  const dataDir = path.join(__dirname, '..', 'data');

  // Source of truth: bensonperry.com/shared/sets.json (built by homepage/scripts/update-sets.js
  // from Scryfall + booster-data index). One list, no drift.
  const sets = await loadSets();
  const metadata = await loadMetadata();
  const now = Date.now();
  const mainTargets = selectMainTargets(sets, dataDir, options, now);
  const auxiliaryTargets = selectAuxiliaryTargets(metadata, mainTargets, dataDir, options);
  const targets = combineTargets(mainTargets, auxiliaryTargets);

  console.log(`Cache mode: ${options.mode}`);
  console.log(`Found ${sets.length} main sets; selected ${mainTargets.size} main and ${auxiliaryTargets.size} auxiliary target(s).`);
  if (options.mode === 'incremental') {
    console.log(`Window: ${options.activeReleaseDays} days back, ${options.upcomingDays} days forward, stale after ${options.staleHours} hours.`);
    console.log(`Circuit breaker: max ${options.maxTargets || 'unlimited'} incremental target(s).`);
  }
  console.log('');

  if (targets.length === 0) {
    console.log('Nothing to refresh.');
    return;
  }

  targets.forEach(target => console.log(`  - ${target.code}: ${target.reason}`));
  console.log('');

  if (options.mode === 'incremental' && options.maxTargets > 0 && targets.length > options.maxTargets) {
    throw new Error(`Incremental cache selected ${targets.length} targets, above the safety limit of ${options.maxTargets}. Run with --full or raise --max-targets if this is intentional.`);
  }

  if (options.dryRun) {
    console.log('Dry run complete; no files written.');
    return;
  }

  // Process targets in batches to avoid overwhelming Scryfall
  const BATCH_SIZE = 5;
  let processed = 0;
  let errors = [];

  for (let i = 0; i < targets.length; i += BATCH_SIZE) {
    const batch = targets.slice(i, i + BATCH_SIZE);

    for (const target of batch) {
      try {
        const cacheData = await cacheTarget(target);
        const filePath = path.join(dataDir, `${target.code}.json`);
        fs.writeFileSync(filePath, JSON.stringify(cacheData));
        processed++;
      } catch (error) {
        console.error(`  Error caching ${target.code}: ${error.message}`);
        errors.push({ set: target.code, error: error.message });
      }
    }

    // Longer pause between batches
    if (i + BATCH_SIZE < targets.length) {
      console.log(`\nPausing between batches... (${processed}/${targets.length} done)\n`);
      await delay(1000);
    }
  }

  console.log(`\nDone! Cached ${processed} target(s).`);
  if (errors.length > 0) {
    console.log(`Errors: ${errors.length}`);
    errors.forEach(e => console.log(`  - ${e.set}: ${e.error}`));
  }

  // Write a manifest file with last update time
  const manifest = {
    updated: new Date().toISOString(),
    mode: options.mode,
    selected: targets.length,
    sets: processed,
    errors: errors.length,
    activeReleaseDays: options.activeReleaseDays,
    upcomingDays: options.upcomingDays,
    staleHours: options.staleHours,
    maxTargets: options.maxTargets,
    refreshed: targets
      .filter(target => !errors.some(error => error.set === target.code))
      .map(target => target.code),
    failed: errors,
  };
  fs.writeFileSync(path.join(dataDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  if (errors.length > 0) {
    console.error(`\nFailing run: ${errors.length} set(s) errored. Refusing to publish a partial cache.`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
