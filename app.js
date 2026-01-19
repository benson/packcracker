// Scryfall API helpers
const SCRYFALL_API = 'https://api.scryfall.com';

// Key dates for booster type eras
const COLLECTOR_BOOSTER_START = '2019-10-04'; // Throne of Eldraine
const SET_BOOSTER_START = '2020-09-25';       // Zendikar Rising
const PLAY_BOOSTER_START = '2024-02-09';      // Murders at Karlov Manor
const FOIL_START = '1999-02-15';              // Urza's Legacy (first set with foils)

// Special Guests collector number ranges by set
// These can be queried from Scryfall: set:spg cn>=X cn<=Y
const SPECIAL_GUESTS_RANGES = {
  'lci': [1, 18],
  'mkm': [19, 28],
  'otj': [29, 38],
  'mh3': [39, 53],
  'blb': [54, 63],
  'dsk': [64, 73],
  'fdn': [74, 83],
  'dft': [84, 103],
  'tdm': [104, 118],
  'eoe': [119, 128],
  // Future sets - update as needed
  'fin': [129, 148],  // Placeholder range
};

// Sets that have The Big Score cards (OTJ only)
const SETS_WITH_BIG_SCORE = new Set(['otj']);

// Sets where we can accurately show Special Guests (Play Booster era)
// For Set Booster era (znr-lci), The List is too complex to track accurately
const SETS_WITH_SPECIAL_GUESTS = new Set(Object.keys(SPECIAL_GUESTS_RANGES));

// Rate limiting: Scryfall asks for 50-100ms between requests
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Fetch with retry logic
async function fetchWithRetry(url, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url);
      if (response.status === 429) {
        await delay(1000);
        continue;
      }
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      if (i === retries - 1) throw error;
      await delay(100 * (i + 1));
    }
  }
}

// Load sets from static JSON file
async function fetchSets() {
  const response = await fetch('./sets.json');
  return await response.json();
}

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
    ? `${window.location.pathname}?${params.toString()}`
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

// ============ Autocomplete ============

let setsData = [];
let highlightedIndex = -1;
let selectedSetDisplay = ''; // Store the display text for the selected set

function setupAutocomplete() {
  const input = document.getElementById('set-input');
  const dropdown = document.getElementById('set-dropdown');
  const hidden = document.getElementById('set-select');

  // Clear input on focus so user can start typing immediately
  input.addEventListener('focus', () => {
    selectedSetDisplay = input.value; // Remember current value
    input.value = '';
    input.placeholder = 'type to search...';
    showDropdown('');
  });

  // Restore selected value on blur if nothing new was selected
  input.addEventListener('blur', () => {
    // Small delay to allow click on dropdown option to register
    setTimeout(() => {
      if (!input.value && selectedSetDisplay) {
        input.value = selectedSetDisplay;
        input.placeholder = '';
      }
    }, 150);
  });

  // Filter on input
  input.addEventListener('input', () => {
    highlightedIndex = -1;
    showDropdown(input.value);
  });

  // Keyboard navigation
  input.addEventListener('keydown', (e) => {
    const options = dropdown.querySelectorAll('.option');

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      highlightedIndex = Math.min(highlightedIndex + 1, options.length - 1);
      updateHighlight(options);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      highlightedIndex = Math.max(highlightedIndex - 1, 0);
      updateHighlight(options);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (highlightedIndex >= 0 && options[highlightedIndex]) {
        selectSet(options[highlightedIndex].dataset.code);
      }
    } else if (e.key === 'Escape') {
      dropdown.classList.add('hidden');
      input.blur();
    }
  });

  // Close dropdown when clicking outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.autocomplete-wrapper')) {
      dropdown.classList.add('hidden');
    }
  });
}

function updateHighlight(options) {
  options.forEach((opt, i) => {
    opt.classList.toggle('highlighted', i === highlightedIndex);
  });
  if (options[highlightedIndex]) {
    options[highlightedIndex].scrollIntoView({ block: 'nearest' });
  }
}

