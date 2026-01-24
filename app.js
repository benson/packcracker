// Pack Cracker - MTG Booster Value Guide
import {
  fetchSets,
  createSetAutocomplete,
  delay,
  fetchWithRetry,
  isCollectorExclusive,
  COLLECTOR_BOOSTER_START,
  PLAY_BOOSTER_START,
  FOIL_START,
  JUMPSTART_SETS,
  DRAFT_ONLY_SETS,
  SPECIAL_GUESTS_RANGES,
  SETS_WITH_BIG_SCORE,
  SETS_WITH_SPECIAL_GUESTS,
  BONUS_SHEET_SETS,
} from 'https://bensonperry.com/shared/mtg.js';

// Sets where retro frame cards appear in Play Boosters (not collector-exclusive)
// TODO: Import from mtg.js once deployed
const SETS_WITH_RETRO_IN_BOOSTERS = new Set(['mh3']);

const SCRYFALL_API = 'https://api.scryfall.com';

// Play Booster pull rates for EV calculation
// Source: https://magic.wizards.com/en/news/feature/play-booster-contents
const RARE_RATE = 0.875;       // ~87.5% chance of rare in rare/mythic slot
const MYTHIC_RATE = 0.125;     // ~12.5% chance of mythic (roughly 7:1 ratio)
const FOIL_RARE_RATE = 0.10;   // ~10% chance of foil rare across pack
const FOIL_MYTHIC_RATE = 0.02; // ~2% chance of foil mythic across pack

// ============ URL State Management ============

function getStateFromURL() {
  const params = new URLSearchParams(window.location.search);
  return {
    set: params.get('set') || null,
    booster: params.get('booster') || 'play',
    min: params.get('min') || '2',
    foils: params.get('foils') || 'include',
    rares: params.get('rares') || 'include',
    list: params.get('list') || 'exclude'
  };
}

function updateURL(state) {
  const params = new URLSearchParams();
  if (state.set) params.set('set', state.set);
  if (state.booster !== 'play') params.set('booster', state.booster);
  if (state.min !== '2') params.set('min', state.min);
  if (state.foils !== 'include') params.set('foils', state.foils);
  if (state.rares !== 'include') params.set('rares', state.rares);
  if (state.list !== 'exclude') params.set('list', state.list);

  const newURL = params.toString()
    ? window.location.pathname + '?' + params.toString()
    : window.location.pathname;

  window.history.replaceState({}, '', newURL);
}

function getCurrentState() {
  return {
    set: document.getElementById('set-select').value,
    booster: document.getElementById('booster-type').value,
    min: document.getElementById('min-price').value,
    foils: document.getElementById('foils-mode').value,
    rares: document.getElementById('rares-mode').value,
    list: document.getElementById('list-mode').value
  };
}

// ============ State ============

let setsData = [];
let autocomplete = null;

// ============ Toggle Buttons ============

// Helper to set up a toggle button group
function setupToggle(toggleId, hiddenId, onChange, options = {}) {
  const toggle = document.getElementById(toggleId);
  const hidden = document.getElementById(hiddenId);
  const { disableWhenSingle = false } = options;

  toggle.addEventListener('click', (e) => {
    const btn = e.target.closest('.toggle-btn');
    if (!btn) return;
    if (disableWhenSingle && toggle.classList.contains('single')) return;

    toggle.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    hidden.value = btn.dataset.value;
    onChange();
  });
}

