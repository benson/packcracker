// Scryfall API helpers
const SCRYFALL_API = 'https://api.scryfall.com';

// Key dates for booster type eras
const COLLECTOR_BOOSTER_START = '2019-10-04'; // Throne of Eldraine
const SET_BOOSTER_START = '2020-09-25';       // Zendikar Rising
const PLAY_BOOSTER_START = '2024-02-09';      // Murders at Karlov Manor

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
    excludeRares: params.get('excludeRares') === 'true',
    includeList: params.get('includeList') === 'true'
  };
}

function updateURL(state) {
  const params = new URLSearchParams();
  if (state.set) params.set('set', state.set);
  if (state.booster !== 'play') params.set('booster', state.booster);
  if (state.min !== '2') params.set('min', state.min);
  if (state.excludeRares) params.set('excludeRares', 'true');
  if (state.includeList) params.set('includeList', 'true');

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
    excludeRares: document.getElementById('exclude-rares').checked,
    includeList: document.getElementById('include-list').checked
  };
}

// ============ Autocomplete ============

let setsData = [];
let highlightedIndex = -1;

function setupAutocomplete() {
  const input = document.getElementById('set-input');
  const dropdown = document.getElementById('set-dropdown');
  const hidden = document.getElementById('set-select');

  // Select all and show dropdown on focus
  input.addEventListener('focus', () => {
    input.select();
    showDropdown(input.value);
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

  input.value = `${set.name.toLowerCase()} (${set.released.slice(0, 4)})`;
  hidden.value = code;
  dropdown.classList.add('hidden');
  highlightedIndex = -1;

  updateBoosterTypeOptions(set.released);
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

// ============ Card Fetching & Filtering ============

// Try to load from cache first, fall back to live API
async function fetchSetCards(setCode, boosterType, minPrice, includeList) {
  // Try cached data first
  try {
    const cached = await fetchCachedCards(setCode, boosterType);
    if (cached && cached.length > 0) {
      console.log(`Loaded ${cached.length} cards from cache for ${setCode}`);

      // If includeList, also get cached list cards
      if (includeList) {
        const listCards = await fetchCachedListCards();
        return [...cached, ...listCards];
      }
      return cached;
    }
  } catch (e) {
    console.log(`Cache miss for ${setCode}, fetching live...`);
  }

  // Fall back to live API
  return fetchLiveCards(setCode, boosterType, minPrice, includeList);
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

// Fetch cached list/special guests cards
async function fetchCachedListCards() {
  const listCards = [];

  for (const setCode of ['plst', 'spg']) {
    try {
      const response = await fetch(`./data/${setCode}.json`);
      if (response.ok) {
        const data = await response.json();
        const cards = data.collector || data.play || [];
        listCards.push(...cards.map(card => ({
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

  return listCards;
}

// Live fetch from Scryfall API
async function fetchLiveCards(setCode, boosterType, minPrice, includeList) {
  let query = `set:${setCode} lang:en`;

  if (boosterType !== 'collector') {
    query += ' is:booster';
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

  if (includeList) {
    const listCards = await fetchLiveListCards(minPrice);
    cards = cards.concat(listCards);
  }

  return cards;
}

// Live fetch for list/special guests
async function fetchLiveListCards(minPrice) {
  const priceThreshold = Math.max(0.5, minPrice - 0.5);
  const listQueries = [
    `set:plst (usd>=${priceThreshold} OR usd_foil>=${priceThreshold})`,
    `set:spg (usd>=${priceThreshold} OR usd_foil>=${priceThreshold})`
  ];

  let allListCards = [];

  for (const query of listQueries) {
    try {
      const url = `${SCRYFALL_API}/cards/search?q=${encodeURIComponent(query)}&unique=prints&order=usd&dir=desc`;
      const data = await fetchWithRetry(url);
      allListCards = allListCards.concat(data.data || []);
    } catch (error) {
      // Ignore 404s
    }
  }

  return allListCards;
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

function filterAndSortCards(cards, minPrice, excludeRares) {
  const expanded = expandCardFinishes(cards);
  return expanded
    .filter(card => card.price >= minPrice)
    .filter(card => {
      if (!excludeRares) return true;
      const rarity = card.rarity?.toLowerCase();
      return rarity !== 'rare' && rarity !== 'mythic';
    })
    .sort((a, b) => b.price - a.price);
}

// ============ Rendering ============

function renderCards(cards) {
  const grid = document.getElementById('card-grid');
  const countEl = document.getElementById('card-count');

  if (cards.length === 0) {
    grid.innerHTML = `
      <div class="no-results">
        <h3>no cards found</h3>
        <p>try lowering the minimum price or switching booster type</p>
      </div>
    `;
    countEl.classList.add('hidden');
    return;
  }

  countEl.textContent = `showing ${cards.length} card${cards.length === 1 ? '' : 's'}`;
  countEl.classList.remove('hidden');

  grid.innerHTML = cards.map(card => {
    const imageUrl = card.image_uris?.normal ||
                     card.card_faces?.[0]?.image_uris?.normal ||
                     '';
    const scryfallUrl = card.scryfall_uri || '#';
    const treatment = card.treatment.toLowerCase();

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
          <div class="card-details">
            <span class="card-treatment">${treatment}</span>
            <span class="card-price">$${card.price.toFixed(2)}</span>
          </div>
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
  }
}

function showError(message) {
  const errorEl = document.getElementById('error');
  errorEl.textContent = message;
  errorEl.classList.remove('hidden');
  document.getElementById('card-grid').classList.add('hidden');
  document.getElementById('card-count').classList.add('hidden');
}

// ============ Main Logic ============

const cardCache = new Map();

async function loadCards() {
  const setCode = document.getElementById('set-select').value;
  const boosterType = document.getElementById('booster-type').value;
  const minPrice = parseFloat(document.getElementById('min-price').value);
  const excludeRares = document.getElementById('exclude-rares').checked;
  const includeList = document.getElementById('include-list').checked;

  if (!setCode) return;

  document.getElementById('error').classList.add('hidden');
  setLoading(true);

  const cacheKey = `${setCode}-${boosterType}-${minPrice}-${includeList}`;

  try {
    let rawCards;
    if (cardCache.has(cacheKey)) {
      rawCards = cardCache.get(cacheKey);
    } else {
      rawCards = await fetchSetCards(setCode, boosterType, minPrice, includeList);
      cardCache.set(cacheKey, rawCards);
    }

    const cards = filterAndSortCards(rawCards, minPrice, excludeRares);
    renderCards(cards);
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
  const excludeRares = document.getElementById('exclude-rares');
  const includeList = document.getElementById('include-list');

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
    setInput.value = `${initialSet.name.toLowerCase()} (${initialSet.released.slice(0, 4)})`;
    setHidden.value = initialSet.code;
    excludeRares.checked = urlState.excludeRares;
    includeList.checked = urlState.includeList;

    // Set booster type options based on set era, then apply URL value
    updateBoosterTypeOptions(initialSet.released, urlState.booster);

    // Set price toggle from URL
    setToggleValue('price-toggle', 'min-price', urlState.min);

    // Event listeners for checkboxes
    excludeRares.addEventListener('change', onFilterChange);
    includeList.addEventListener('change', onFilterChange);

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
