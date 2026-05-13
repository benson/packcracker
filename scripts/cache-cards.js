#!/usr/bin/env node

/**
 * Cache price/display data for cards that MTGJSON says can appear in boosters.
 * MTGJSON is the source of truth for pack membership and odds; Scryfall is used
 * only for prices, image URLs, and card links.
 */

const fs = require('fs');
const path = require('path');

const SCRYFALL_API = 'https://api.scryfall.com';
const SHARED_URL = 'https://bensonperry.com/shared';
const MIN_CACHE_PRICE = Number(process.env.CACHE_MIN_PRICE || 0);
const RATE_LIMIT_MS = 200;
const DEFAULT_ACTIVE_RELEASE_DAYS = 120;
const DEFAULT_UPCOMING_DAYS = 90;
const DEFAULT_STALE_HOURS = 20;
const DEFAULT_MAX_INCREMENTAL_TARGETS = 25;
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const SCRYFALL_HEADERS = {
  Accept: 'application/json;q=0.9,*/*;q=0.8',
  'User-Agent': 'packcracker-card-cache/2.0 (https://github.com/benson/packcracker)',
};
const WINDOWS_RESERVED_FILENAMES = new Set([
  'con', 'prn', 'aux', 'nul',
  'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
  'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9',
]);

const boosterModelCache = new Map();
const scryfallCache = new Map();

function localSharedPath(...parts) {
  return path.join(__dirname, '..', '..', 'homepage', 'shared', ...parts);
}

function boosterArtifactFileName(setCode) {
  const code = String(setCode || '').toLowerCase();
  return (WINDOWS_RESERVED_FILENAMES.has(code) ? `_${code}` : code) + '.json';
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

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

async function fetchWithRetry(url, retries = 6, options = {}) {
  let lastError = null;
  for (let i = 0; i < retries; i++) {
    const attempt = i + 1;
    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          ...SCRYFALL_HEADERS,
          ...(options.headers || {}),
        },
      });
      if (response.status === 429) {
        lastError = new Error(`HTTP 429 after ${attempt} attempt(s)`);
        if (attempt >= retries) break;
        const waitMs = getRetryDelayMs(response, attempt);
        console.log(`  Rate limited, waiting ${Math.ceil(waitMs / 1000)}s...`);
        await delay(waitMs);
        continue;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    } catch (error) {
      lastError = error;
      if (attempt >= retries) break;
      await delay(500 * attempt);
    }
  }
  throw lastError || new Error(`Failed to fetch ${url}`);
}

function readLocalJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

async function loadSets() {
  const local = readLocalJson(localSharedPath('sets.json'));
  if (local) return local;
  const res = await fetch(`${SHARED_URL}/sets.json`);
  if (!res.ok) throw new Error(`Failed to fetch shared sets.json: HTTP ${res.status}`);
  return res.json();
}