function setupToggles() {
  // Filter toggles
  setupToggle('booster-toggle', 'booster-type', onFilterChange, { disableWhenSingle: true });
  setupToggle('price-toggle', 'min-price', onFilterChange);
  setupToggle('foils-toggle', 'foils-mode', onFilterChange);
  setupToggle('rares-toggle', 'rares-mode', onFilterChange);
  setupToggle('list-toggle', 'list-mode', onFilterChange);

  // Grid columns toggle (mobile only) - separate logic for localStorage
  const gridToggle = document.getElementById('grid-toggle');
  const cardGrid = document.getElementById('card-grid');

  const savedCols = localStorage.getItem('gridCols') || '2';
  setGridCols(savedCols);

  gridToggle.addEventListener('click', (e) => {
    const btn = e.target.closest('.grid-btn');
    if (!btn) return;

    gridToggle.querySelectorAll('.grid-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const cols = btn.dataset.cols;
    setGridCols(cols);
    localStorage.setItem('gridCols', cols);
  });

  function setGridCols(cols) {
    cardGrid.classList.remove('cols-1', 'cols-3', 'cols-4');
    if (cols === '1') cardGrid.classList.add('cols-1');
    if (cols === '3') cardGrid.classList.add('cols-3');
    if (cols === '4') cardGrid.classList.add('cols-4');
    gridToggle.querySelectorAll('.grid-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.cols === cols);
    });
  }
}

function setToggleValue(toggleId, hiddenId, value) {
  const toggle = document.getElementById(toggleId);
  const hidden = document.getElementById(hiddenId);

  toggle.querySelectorAll('.toggle-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.value === value);
  });
  hidden.value = value;
}

// ============ Booster Type Logic ============

function getBoosterEra(releaseDate) {
  if (releaseDate >= PLAY_BOOSTER_START) {
    return 'play';
  } else if (releaseDate >= COLLECTOR_BOOSTER_START) {
    return 'set';
  } else {
    return 'draft';
  }
}

function updateBoosterTypeOptions(releaseDate, setCode, preserveValue = null) {
  const boosterToggle = document.getElementById('booster-toggle');
  const boosterHidden = document.getElementById('booster-type');

  // Jumpstart sets have their own booster type
  if (JUMPSTART_SETS.has(setCode)) {
    boosterToggle.innerHTML = '<button type="button" class="toggle-btn active" data-value="play">jumpstart</button>';
    boosterToggle.classList.add('single');
    boosterHidden.value = 'play';
    return;
  }

  // Draft-only sets (masters sets, mystery booster, etc.)
  if (DRAFT_ONLY_SETS.has(setCode)) {
    boosterToggle.innerHTML = '<button type="button" class="toggle-btn active" data-value="play">draft booster</button>';
    boosterToggle.classList.add('single');
    boosterHidden.value = 'play';
    return;
  }

  const era = getBoosterEra(releaseDate);

  if (era === 'draft') {
    // Single option - no toggle needed
    boosterToggle.innerHTML = '<button type="button" class="toggle-btn active" data-value="play">draft booster</button>';
    boosterToggle.classList.add('single');
    boosterHidden.value = 'play';
  } else if (era === 'set') {
    boosterToggle.innerHTML =
      '<button type="button" class="toggle-btn active" data-value="play">draft / set</button>' +
      '<button type="button" class="toggle-btn" data-value="collector">collector</button>';
    boosterToggle.classList.remove('single');
  } else {
    boosterToggle.innerHTML =
      '<button type="button" class="toggle-btn active" data-value="play">play</button>' +
      '<button type="button" class="toggle-btn" data-value="collector">collector</button>';
    boosterToggle.classList.remove('single');
  }

  // Restore value if valid
  if (preserveValue && era !== 'draft') {
    setToggleValue('booster-toggle', 'booster-type', preserveValue);
  }
}

