// Pack Cracker - MTG Booster Value Guide
import {
  fetchSets,
  fetchWithRetry,
  COLLECTOR_BOOSTER_START,
  PLAY_BOOSTER_START,
  FOIL_START,
  JUMPSTART_SETS,
  DRAFT_ONLY_SETS,
  fetchSetCards as fetchMtgjsonCards,
  calculateBoosterExpectedValues,
} from 'https://bensonperry.com/shared/mtg.js';
import { combobox } from './vendor/vellum-ui/combobox.js';
import { mountFeedbackCapture } from './vendor/vellum-ui/feedbackCapture.js';
import { initTheme, themeToggle } from './vendor/vellum-ui/themeToggle.js';

const SCRYFALL_API = 'https://api.scryfall.com';

// Feedback: files to the packcracker Linear project via the biblioplex worker.
// Shows for everyone; the worker gates submissions on the site origin.
mountFeedbackCapture({
  project: 'packcracker',
  apiUrl: 'https://biblioplex-api.bensonperry.com',
});

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
let selectedSetDisplay = '';

// Card language toggle — swaps card art to the japanese printing (matched by
// collector number). Prices stay english; scryfall has no japanese prices.
let jpMode = false;
const jpImageCache = new Map();   // setCode -> Map(collector_number -> ja image url)
let currentJpImages = new Map();

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
  const setInfo = setsData.find(s => s.code === setCode);
  const boosterTypes = setInfo?.boosterTypes || [];

  if (boosterTypes.length > 0) {
    const buttons = [];
    const defaultValue = boosterTypes.includes(preserveValue) ? preserveValue : (setInfo.defaultBoosterType || boosterTypes[0]);

    if (boosterTypes.includes('play')) {
      const label = setInfo.limitedLabel || 'play';
      buttons.push('<button type="button" class="toggle-btn' + (defaultValue === 'play' ? ' active' : '') + '" data-value="play">' + label + '</button>');
    }
    if (boosterTypes.includes('collector')) {
      buttons.push('<button type="button" class="toggle-btn' + (defaultValue === 'collector' ? ' active' : '') + '" data-value="collector">collector</button>');
    }

    boosterToggle.innerHTML = buttons.join('');
    boosterToggle.classList.toggle('single', buttons.length <= 1);
    boosterHidden.value = defaultValue;
    return;
  }

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

  const setInfo = setsData.find(s => s.code === setCode);
  const extraSheetLabel = setInfo?.extraSheetLabel;
  const hasFoils = releaseDate >= FOIL_START;

  // Update The List / Special Guests toggle from MTGJSON sheet metadata.
  if (extraSheetLabel) {
    listToggleGroup.classList.remove('hidden');
    listLabel.textContent = extraSheetLabel;
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
    const cached = await fetchCachedCards(setCode, boosterType, includeSpecialGuests);
    if (cached && cached.length > 0) {
      console.log('Loaded ' + cached.length + ' cards from cache for ' + setCode);
      cards = cached;
    }
  } catch (e) {
    console.log('Cache miss for ' + setCode + ', fetching live...');
  }

  // Fall back to live API if no cache
  if (cards.length === 0) {
    cards = await fetchLiveCards(setCode, boosterType, includeSpecialGuests);
  } else {
    await backfillPackOdds(cards, setCode, boosterType);
  }

  return cards;
}