function showDropdown(filter) {
  const dropdown = document.getElementById('set-dropdown');
  const filterLower = filter.toLowerCase();

  const filtered = setsData.filter(set =>
    set.name.toLowerCase().includes(filterLower) ||
    set.code.toLowerCase().includes(filterLower)
  ).slice(0, 50); // Limit to 50 results

  if (filtered.length === 0) {
    dropdown.classList.add('hidden');
    return;
  }

  dropdown.innerHTML = filtered.map(set => `
    <div class="option" data-code="${set.code}">
      ${set.name.toLowerCase()}<span class="year">(${set.released.slice(0, 4)})</span>
    </div>
  `).join('');

  dropdown.querySelectorAll('.option').forEach(opt => {
    opt.addEventListener('click', () => selectSet(opt.dataset.code));
  });

  dropdown.classList.remove('hidden');
}

function selectSet(code) {
  const set = setsData.find(s => s.code === code);
  if (!set) return;

  const input = document.getElementById('set-input');
  const dropdown = document.getElementById('set-dropdown');
  const hidden = document.getElementById('set-select');

  const displayText = `${set.name.toLowerCase()} (${set.released.slice(0, 4)})`;
  input.value = displayText;
  selectedSetDisplay = displayText;
  hidden.value = code;
  dropdown.classList.add('hidden');
  highlightedIndex = -1;
  input.blur();

  updateBoosterTypeOptions(set.released);
  updateFilterToggles(code, set.released);
  updateURL(getCurrentState());
  loadCards();
}

// ============ Toggle Buttons ============