function updateFilterToggles(setCode, releaseDate) {
  const listToggleGroup = document.getElementById('list-toggle').closest('.select-group');
  const listLabel = listToggleGroup.querySelector('label');
  const listHidden = document.getElementById('list-mode');

  const foilsToggleGroup = document.getElementById('foils-toggle').closest('.select-group');
  const foilsHidden = document.getElementById('foils-mode');

  // Check what this set has
  const hasSpecialGuests = SETS_WITH_SPECIAL_GUESTS.has(setCode);
  const hasBigScore = SETS_WITH_BIG_SCORE.has(setCode);
  const hasFoils = releaseDate >= FOIL_START;

  // Update Special Guests toggle (only for sets we can accurately query)
  if (hasSpecialGuests) {
    listToggleGroup.classList.remove('hidden');
    // Update label based on what's available
    if (hasBigScore) {
      listLabel.textContent = 'the big score / special guests';
    } else {
      listLabel.textContent = 'special guests';
    }
  } else {
    listToggleGroup.classList.add('hidden');
    listHidden.value = 'exclude';
    setToggleValue('list-toggle', 'list-mode', 'exclude');
  }

  // Update foils toggle
  if (hasFoils) {
    foilsToggleGroup.classList.remove('hidden');
  } else {
    foilsToggleGroup.classList.add('hidden');
    foilsHidden.value = 'include'; // Default to include (non-foils only for old sets)
    setToggleValue('foils-toggle', 'foils-mode', 'include');
  }
}

// ============ Card Fetching & Filtering ============

// Try to load from cache first, fall back to live API
async function fetchSetCards(setCode, boosterType, includeSpecialGuests) {
  let cards = [];

  // Try cached data first
  try {
    const cached = await fetchCachedCards(setCode, boosterType);
    if (cached && cached.length > 0) {
      console.log('Loaded ' + cached.length + ' cards from cache for ' + setCode);
      cards = cached;

      // If includeSpecialGuests, also get cached Special Guests cards
      if (includeSpecialGuests && SETS_WITH_SPECIAL_GUESTS.has(setCode)) {
        const specialGuestsCards = await fetchCachedSpecialGuestsCards(setCode);
        cards = [...cards, ...specialGuestsCards];
      }
    }
  } catch (e) {
    console.log('Cache miss for ' + setCode + ', fetching live...');
  }

  // Fall back to live API if no cache
  if (cards.length === 0) {
    cards = await fetchLiveCards(setCode, boosterType, includeSpecialGuests);
  }

  // Always fetch bonus sheet cards (like Avatar source material)
  if (BONUS_SHEET_SETS[setCode]) {
    const bonusCards = await fetchBonusSheetCards(BONUS_SHEET_SETS[setCode], boosterType);
    cards = [...cards, ...bonusCards];
  }

  // Fetch retro frame cards for sets where they appear in Play Boosters
  if (SETS_WITH_RETRO_IN_BOOSTERS.has(setCode)) {
    const retroCards = await fetchRetroFrameCards(setCode);
    cards = [...cards, ...retroCards];
  }

  // Filter out collector exclusives for play boosters (for live-fetched cards only)
  // Cached cards are already filtered correctly by the cache script using set-configs
  // Skip bonus sheets, Special Guests, Big Score, and retro cards - they appear in play boosters
  if (boosterType !== 'collector') {
    cards = cards.filter(card => {
      if (card._fromCache) return true; // Already filtered by cache script
      if (card._fromBonusSheet) return true;
      if (card._fromRetroSheet) return true;
      if (card.set === 'spg' || card.set === 'big') return true;
      return !isCollectorExclusive(card);
    });
  }

  return cards;
}

// Convert cached card format back to Scryfall-like format
function convertCachedCard(card) {
  return {
    id: card.id,
    name: card.name,
    set: card.set,
    rarity: card.rarity,
    collector_number: card.collector_number,
    booster: card.booster,
    image_uris: { normal: card.image },
    scryfall_uri: card.uri,
    _fromCache: true, // Mark as cached - already filtered correctly by cache script
    finishes: card.finishes.map(f => f.type),
    prices: {
      usd: card.finishes.find(f => f.type === 'nonfoil')?.price?.toString() || null,
      usd_foil: card.finishes.find(f => f.type === 'foil')?.price?.toString() || null,
      usd_etched: card.finishes.find(f => f.type === 'etched')?.price?.toString() || null,
    },
    frame_effects: [
      card.showcase && 'showcase',
      card.extendedart && 'extendedart',
      card.etched && 'etched',
      card.inverted && 'inverted',
    ].filter(Boolean),
    promo_types: card.promo_types || [],
    border_color: card.borderless ? 'borderless' : 'black',
    full_art: card.fullart || false,
    promo: card.promo || false,
  };
}