// Older cached JSON predates per-finish pack odds, which zeroes out pack EV.
// Backfill odds from the shared MTGJSON booster config (one small fetch, no
// Scryfall), matching cards by Scryfall id.
async function backfillPackOdds(cards, setCode, boosterType) {
  const hasOdds = card =>
    (card._packOdds || 0) > 0 ||
    Object.values(card._finishOdds || {}).some(odds => odds > 0);
  if (cards.some(hasOdds)) return;

  try {
    const odds = await calculateBoosterExpectedValues(setCode, boosterType);
    const byScryfallId = new Map();
    for (const entry of Object.values(odds.cards || {})) {
      const sid = entry.card?.identifiers?.scryfallId;
      if (sid) byScryfallId.set(sid, entry);
    }
    for (const card of cards) {
      const entry = byScryfallId.get(card.id);
      if (!entry) continue;
      card._finishOdds = { ...entry.finishes };
      card._packOdds = entry.expectedCopies || 0;
    }
  } catch (error) {
    console.warn('pack odds backfill failed for ' + setCode + ':', error.message);
  }
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
    finishes: card.finishes.map(f => f.type),
    _finishOdds: Object.fromEntries((card.finishes || []).map(f => [f.type, f.packOdds || 0])),
    _packOdds: card.packOdds || 0,
    _mtgjsonUuid: card.uuid || null,
    _isExtra: card.isExtra || false,
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
async function fetchCachedCards(setCode, boosterType, includeExtras = false) {
  const response = await fetch('./data/' + setCode + '.json');
  if (!response.ok) return null;

  const data = await response.json();
  const cards = boosterType === 'collector'
    ? (data.collector || [])
    : [
        ...(data.play || []),
        ...(includeExtras ? (data.extras || []) : [])
      ];

  return cards.map(convertCachedCard);
}

// Live fetch from Scryfall API
async function fetchLiveCards(setCode, boosterType, includeSpecialGuests) {
  try {
    return await fetchMtgjsonCards(setCode, boosterType, {
      minPrice: 0,
      includeSpecialGuests,
    });
  } catch (error) {
    console.warn('MTGJSON live fetch failed, falling back to Scryfall search:', error.message);
  }

  const query = 'set:' + setCode + ' lang:en (usd>=0.5 OR usd_foil>=0.5)';
  const url = SCRYFALL_API + '/cards/search?q=' + encodeURIComponent(query) + '&unique=prints&order=usd&dir=desc';
  try {
    const data = await fetchWithRetry(url);
    return data.data || [];
  } catch (error) {
    if (error.message === 'HTTP 404') return [];
    throw error;
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
  if (card.set === 'big') treatments.push('The Big Score');
  if (card._isExtra && card.set !== 'plst' && card.set !== 'spg' && card.set !== 'big') treatments.push('Extra Sheet');

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
          const packOdds = card._finishOdds?.[finish.key] || card._packOdds || 0;
          expanded.push({ ...card, price, isFoil: finish.isFoil, treatment, finishKey: finish.key, packOdds });
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

// Calculate expected value of opening a pack from MTGJSON-derived per-finish odds.
function calculatePackEV(cards) {
  const expanded = expandCardFinishes(cards);
  return expanded.reduce((ev, card) => ev + (card.price * (card.packOdds || 0)), 0);
}

// ============ Card Language (Japanese art) ============

// Fetch japanese-language card images for a set, keyed by collector number.
// Only swaps art — prices stay english (scryfall carries no japanese prices).
async function fetchJapaneseImages(setCode) {
  if (jpImageCache.has(setCode)) return jpImageCache.get(setCode);

  const map = new Map();
  try {
    let url = SCRYFALL_API + '/cards/search?q=' +
      encodeURIComponent('set:' + setCode + ' lang:ja') + '&unique=prints';
    while (url) {
      const data = await fetchWithRetry(url);
      for (const card of (data.data || [])) {
        const img = card.image_uris?.normal || card.card_faces?.[0]?.image_uris?.normal;
        if (img) map.set(card.collector_number, img);
      }
      url = data.has_more ? data.next_page : null;
    }
  } catch (e) {
    // no japanese printings for this set (404) — leave map empty
  }

  jpImageCache.set(setCode, map);
  return map;
}

// Swap rendered card images between english (data-en-src) and japanese
function applyImageLanguage() {
  document.querySelectorAll('#card-grid .card').forEach(cardEl => {
    const img = cardEl.querySelector('.card-img');
    if (!img) return;
    const en = img.dataset.enSrc;
    if (jpMode) {
      const ja = currentJpImages.get(cardEl.dataset.cn);
      img.src = ja || en;
      cardEl.classList.toggle('jp-missing', !ja);
    } else {
      img.src = en;
      cardEl.classList.remove('jp-missing');
    }
  });
}

async function setJpMode(on) {
  jpMode = on;
  document.body.classList.toggle('jp-mode', on);
  if (on) {
    const setCode = document.getElementById('set-select').value;
    currentJpImages = await fetchJapaneseImages(setCode);
  }
  applyImageLanguage();
}

function initLang() {
  document.addEventListener('keydown', (e) => {
    if (!e.key || e.key.toLowerCase() !== 'j' || e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    e.preventDefault();
    setJpMode(!jpMode);
  });
}

// Build a tcgplayer search url pre-filtered to japanese listings for a single card
function getJpListingUrl(card, setInfo) {
  const terms = card.name + (setInfo ? ' ' + setInfo.name : '');
  return 'https://www.tcgplayer.com/search/magic/product?productLineName=magic&q=' +
    encodeURIComponent(terms) + '&Language=Japanese&view=grid';
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

  // Display pack EV with TCGPlayer link; never show a false $0.00
  const evFigure = packEV > 0 ? '~$' + packEV.toFixed(2) : '—';
  evEl.innerHTML = '<span class="ev-label">pack ev</span><span class="ev-value">' + evFigure + '</span> ' + tcgLink;
  evEl.classList.remove('hidden');

  if (cards.length === 0) {
    grid.innerHTML =
      '<div class="no-results">' +
        '<h3>no cards found</h3>' +
        '<p>try lowering the minimum price or switching booster type</p>' +
      '</div>';
    countEl.classList.add('hidden');
    return;
  }

  countEl.textContent = 'showing ' + cards.length + ' card' + (cards.length === 1 ? '' : 's');
  countEl.classList.remove('hidden');

  grid.innerHTML = cards.map(card => {
    const imageUrl = card.image_uris?.normal ||
                     card.card_faces?.[0]?.image_uris?.normal ||
                     '';
    const scryfallUrl = card.scryfall_uri || '#';

    // Build treatment string (without foil since we show it in prices)
    let treatment = card.treatment.toLowerCase().replace(/, ?foil$/i, '').replace(/^foil, ?/i, '').replace(/^foil$/i, '');
    if (!treatment || treatment === 'regular') treatment = '';

    // Price-first caption: prices on their own line (highest first, in full
    // text color), treatment demoted to a faint third line
    const priceItems = card.finishPrices
      .map(f => '<span class="finish-price"><span class="finish-amount">$' + f.price.toFixed(2) + '</span> <span class="finish-type">' + f.type + '</span></span>');

    const treatmentLine = treatment
      ? '<div class="card-treatment">' + treatment + '</div>'
      : '';

    const jpUrl = getJpListingUrl(card, setInfo);

    return '<div class="card" data-url="' + scryfallUrl + '" data-cn="' + (card.collector_number || '') + '">' +
      '<div class="card-image"><img class="card-img" src="' + imageUrl + '" data-en-src="' + imageUrl + '" alt="' + card.name + '" loading="lazy" /></div>' +
      '<div class="card-info">' +
        '<div class="card-name" title="' + card.name + '">' + card.name.toLowerCase() + '</div>' +
        '<div class="card-prices">' + priceItems.join(' · ') + '</div>' +
        treatmentLine +
        '<a class="jp-link" href="' + jpUrl + '" target="_blank" rel="noopener">jp listings ↗</a>' +
      '</div>' +
    '</div>';
  }).join('');

  grid.querySelectorAll('.card').forEach(card => {
    card.style.cursor = 'pointer';
    card.addEventListener('click', (e) => {
      if (e.target.closest('.jp-link')) return;
      window.open(card.dataset.url, '_blank');
    });
  });

  // Fade each image in as it loads (cached images show immediately)
  grid.querySelectorAll('.card-img').forEach(img => {
    if (img.complete && img.naturalWidth > 0) {
      img.classList.add('loaded');
    } else {
      img.addEventListener('load', () => img.classList.add('loaded'), { once: true });
    }
  });

  // keep card art in the selected language after a re-render
  applyImageLanguage();
}

function setLoading(loading) {
  document.getElementById('loading').classList.toggle('hidden', !loading);
  document.getElementById('card-grid').classList.toggle('hidden', loading);
  if (loading) {
    document.getElementById('card-count').classList.add('hidden');
    // EV placeholder while computing — never a plausible-but-false $0.00
    const evEl = document.getElementById('pack-ev');
    evEl.innerHTML = '<span class="ev-label">pack ev</span><span class="ev-value">—</span>';
    evEl.classList.remove('hidden');
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

    // refresh japanese art for the current set if the toggle is on
    if (jpMode) {
      currentJpImages = await fetchJapaneseImages(setCode);
      applyImageLanguage();
    }
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
  const setHidden = document.getElementById('set-select');

  try {
    // Load sets from shared module, only show released or upcoming (within 7 days)
    const cutoff = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    setsData = (await fetchSets()).filter(s => s.released <= cutoff);

    // Set search via vellum combobox
    setupSetCombobox(setInput, setHidden);

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

    // Set initial value
    applySetSelection(initialSet);

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

function formatSetDisplay(set) {
  return set.name.toLowerCase() + ' (' + set.released.slice(0, 4) + ')';
}

function applySetSelection(set) {
  selectedSetDisplay = formatSetDisplay(set);
  const setInput = document.getElementById('set-input');
  const setHidden = document.getElementById('set-select');
  setInput.value = selectedSetDisplay;
  setHidden.value = set.code;
}

function setupSetCombobox(setInput, setHidden) {
  // Stash the chosen set's display text and clear on focus so the list opens
  // unfiltered. Registered before combobox() so its focus refresh sees the
  // cleared value.
  setInput.addEventListener('focus', () => {
    if (setInput.value) selectedSetDisplay = setInput.value;
    setInput.value = '';
  });
  setInput.addEventListener('blur', () => {
    setTimeout(() => {
      if (!setInput.value && selectedSetDisplay) setInput.value = selectedSetDisplay;
    }, 150);
  });
  combobox(setInput, {
    getItems: query => {
      const filter = query.toLowerCase();
      return setsData.filter(
        s => s.name.toLowerCase().includes(filter) || s.code.toLowerCase().includes(filter)
      );
    },
    onSelect: set => {
      applySetSelection(set);
      setInput.blur();
      handleSetSelect(set);
    },
    toLabel: set => set.name.toLowerCase(),
    toHint: set => '(' + set.released.slice(0, 4) + ')',
    toDataset: set => ({ code: set.code }),
    maxItems: 200,
  });
}

function handleSetSelect(set) {
  updateBoosterTypeOptions(set.released, set.code);
  updateFilterToggles(set.code, set.released);
  updateURL(getCurrentState());
  loadCards();
}

// ============ Theme Toggle ============
// Dark mode rides vellum's [data-theme] layer; the preference stays under the
// legacy 'theme' storage key so existing users keep their setting.
initTheme({ storageKey: 'theme' });
themeToggle(document.getElementById('theme-toggle-input'), { storageKey: 'theme' });

initLang();
init();