async function loadBoosterModel(setCode) {
  const code = String(setCode || '').toLowerCase();
  if (boosterModelCache.has(code)) return boosterModelCache.get(code);

  const fileName = boosterArtifactFileName(code);
  const local = readLocalJson(localSharedPath('boosters', fileName));
  if (local) {
    boosterModelCache.set(code, local);
    return local;
  }

  try {
    const res = await fetch(`${SHARED_URL}/boosters/${fileName}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    boosterModelCache.set(code, data);
    return data;
  } catch (error) {
    boosterModelCache.set(code, null);
    return null;
  }
}

function resolveActualBoosterType(model, boosterType) {
  return model?.appBoosterMap?.[boosterType] || (model?.boosters?.[boosterType] ? boosterType : null);
}

function sheetEntries(sheet) {
  return Object.entries(sheet.cards || {})
    .map(([uuid, weight]) => ({ uuid, weight: Number(weight || 0) }))
    .filter(entry => entry.weight > 0);
}

function isExtraSheet(model, actualType, sheetName) {
  return Boolean(model.extraSheetsByBoosterType?.[actualType]?.[sheetName]);
}

function calculateBoosterOdds(model, boosterType) {
  const actualType = resolveActualBoosterType(model, boosterType);
  const config = actualType ? model.boosters?.[actualType] : null;
  const expected = {};
  if (!model || !config) return { actualType: null, cards: expected };

  for (const variant of config.boosters || []) {
    const variantOdds = config.boostersTotalWeight
      ? Number(variant.weight || 0) / config.boostersTotalWeight
      : 0;

    for (const [sheetName, count] of Object.entries(variant.contents || {})) {
      const sheet = config.sheets?.[sheetName];
      if (!sheet) continue;
      const entries = sheetEntries(sheet);
      const total = sheet.totalWeight || entries.reduce((sum, entry) => sum + entry.weight, 0);
      if (total <= 0) continue;

      const finish = sheet.foil ? 'foil' : 'nonfoil';
      const extra = isExtraSheet(model, actualType, sheetName);

      for (const entry of entries) {
        const copies = variantOdds * Number(count || 0) * (entry.weight / total);
        if (!expected[entry.uuid]) {
          expected[entry.uuid] = {
            uuid: entry.uuid,
            card: model.cards?.[entry.uuid] || null,
            finishes: {},
            expectedCopies: 0,
            isExtra: false,
            sheetNames: [],
          };
        }
        expected[entry.uuid].expectedCopies += copies;
        expected[entry.uuid].finishes[finish] = (expected[entry.uuid].finishes[finish] || 0) + copies;
        expected[entry.uuid].isExtra = expected[entry.uuid].isExtra || extra;
        if (!expected[entry.uuid].sheetNames.includes(sheetName)) expected[entry.uuid].sheetNames.push(sheetName);
      }
    }
  }

  return { actualType, cards: expected };
}

function chunkArray(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

async function fetchScryfallCollection(ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  const missing = unique.filter(id => !scryfallCache.has(id));

  for (const chunk of chunkArray(missing, 75)) {
    if (chunk.length === 0) continue;
    await delay(RATE_LIMIT_MS);
    const data = await fetchWithRetry(`${SCRYFALL_API}/cards/collection`, 6, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifiers: chunk.map(id => ({ id })) }),
    });
    for (const card of data.data || []) scryfallCache.set(card.id, card);
    for (const notFound of data.not_found || []) {
      if (notFound.id) scryfallCache.set(notFound.id, null);
    }
  }

  return Object.fromEntries(unique.map(id => [id, scryfallCache.get(id) || null]));
}

function processCard(scryfallCard, mtgjsonCard, oddsEntry) {
  if (!scryfallCard || !mtgjsonCard || !oddsEntry) return null;

  const prices = scryfallCard.prices || {};
  const finishes = scryfallCard.finishes || [];
  const finishRows = [];

  const finishConfig = [
    { type: 'nonfoil', priceKey: 'usd', oddsKey: 'nonfoil' },
    { type: 'foil', priceKey: 'usd_foil', oddsKey: 'foil' },
    { type: 'etched', priceKey: 'usd_etched', oddsKey: 'etched' },
  ];

  for (const finish of finishConfig) {
    const packOdds = oddsEntry.finishes[finish.oddsKey] || 0;
    const price = Number(prices[finish.priceKey] || 0);
    if (!finishes.includes(finish.type)) continue;
    if (packOdds <= 0) continue;
    if (price <= 0) continue;
    if (price < MIN_CACHE_PRICE) continue;
    finishRows.push({ type: finish.type, price, packOdds });
  }

  if (finishRows.length === 0) return null;

  return {
    id: scryfallCard.id,
    uuid: mtgjsonCard.uuid,
    name: scryfallCard.name,
    set: scryfallCard.set,
    collector_number: scryfallCard.collector_number,
    rarity: scryfallCard.rarity,
    booster: true,
    image: scryfallCard.image_uris?.normal || scryfallCard.card_faces?.[0]?.image_uris?.normal || '',
    uri: scryfallCard.scryfall_uri,
    finishes: finishRows,
    showcase: scryfallCard.frame_effects?.includes('showcase') || false,
    extendedart: scryfallCard.frame_effects?.includes('extendedart') || false,
    inverted: scryfallCard.frame_effects?.includes('inverted') || false,
    borderless: scryfallCard.border_color === 'borderless',
    fullart: scryfallCard.full_art || false,
    etched: scryfallCard.frame_effects?.includes('etched') || false,
    promo: scryfallCard.promo || false,
    promo_types: scryfallCard.promo_types || [],
    packOdds: oddsEntry.expectedCopies,
    isExtra: oddsEntry.isExtra,
    sheetNames: oddsEntry.sheetNames,
  };
}

function dedupeCards(cards) {
  const best = new Map();
  for (const card of cards.filter(Boolean)) {
    const key = card.id;
    const existing = best.get(key);
    if (!existing || card.packOdds > existing.packOdds) best.set(key, card);
  }
  return [...best.values()].sort((a, b) => {
    const aMax = Math.max(...a.finishes.map(f => f.price));
    const bMax = Math.max(...b.finishes.map(f => f.price));
    return bMax - aMax;
  });
}

async function buildCardsForOdds(odds, scryfallById) {
  const cards = [];
  for (const entry of Object.values(odds.cards)) {
    const mtgjsonCard = entry.card;
    const scryfallId = mtgjsonCard?.identifiers?.scryfallId;
    cards.push(processCard(scryfallById[scryfallId], mtgjsonCard, entry));
  }
  return dedupeCards(cards);
}

async function cacheSet(set) {
  console.log(`Caching ${set.code} (${set.name})...`);
  const model = await loadBoosterModel(set.code);
  if (!model) throw new Error(`missing MTGJSON booster model for ${set.code}`);

  const playOdds = model.appBoosterMap?.play ? calculateBoosterOdds(model, 'play') : { cards: {} };
  const collectorOdds = model.appBoosterMap?.collector ? calculateBoosterOdds(model, 'collector') : { cards: {} };

  const ids = [];
  for (const odds of [playOdds, collectorOdds]) {
    for (const entry of Object.values(odds.cards)) {
      const id = entry.card?.identifiers?.scryfallId;
      if (id) ids.push(id);
    }
  }

  const scryfallById = await fetchScryfallCollection(ids);
  const allPlay = await buildCardsForOdds(playOdds, scryfallById);
  const play = allPlay.filter(card => !card.isExtra);
  const extras = allPlay.filter(card => card.isExtra);
  const collector = await buildCardsForOdds(collectorOdds, scryfallById);

  console.log(`  Play: ${play.length}, extras: ${extras.length}, collector: ${collector.length}`);

  return {
    set: set.code,
    name: set.name,
    updated: new Date().toISOString(),
    source: 'mtgjson+scryfall',
    play,
    extras,
    collector: collector.length > 0 ? collector : [...play, ...extras],
  };
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
    if (arg === '--full') options.mode = 'full';
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--mode' && argv[i + 1]) options.mode = argv[++i].toLowerCase();
    else if (arg.startsWith('--mode=')) options.mode = arg.slice('--mode='.length).toLowerCase();
    else if ((arg === '--set' || arg === '--sets') && argv[i + 1]) options.setCodes.push(...splitCodes(argv[++i]));
    else if (arg.startsWith('--set=')) options.setCodes.push(...splitCodes(arg.slice('--set='.length)));
    else if (arg.startsWith('--sets=')) options.setCodes.push(...splitCodes(arg.slice('--sets='.length)));
    else if (arg === '--active-release-days' && argv[i + 1]) options.activeReleaseDays = parseNumber(argv[++i], options.activeReleaseDays);
    else if (arg.startsWith('--active-release-days=')) options.activeReleaseDays = parseNumber(arg.slice('--active-release-days='.length), options.activeReleaseDays);
    else if (arg === '--upcoming-days' && argv[i + 1]) options.upcomingDays = parseNumber(argv[++i], options.upcomingDays);
    else if (arg.startsWith('--upcoming-days=')) options.upcomingDays = parseNumber(arg.slice('--upcoming-days='.length), options.upcomingDays);
    else if (arg === '--stale-hours' && argv[i + 1]) options.staleHours = parseNumber(argv[++i], options.staleHours);
    else if (arg.startsWith('--stale-hours=')) options.staleHours = parseNumber(arg.slice('--stale-hours='.length), options.staleHours);
    else if (arg === '--max-targets' && argv[i + 1]) options.maxTargets = parseNumber(argv[++i], options.maxTargets);
    else if (arg.startsWith('--max-targets=')) options.maxTargets = parseNumber(arg.slice('--max-targets='.length), options.maxTargets);
  }

  options.setCodes = [...new Set(options.setCodes)];
  if (!['incremental', 'full'].includes(options.mode)) {
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
  } catch {
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
  if (daysFromRelease < 0 && Math.abs(daysFromRelease) <= options.upcomingDays) return 'upcoming';
  if (daysFromRelease >= 0 && daysFromRelease <= options.activeReleaseDays) return 'active-release-window';
  return null;
}

function selectTargets(sets, dataDir, options, now) {
  const explicit = new Set(options.setCodes);
  const targets = [];

  for (const set of sets) {
    const code = set.code.toLowerCase();
    if (!set.boosterTypes?.includes('play') && !set.boosterTypes?.includes('collector')) continue;
    if (explicit.size > 0 && !explicit.has(code)) continue;
    const cacheInfo = readCacheInfo(dataDir, code);

    if (options.mode === 'full') targets.push({ ...set, reason: explicit.has(code) ? 'manual-full-refresh' : 'full-refresh' });
    else if (explicit.has(code)) targets.push({ ...set, reason: 'manual-set' });
    else if (!cacheInfo.exists) targets.push({ ...set, reason: 'missing-cache' });
    else {
      const reason = releaseWindowReason(set, now, options);
      if (reason && isStale(cacheInfo, now, options.staleHours)) targets.push({ ...set, reason });
    }
  }

  return targets;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const dataDir = path.join(__dirname, '..', 'data');
  const sets = await loadSets();
  const now = Date.now();
  const targets = selectTargets(sets, dataDir, options, now);

  console.log(`Cache mode: ${options.mode}`);
  console.log(`Found ${sets.length} MTGJSON-backed set(s); selected ${targets.length} target(s).`);
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

  let processed = 0;
  const errors = [];

  for (const target of targets) {
    try {
      const cacheData = await cacheSet(target);
      fs.writeFileSync(path.join(dataDir, `${target.code}.json`), JSON.stringify(cacheData));
      processed++;
    } catch (error) {
      console.error(`  Error caching ${target.code}: ${error.message}`);
      errors.push({ set: target.code, error: error.message });
    }
  }

  const manifest = {
    updated: new Date().toISOString(),
    source: 'mtgjson+scryfall',
    mode: options.mode,
    selected: targets.length,
    sets: processed,
    errors: errors.length,
    activeReleaseDays: options.activeReleaseDays,
    upcomingDays: options.upcomingDays,
    staleHours: options.staleHours,
    maxTargets: options.maxTargets,
    refreshed: targets.filter(target => !errors.some(error => error.set === target.code)).map(target => target.code),
    failed: errors,
  };
  fs.writeFileSync(path.join(dataDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  console.log(`\nDone! Cached ${processed} target(s).`);
  if (errors.length > 0) {
    console.error(`\nFailing run: ${errors.length} set(s) errored. Refusing to publish a partial cache.`);
    process.exit(1);
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