// Fetch from pre-cached JSON files
async function fetchCachedCards(setCode, boosterType) {
  const response = await fetch('./data/' + setCode + '.json');
  if (!response.ok) return null;

  const data = await response.json();
  const cards = boosterType === 'collector' ? data.collector : data.play;

  return cards.map(convertCachedCard);
}

// Fetch cached Special Guests cards for a specific set
async function fetchCachedSpecialGuestsCards(setCode) {
  const cards = [];
  const range = SPECIAL_GUESTS_RANGES[setCode];

  // Try to fetch from spg cache file
  try {
    const response = await fetch('./data/spg.json');
    if (response.ok) {
      const data = await response.json();
      const allCards = data.collector || data.play || [];

      // Filter to only cards in this set's collector number range
      const filtered = allCards.filter(card => {
        const cn = parseInt(card.collector_number || '0');
        return cn >= range[0] && cn <= range[1];
      });

      cards.push(...filtered.map(convertCachedCard));
    }
  } catch (e) {
    // Ignore missing cache files
  }

  // For OTJ, also fetch The Big Score
  if (SETS_WITH_BIG_SCORE.has(setCode)) {
    try {
      const response = await fetch('./data/big.json');
      if (response.ok) {
        const data = await response.json();
        const bigScoreCards = data.collector || data.play || [];
        cards.push(...bigScoreCards.map(convertCachedCard));
      }
    } catch (e) {
      // Ignore missing cache files
    }
  }

  return cards;
}

// Live fetch from Scryfall API
async function fetchLiveCards(setCode, boosterType, includeSpecialGuests) {
  let query = 'set:' + setCode + ' lang:en';

  // Jumpstart and draft-only sets don't use is:booster filter
  if (boosterType !== 'collector' && !JUMPSTART_SETS.has(setCode) && !DRAFT_ONLY_SETS.has(setCode)) {
    // For Play Boosters, include boosterfun cards (showcase/borderless appear in wildcard slot)
    // Collector exclusives are filtered client-side
    query += ' is:booster';
  }

  // Fetch all cards with any meaningful price (for accurate EV calculation)
  query += ' (usd>=0.5 OR usd_foil>=0.5)';

  const url = SCRYFALL_API + '/cards/search?q=' + encodeURIComponent(query) + '&unique=prints&order=usd&dir=desc';

  let cards = [];
  try {
    const data = await fetchWithRetry(url);
    cards = data.data;
  } catch (error) {
    if (error.message !== 'HTTP 404') throw error;
  }

  // Client-side filter: remove collector-exclusive cards for play boosters
  // This is needed because Scryfall's filters don't work reliably for new sets
  if (boosterType !== 'collector') {
    cards = cards.filter(card => !isCollectorExclusive(card));
  }

  if (includeSpecialGuests && SETS_WITH_SPECIAL_GUESTS.has(setCode)) {
    const specialGuestsCards = await fetchLiveSpecialGuestsCards(setCode);
    cards = cards.concat(specialGuestsCards);
  }

  return cards;
}

// Live fetch for Special Guests (and Big Score for OTJ)
async function fetchLiveSpecialGuestsCards(setCode) {
  let allCards = [];

  // Fetch Special Guests by collector number range
  const range = SPECIAL_GUESTS_RANGES[setCode];
  if (range) {
    try {
      const query = 'set:spg cn>=' + range[0] + ' cn<=' + range[1] + ' (usd>=0.5 OR usd_foil>=0.5)';
      const url = SCRYFALL_API + '/cards/search?q=' + encodeURIComponent(query) + '&unique=prints&order=usd&dir=desc';
      const data = await fetchWithRetry(url);
      allCards = allCards.concat(data.data || []);
    } catch (error) {
      // Ignore 404s (no matching cards)
    }
  }

  // For OTJ, also fetch The Big Score cards
  if (SETS_WITH_BIG_SCORE.has(setCode)) {
    try {
      const query = 'set:big (usd>=0.5 OR usd_foil>=0.5)';
      const url = SCRYFALL_API + '/cards/search?q=' + encodeURIComponent(query) + '&unique=prints&order=usd&dir=desc';
      const data = await fetchWithRetry(url);
      allCards = allCards.concat(data.data || []);
    } catch (error) {
      // Ignore 404s
    }
  }

  return allCards;
}