function setupToggles() {
  // Booster type toggle
  const boosterToggle = document.getElementById('booster-toggle');
  const boosterHidden = document.getElementById('booster-type');

  boosterToggle.addEventListener('click', (e) => {
    const btn = e.target.closest('.toggle-btn');
    if (!btn || boosterToggle.classList.contains('single')) return;

    boosterToggle.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    boosterHidden.value = btn.dataset.value;
    onFilterChange();
  });

  // Price toggle
  const priceToggle = document.getElementById('price-toggle');
  const priceHidden = document.getElementById('min-price');

  priceToggle.addEventListener('click', (e) => {
    const btn = e.target.closest('.toggle-btn');
    if (!btn) return;

    priceToggle.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    priceHidden.value = btn.dataset.value;
    onFilterChange();
  });

  // Foils toggle
  const foilsToggle = document.getElementById('foils-toggle');
  const foilsHidden = document.getElementById('foils-mode');

  foilsToggle.addEventListener('click', (e) => {
    const btn = e.target.closest('.toggle-btn');
    if (!btn) return;

    foilsToggle.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    foilsHidden.value = btn.dataset.value;
    onFilterChange();
  });

  // Rares toggle
  const raresToggle = document.getElementById('rares-toggle');
  const raresHidden = document.getElementById('rares-mode');

  raresToggle.addEventListener('click', (e) => {
    const btn = e.target.closest('.toggle-btn');
    if (!btn) return;

    raresToggle.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    raresHidden.value = btn.dataset.value;
    onFilterChange();
  });

  // List toggle
  const listToggle = document.getElementById('list-toggle');
  const listHidden = document.getElementById('list-mode');

  listToggle.addEventListener('click', (e) => {
    const btn = e.target.closest('.toggle-btn');
    if (!btn) return;

    listToggle.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    listHidden.value = btn.dataset.value;
    onFilterChange();
  });
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

function updateBoosterTypeOptions(releaseDate, preserveValue = null) {
  const boosterToggle = document.getElementById('booster-toggle');
  const boosterHidden = document.getElementById('booster-type');
  const era = getBoosterEra(releaseDate);

  if (era === 'draft') {
    // Single option - no toggle needed
    boosterToggle.innerHTML = '<button type="button" class="toggle-btn active" data-value="play">draft booster</button>';
    boosterToggle.classList.add('single');
    boosterHidden.value = 'play';
  } else if (era === 'set') {
    boosterToggle.innerHTML = `
      <button type="button" class="toggle-btn active" data-value="play">draft / set</button>
      <button type="button" class="toggle-btn" data-value="collector">collector</button>
    `;
    boosterToggle.classList.remove('single');
  } else {
    boosterToggle.innerHTML = `
      <button type="button" class="toggle-btn active" data-value="play">play</button>
      <button type="button" class="toggle-btn" data-value="collector">collector</button>
    `;
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
async function fetchSetCards(setCode, boosterType, minPrice, includeSpecialGuests) {
  // Try cached data first
  try {
    const cached = await fetchCachedCards(setCode, boosterType);
    if (cached && cached.length > 0) {
      console.log(`Loaded ${cached.length} cards from cache for ${setCode}`);

      // If includeSpecialGuests, also get cached Special Guests cards
      if (includeSpecialGuests && SETS_WITH_SPECIAL_GUESTS.has(setCode)) {
        const specialGuestsCards = await fetchCachedSpecialGuestsCards(setCode);
        return [...cached, ...specialGuestsCards];
      }
      return cached;
    }
  } catch (e) {
    console.log(`Cache miss for ${setCode}, fetching live...`);
  }

  // Fall back to live API
  return fetchLiveCards(setCode, boosterType, minPrice, includeSpecialGuests);
}

// Fetch from pre-cached JSON files
async function fetchCachedCards(setCode, boosterType) {
  const response = await fetch(`./data/${setCode}.json`);
  if (!response.ok) return null;

  const data = await response.json();
  const cards = boosterType === 'collector' ? data.collector : data.play;

  // Convert cached format back to Scryfall-like format for compatibility
  return cards.map(card => ({
    id: card.id,
    name: card.name,
    set: card.set,
    rarity: card.rarity,
    booster: card.booster,
    image_uris: { normal: card.image },
    scryfall_uri: card.uri,
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
    ].filter(Boolean),
    border_color: card.borderless ? 'borderless' : 'black',
    full_art: card.fullart,
    promo: card.promo,
  }));
}

// Fetch cached Special Guests cards for a specific set
async function fetchCachedSpecialGuestsCards(setCode) {
  const cards = [];
  const range = SPECIAL_GUESTS_RANGES[setCode];

  // Try to fetch from spg cache file
  try {
    const response = await fetch(`./data/spg.json`);
    if (response.ok) {
      const data = await response.json();
      const allCards = data.collector || data.play || [];

      // Filter to only cards in this set's collector number range
      const filtered = allCards.filter(card => {
        const cn = parseInt(card.collector_number || '0');
        return cn >= range[0] && cn <= range[1];
      });

      cards.push(...filtered.map(card => ({
        id: card.id,
        name: card.name,
        set: card.set,
        rarity: card.rarity,
        collector_number: card.collector_number,
        booster: card.booster,
        image_uris: { normal: card.image },
        scryfall_uri: card.uri,
        finishes: card.finishes.map(f => f.type),
        prices: {
          usd: card.finishes.find(f => f.type === 'nonfoil')?.price?.toString() || null,
          usd_foil: card.finishes.find(f => f.type === 'foil')?.price?.toString() || null,
          usd_etched: card.finishes.find(f => f.type === 'etched')?.price?.toString() || null,
        },
        frame_effects: [],
        border_color: 'black',
        full_art: false,
        promo: false,
      })));
    }
  } catch (e) {
    // Ignore missing cache files
  }

  // For OTJ, also fetch The Big Score
  if (SETS_WITH_BIG_SCORE.has(setCode)) {
    try {
      const response = await fetch(`./data/big.json`);
      if (response.ok) {
        const data = await response.json();
        const bigScoreCards = data.collector || data.play || [];
        cards.push(...bigScoreCards.map(card => ({
          id: card.id,
          name: card.name,
          set: card.set,
          rarity: card.rarity,
          booster: card.booster,
          image_uris: { normal: card.image },
          scryfall_uri: card.uri,
          finishes: card.finishes.map(f => f.type),
          prices: {
            usd: card.finishes.find(f => f.type === 'nonfoil')?.price?.toString() || null,
            usd_foil: card.finishes.find(f => f.type === 'foil')?.price?.toString() || null,
            usd_etched: card.finishes.find(f => f.type === 'etched')?.price?.toString() || null,
          },
          frame_effects: [],
          border_color: 'black',
          full_art: false,
          promo: false,
        })));
      }
    } catch (e) {
      // Ignore missing cache files
    }
  }

  return cards;
}

// Live fetch from Scryfall API
async function fetchLiveCards(setCode, boosterType, minPrice, includeSpecialGuests) {
  let query = `set:${setCode} lang:en`;

  if (boosterType !== 'collector') {
    // For Play Boosters, exclude Collector Booster exclusives
    // is:booster alone isn't reliable, so also exclude "boosterfun" variants
    // (showcase, extended art, borderless, textured foil, etc.)
    query += ' is:booster -is:boosterfun';
  }

  const priceThreshold = Math.max(0.5, minPrice - 0.5);
  query += ` (usd>=${priceThreshold} OR usd_foil>=${priceThreshold})`;

  const url = `${SCRYFALL_API}/cards/search?q=${encodeURIComponent(query)}&unique=prints&order=usd&dir=desc`;

  let cards = [];
  try {
    const data = await fetchWithRetry(url);
    cards = data.data;
  } catch (error) {
    if (error.message !== 'HTTP 404') throw error;
  }

  if (includeSpecialGuests && SETS_WITH_SPECIAL_GUESTS.has(setCode)) {
    const specialGuestsCards = await fetchLiveSpecialGuestsCards(setCode, minPrice);
    cards = cards.concat(specialGuestsCards);
  }

  return cards;
}

// Live fetch for Special Guests (and Big Score for OTJ)
async function fetchLiveSpecialGuestsCards(setCode, minPrice) {
  const priceThreshold = Math.max(0.5, minPrice - 0.5);
  let allCards = [];

  // Fetch Special Guests by collector number range
  const range = SPECIAL_GUESTS_RANGES[setCode];
  if (range) {
    try {
      const query = `set:spg cn>=${range[0]} cn<=${range[1]} (usd>=${priceThreshold} OR usd_foil>=${priceThreshold})`;
      const url = `${SCRYFALL_API}/cards/search?q=${encodeURIComponent(query)}&unique=prints&order=usd&dir=desc`;
      const data = await fetchWithRetry(url);
      allCards = allCards.concat(data.data || []);
    } catch (error) {
      // Ignore 404s (no matching cards)
    }
  }

  // For OTJ, also fetch The Big Score cards
  if (SETS_WITH_BIG_SCORE.has(setCode)) {
    try {
      const query = `set:big (usd>=${priceThreshold} OR usd_foil>=${priceThreshold})`;
      const url = `${SCRYFALL_API}/cards/search?q=${encodeURIComponent(query)}&unique=prints&order=usd&dir=desc`;
      const data = await fetchWithRetry(url);
      allCards = allCards.concat(data.data || []);
    } catch (error) {
      // Ignore 404s
    }
  }

  return allCards;
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

function expandCardFinishes(cards) {
  const expanded = [];

  for (const card of cards) {
    const prices = card.prices || {};
    const finishes = card.finishes || [];

    if (finishes.includes('nonfoil') && prices.usd) {
      const price = parseFloat(prices.usd);
      if (price > 0) {
        expanded.push({
          ...card,
          price,
          isFoil: false,
          treatment: getCardTreatment(card, false),
          finishKey: 'nonfoil'
        });
      }
    }

    if (finishes.includes('foil') && prices.usd_foil) {
      const price = parseFloat(prices.usd_foil);
      if (price > 0) {
        expanded.push({
          ...card,
          price,
          isFoil: true,
          treatment: getCardTreatment(card, true),
          finishKey: 'foil'
        });
      }
    }

    if (finishes.includes('etched') && prices.usd_etched) {
      const price = parseFloat(prices.usd_etched);
      if (price > 0) {
        expanded.push({
          ...card,
          price,
          isFoil: false,
          treatment: getCardTreatment(card, false).replace('Regular', 'Etched') || 'Etched',
          finishKey: 'etched'
        });
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

  // Play Booster rare/mythic slot: ~87.5% rare, ~12.5% mythic (roughly 7:1)
  const RARE_RATE = 0.875;
  const MYTHIC_RATE = 0.125;

  // Calculate EV for rare/mythic slot (non-foil)
  let ev = 0;

  // Each rare has equal probability: RARE_RATE / uniqueRares
  for (const card of nonFoilRares) {
    ev += card.price * (RARE_RATE / uniqueRares);
  }

  // Each mythic has equal probability: MYTHIC_RATE / uniqueMythics
  for (const card of nonFoilMythics) {
    ev += card.price * (MYTHIC_RATE / uniqueMythics);
  }

  // Foil slot contribution (roughly 1 in 6 packs has a rare/mythic foil)
  // Simplified: ~10% chance of rare foil, ~2% chance of mythic foil
  const uniqueFoilRares = new Set(foilRares.map(c => c.id)).size || 1;
  const uniqueFoilMythics = new Set(foilMythics.map(c => c.id)).size || 1;

  for (const card of foilRares) {
    ev += card.price * (0.10 / uniqueFoilRares);
  }
  for (const card of foilMythics) {
    ev += card.price * (0.02 / uniqueFoilMythics);
  }

  return ev;
}

// ============ Rendering ============

function renderCards(cards, rawCards) {
  const grid = document.getElementById('card-grid');
  const countEl = document.getElementById('card-count');
  const evEl = document.getElementById('pack-ev');

  // Calculate pack EV from raw cards (before filtering)
  const packEV = calculatePackEV(rawCards);

  if (cards.length === 0) {
    grid.innerHTML = `
      <div class="no-results">
        <h3>no cards found</h3>
        <p>try lowering the minimum price or switching booster type</p>
      </div>
    `;
    countEl.classList.add('hidden');
    // Still show EV even if no cards match current filters
    if (packEV > 0) {
      evEl.innerHTML = `pack ev: <span class="ev-value">~$${packEV.toFixed(2)}</span>`;
      evEl.classList.remove('hidden');
    } else {
      evEl.classList.add('hidden');
    }
    return;
  }

  countEl.textContent = `showing ${cards.length} card${cards.length === 1 ? '' : 's'}`;
  countEl.classList.remove('hidden');

  // Display pack EV
  evEl.innerHTML = `pack ev: <span class="ev-value">~$${packEV.toFixed(2)}</span>`;
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
      .map(f => `<span class="finish-price"><span class="finish-type">${f.type}</span> $${f.price.toFixed(2)}</span>`);

    const priceDisplay = treatment
      ? `<span class="card-treatment">${treatment}</span> · ${priceItems.join(' · ')}`
      : priceItems.join(' · ');

    return `
      <div class="card" data-url="${scryfallUrl}">
        <img
          class="card-image"
          src="${imageUrl}"
          alt="${card.name}"
          loading="lazy"
        />
        <div class="card-info">
          <div class="card-name" title="${card.name}">${card.name.toLowerCase()}</div>
          <div class="card-prices">${priceDisplay}</div>
        </div>
      </div>
    `;
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
  const cacheKey = `${setCode}-${boosterType}-${minPrice}-${includeList}`;

  try {
    let rawCards;
    if (cardCache.has(cacheKey)) {
      rawCards = cardCache.get(cacheKey);
    } else {
      rawCards = await fetchSetCards(setCode, boosterType, minPrice, includeList);
      cardCache.set(cacheKey, rawCards);
    }

    const excludeFoils = foilsMode === 'exclude';
    const excludeRares = raresMode === 'exclude';
    const cards = filterAndSortCards(rawCards, minPrice, excludeRares, excludeFoils);
    renderCards(cards, rawCards);
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
    // Load sets
    setsData = await fetchSets();

    // Set up autocomplete and toggles
    setupAutocomplete();
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

    // Set initial values
    const initialDisplay = `${initialSet.name.toLowerCase()} (${initialSet.released.slice(0, 4)})`;
    setInput.value = initialDisplay;
    selectedSetDisplay = initialDisplay;
    setHidden.value = initialSet.code;

    // Set booster type options based on set era, then apply URL value
    updateBoosterTypeOptions(initialSet.released, urlState.booster);

    // Update filter toggles based on what this set has
    updateFilterToggles(initialSet.code, initialSet.released);

    // Set toggles from URL (after updateFilterToggles so visibility is set first)
    setToggleValue('price-toggle', 'min-price', urlState.min);
    setToggleValue('foils-toggle', 'foils-mode', urlState.foils);
    setToggleValue('rares-toggle', 'rares-mode', urlState.rares);
    setToggleValue('list-toggle', 'list-mode', urlState.list);

    // Load initial cards
    await loadCards();

    // Auto-focus the set input
    setInput.focus();

  } catch (error) {
    console.error('Error initializing:', error);
    showError('failed to load sets. please refresh the page.');
  }
}

init();