// Fetch retro frame and full art cards for sets where they appear in Play Boosters
// Scryfall marks these as booster:false but they DO appear in play boosters
async function fetchRetroFrameCards(setCode) {
  try {
    const query = 'set:' + setCode + ' (frame:old OR is:full) lang:en (usd>=0.5 OR usd_foil>=0.5)';
    const url = SCRYFALL_API + '/cards/search?q=' + encodeURIComponent(query) + '&unique=prints&order=usd&dir=desc';
    const data = await fetchWithRetry(url);
    let cards = data.data || [];
    // Mark as retro so they skip collector-exclusive filter
    cards = cards.map(card => ({ ...card, _fromRetroSheet: true }));
    return cards;
  } catch (error) {
    return [];
  }
}

// Fetch bonus sheet cards (e.g., source material cards from TLE, MAR)
// These are manually curated via BONUS_SHEET_SETS - we know they appear in play boosters
// per WotC product info, even if Scryfall's booster flag is unreliable for these sets.
// We also skip the collector-exclusive filter since these sets use their own styling.
async function fetchBonusSheetCards(bonusSetCode, boosterType) {
  try {
    // Don't use is:booster filter - Scryfall's booster flag is unreliable for bonus sheets
    // (e.g., MAR cards have booster:false but DO appear in Spider-Man Play Boosters)
    const query = 'set:' + bonusSetCode + ' lang:en (usd>=0.5 OR usd_foil>=0.5)';

    const url = SCRYFALL_API + '/cards/search?q=' + encodeURIComponent(query) + '&unique=prints&order=usd&dir=desc';
    const data = await fetchWithRetry(url);
    let cards = data.data || [];

    // Mark these as bonus sheet cards so they skip the unified filter
    cards = cards.map(card => ({ ...card, _fromBonusSheet: true }));

    return cards;
  } catch (error) {
    // Ignore 404s
    return [];
  }
}

function getCardTreatment(card, isFoil) {
  const treatments = [];

  if (card.frame_effects?.includes('showcase')) treatments.push('Showcase');
  if (card.frame_effects?.includes('extendedart')) treatments.push('Extended Art');
  if (card.border_color === 'borderless') treatments.push('Borderless');
  if (card.promo) treatments.push('Promo');
  if (card.full_art) treatments.push('Full Art');
  if (card.frame_effects?.includes('etched')) treatments.push('Etched');
  if (isFoil) treatments.push('Foil');

  // Mark list/special guests cards
  if (card.set === 'plst') treatments.push('The List');
  if (card.set === 'spg') treatments.push('Special Guest');

  return treatments.length > 0 ? treatments.join(', ') : 'Regular';
}

// Finish type configuration for expansion
const FINISH_TYPES = [
  { key: 'nonfoil', priceKey: 'usd', isFoil: false },
  { key: 'foil', priceKey: 'usd_foil', isFoil: true },
  { key: 'etched', priceKey: 'usd_etched', isFoil: false, transformTreatment: t => t.replace('Regular', 'Etched') || 'Etched' },
];

function expandCardFinishes(cards) {
  const expanded = [];

  for (const card of cards) {
    const prices = card.prices || {};
    const finishes = card.finishes || [];

    for (const finish of FINISH_TYPES) {
      if (finishes.includes(finish.key) && prices[finish.priceKey]) {
        const price = parseFloat(prices[finish.priceKey]);
        if (price > 0) {
          let treatment = getCardTreatment(card, finish.isFoil);
          if (finish.transformTreatment) treatment = finish.transformTreatment(treatment);
          expanded.push({ ...card, price, isFoil: finish.isFoil, treatment, finishKey: finish.key });
        }
      }
    }
  }

  return expanded;
}

function filterAndSortCards(cards, minPrice, excludeRares, excludeFoils) {
  const expanded = expandCardFinishes(cards);

  // Filter first
  const filtered = expanded
    .filter(card => card.price >= minPrice)
    .filter(card => {
      if (!excludeRares) return true;
      const rarity = card.rarity?.toLowerCase();
      return rarity !== 'rare' && rarity !== 'mythic';
    })
    .filter(card => {
      if (!excludeFoils) return true;
      return !card.isFoil;
    });

  // Group by card ID to merge foil/nonfoil
  const grouped = new Map();
  for (const card of filtered) {
    if (!grouped.has(card.id)) {
      grouped.set(card.id, {
        ...card,
        finishPrices: [],
        maxPrice: 0
      });
    }
    const group = grouped.get(card.id);
    group.finishPrices.push({
      type: card.isFoil ? 'foil' : (card.finishKey === 'etched' ? 'etched' : 'regular'),
      price: card.price
    });
    if (card.price > group.maxPrice) {
      group.maxPrice = card.price;
      // Use the highest-priced version's treatment as the base
      group.treatment = card.treatment;
      group.isFoil = card.isFoil;
    }
  }

  // Sort finish prices within each card (highest first)
  for (const card of grouped.values()) {
    card.finishPrices.sort((a, b) => b.price - a.price);
  }

  // Sort by max price
  return Array.from(grouped.values()).sort((a, b) => b.maxPrice - a.maxPrice);
}

// Calculate expected value of opening a pack
// Based on pull rates for the rare/mythic slot (main source of value)
function calculatePackEV(cards) {
  // Expand all finishes first (we need all versions for EV calculation)
  const expanded = expandCardFinishes(cards);

  // Group by rarity and separate foil/non-foil
  const nonFoilRares = expanded.filter(c => c.rarity === 'rare' && !c.isFoil);
  const nonFoilMythics = expanded.filter(c => c.rarity === 'mythic' && !c.isFoil);
  const foilRares = expanded.filter(c => c.rarity === 'rare' && c.isFoil);
  const foilMythics = expanded.filter(c => c.rarity === 'mythic' && c.isFoil);

  // Count unique cards per rarity (for probability calculation)
  const uniqueRares = new Set(nonFoilRares.map(c => c.id)).size || 1;
  const uniqueMythics = new Set(nonFoilMythics.map(c => c.id)).size || 1;
  const uniqueFoilRares = new Set(foilRares.map(c => c.id)).size || 1;
  const uniqueFoilMythics = new Set(foilMythics.map(c => c.id)).size || 1;

  // Calculate EV for rare/mythic slot (non-foil)
  let ev = 0;

  for (const card of nonFoilRares) {
    ev += card.price * (RARE_RATE / uniqueRares);
  }
  for (const card of nonFoilMythics) {
    ev += card.price * (MYTHIC_RATE / uniqueMythics);
  }

  // Foil slot contribution
  for (const card of foilRares) {
    ev += card.price * (FOIL_RARE_RATE / uniqueFoilRares);
  }
  for (const card of foilMythics) {
    ev += card.price * (FOIL_MYTHIC_RATE / uniqueFoilMythics);
  }

  return ev;
}

// ============ Rendering ============

function getTcgPlayerUrl(setName, boosterType) {
  // Build a TCGPlayer search URL for the booster product
  let searchTerm = setName;
  if (boosterType === 'collector') {
    searchTerm += ' collector booster';
  } else {
    searchTerm += ' booster';
  }
  return 'https://www.tcgplayer.com/search/magic/product?productLineName=magic&q=' + encodeURIComponent(searchTerm) + '&view=grid';
}

function renderCards(cards, rawCards, setInfo, boosterType) {
  const grid = document.getElementById('card-grid');
  const countEl = document.getElementById('card-count');
  const evEl = document.getElementById('pack-ev');

  // Calculate pack EV from raw cards (before filtering)
  const packEV = calculatePackEV(rawCards);

  // Build TCGPlayer link
  const tcgUrl = setInfo ? getTcgPlayerUrl(setInfo.name, boosterType) : null;
  const tcgLink = tcgUrl ? '<a href="' + tcgUrl + '" target="_blank" class="tcg-link">buy on tcgplayer</a>' : '';

  if (cards.length === 0) {
    grid.innerHTML =
      '<div class="no-results">' +
        '<h3>no cards found</h3>' +
        '<p>try lowering the minimum price or switching booster type</p>' +
      '</div>';
    countEl.classList.add('hidden');
    // Still show EV even if no cards match current filters
    if (packEV > 0) {
      evEl.innerHTML = 'pack ev: <span class="ev-value">~$' + packEV.toFixed(2) + '</span> ' + tcgLink;
      evEl.classList.remove('hidden');
    } else {
      evEl.classList.add('hidden');
    }
    return;
  }

  countEl.textContent = 'showing ' + cards.length + ' card' + (cards.length === 1 ? '' : 's');
  countEl.classList.remove('hidden');

  // Display pack EV with TCGPlayer link
  evEl.innerHTML = 'pack ev: <span class="ev-value">~$' + packEV.toFixed(2) + '</span> ' + tcgLink;
  evEl.classList.remove('hidden');

  grid.innerHTML = cards.map(card => {
    const imageUrl = card.image_uris?.normal ||
                     card.card_faces?.[0]?.image_uris?.normal ||
                     '';
    const scryfallUrl = card.scryfall_uri || '#';

    // Build treatment string (without foil since we show it in prices)
    let treatment = card.treatment.toLowerCase().replace(/, ?foil$/i, '').replace(/^foil, ?/i, '').replace(/^foil$/i, '');
    if (!treatment || treatment === 'regular') treatment = '';

    // Build price display with treatment inline
    const priceItems = card.finishPrices
      .map(f => '<span class="finish-price"><span class="finish-type">' + f.type + '</span> $' + f.price.toFixed(2) + '</span>');

    const priceDisplay = treatment
      ? '<span class="card-treatment">' + treatment + '</span> · ' + priceItems.join(' · ')
      : priceItems.join(' · ');

    return '<div class="card" data-url="' + scryfallUrl + '">' +
      '<img class="card-image" src="' + imageUrl + '" alt="' + card.name + '" loading="lazy" />' +
      '<div class="card-info">' +
        '<div class="card-name" title="' + card.name + '">' + card.name.toLowerCase() + '</div>' +
        '<div class="card-prices">' + priceDisplay + '</div>' +
      '</div>' +
    '</div>';
  }).join('');

  grid.querySelectorAll('.card').forEach(card => {
    card.style.cursor = 'pointer';
    card.addEventListener('click', () => {
      window.open(card.dataset.url, '_blank');
    });
  });
}

function setLoading(loading) {
  document.getElementById('loading').classList.toggle('hidden', !loading);
  document.getElementById('card-grid').classList.toggle('hidden', loading);
  if (loading) {
    document.getElementById('card-count').classList.add('hidden');
    document.getElementById('pack-ev').classList.add('hidden');
  }
}

function showError(message) {
  const errorEl = document.getElementById('error');
  errorEl.textContent = message;
  errorEl.classList.remove('hidden');
  document.getElementById('card-grid').classList.add('hidden');
  document.getElementById('card-count').classList.add('hidden');
  document.getElementById('pack-ev').classList.add('hidden');
}

// ============ Main Logic ============

const cardCache = new Map();

async function loadCards() {
  const setCode = document.getElementById('set-select').value;
  const boosterType = document.getElementById('booster-type').value;
  const minPrice = parseFloat(document.getElementById('min-price').value);
  const foilsMode = document.getElementById('foils-mode').value;
  const raresMode = document.getElementById('rares-mode').value;
  const listMode = document.getElementById('list-mode').value;

  if (!setCode) return;

  document.getElementById('error').classList.add('hidden');
  setLoading(true);

  const includeList = listMode === 'include';
  const cacheKey = setCode + '-' + boosterType + '-' + includeList;

  try {
    let allCards;
    if (cardCache.has(cacheKey)) {
      allCards = cardCache.get(cacheKey);
    } else {
      allCards = await fetchSetCards(setCode, boosterType, includeList);
      cardCache.set(cacheKey, allCards);
    }

    const excludeFoils = foilsMode === 'exclude';
    const excludeRares = raresMode === 'exclude';
    const cards = filterAndSortCards(allCards, minPrice, excludeRares, excludeFoils);
    const setInfo = setsData.find(s => s.code === setCode);
    renderCards(cards, allCards, setInfo, boosterType);
  } catch (error) {
    console.error('Error loading cards:', error);
    showError('failed to load cards. please try again.');
  } finally {
    setLoading(false);
  }
}

function onFilterChange() {
  updateURL(getCurrentState());
  loadCards();
}

// ============ Initialization ============

async function init() {
  const setInput = document.getElementById('set-input');
  const setDropdown = document.getElementById('set-dropdown');
  const setHidden = document.getElementById('set-select');

  try {
    // Load sets from shared module
    setsData = await fetchSets();

    // Set up autocomplete using shared module
    autocomplete = createSetAutocomplete({
      inputEl: setInput,
      dropdownEl: setDropdown,
      hiddenEl: setHidden,
      sets: setsData,
      onSelect: handleSetSelect
    });

    setupToggles();
    setInput.disabled = false;
    setInput.placeholder = 'type to search sets...';

    // Read initial state from URL
    const urlState = getStateFromURL();

    // Apply URL state or defaults
    let initialSet = setsData[0];
    if (urlState.set) {
      const foundSet = setsData.find(s => s.code === urlState.set);
      if (foundSet) initialSet = foundSet;
    }

    // Set initial value using autocomplete
    autocomplete.setInitialSet(initialSet);

    // Set booster type options based on set era, then apply URL value
    updateBoosterTypeOptions(initialSet.released, initialSet.code, urlState.booster);

    // Update filter toggles based on what this set has
    updateFilterToggles(initialSet.code, initialSet.released);

    // Set toggles from URL (after updateFilterToggles so visibility is set first)
    setToggleValue('price-toggle', 'min-price', urlState.min);
    setToggleValue('foils-toggle', 'foils-mode', urlState.foils);
    setToggleValue('rares-toggle', 'rares-mode', urlState.rares);
    setToggleValue('list-toggle', 'list-mode', urlState.list);

    // Load initial cards
    await loadCards();

  } catch (error) {
    console.error('Error initializing:', error);
    showError('failed to load sets. please refresh the page.');
  }
}

function handleSetSelect(set) {
  updateBoosterTypeOptions(set.released, set.code);
  updateFilterToggles(set.code, set.released);
  updateURL(getCurrentState());
  loadCards();
}

// ============ Theme Toggle ============

function initTheme() {
  const toggle = document.getElementById('theme-toggle');
  const saved = localStorage.getItem('theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

  // Apply saved theme or system preference
  const theme = saved || (prefersDark ? 'dark' : 'light');
  applyTheme(theme);

  toggle.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    localStorage.setItem('theme', next);
  });
}

function applyTheme(theme) {
  const toggle = document.getElementById('theme-toggle');
  if (theme === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
    toggle.innerHTML = '<span class="theme-icon">☀</span> light';
  } else {
    document.documentElement.removeAttribute('data-theme');
    toggle.innerHTML = '<span class="theme-icon">☽</span> dark';
  }
}

initTheme();
init();
