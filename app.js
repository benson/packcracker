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
        // Rate limited, wait and retry
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

// Load sets from static JSON file (pre-fetched from Scryfall)
async function fetchSets() {
  const response = await fetch('./sets.json');
  return await response.json();
}

// Determine booster era for a set
function getBoosterEra(releaseDate) {
  if (releaseDate >= PLAY_BOOSTER_START) {
    return 'play'; // Play Booster + Collector Booster
  } else if (releaseDate >= COLLECTOR_BOOSTER_START) {
    return 'set'; // Draft/Set Booster + Collector Booster
  } else {
    return 'draft'; // Draft Booster only (no collector)
  }
}

// Update booster type dropdown based on selected set
function updateBoosterTypeOptions(releaseDate) {
  const boosterType = document.getElementById('booster-type');
  const era = getBoosterEra(releaseDate);

  if (era === 'draft') {
    // Pre-collector era: only draft boosters existed
    boosterType.innerHTML = '<option value="play">Draft Booster</option>';
    boosterType.disabled = true;
  } else if (era === 'set') {
    // Set booster era
    boosterType.innerHTML = `
      <option value="play">Draft / Set Booster</option>
      <option value="collector">Collector Booster</option>
    `;
    boosterType.disabled = false;
  } else {
    // Play booster era (current)
    boosterType.innerHTML = `
      <option value="play">Play Booster</option>
      <option value="collector">Collector Booster</option>
    `;
    boosterType.disabled = false;
  }
}

// Fetch cards from a set with server-side filtering
async function fetchSetCards(setCode, boosterType, minPrice) {
  // Build query with filters pushed to Scryfall
  let query = `set:${setCode} lang:en`;

  // Filter by booster eligibility for non-collector boosters
  if (boosterType !== 'collector') {
    query += ' is:booster';
  }

  // Filter by price (either regular OR foil price meets minimum)
  const priceThreshold = Math.max(0.5, minPrice - 0.5);
  query += ` (usd>=${priceThreshold} OR usd_foil>=${priceThreshold})`;

  const url = `${SCRYFALL_API}/cards/search?q=${encodeURIComponent(query)}&unique=prints&order=usd&dir=desc`;

  try {
    // Just fetch first page (up to 175 cards) - plenty for valuable cards
    const data = await fetchWithRetry(url);
    return data.data;
  } catch (error) {
    // If no cards match, Scryfall returns 404 - that's fine
    if (error.message === 'HTTP 404') {
      return [];
    }
    throw error;
  }
}

// Determine card treatment/variant type
function getCardTreatment(card, isFoil) {
  const treatments = [];

  if (card.frame_effects?.includes('showcase')) treatments.push('Showcase');
  if (card.frame_effects?.includes('extendedart')) treatments.push('Extended Art');
  if (card.border_color === 'borderless') treatments.push('Borderless');
  if (card.promo) treatments.push('Promo');
  if (card.full_art) treatments.push('Full Art');
  if (card.frame_effects?.includes('etched')) treatments.push('Etched');
  if (isFoil) treatments.push('Foil');

  return treatments.length > 0 ? treatments.join(', ') : 'Regular';
}

// Expand cards into separate entries for each finish (nonfoil, foil, etched)
function expandCardFinishes(cards) {
  const expanded = [];

  for (const card of cards) {
    const prices = card.prices || {};
    const finishes = card.finishes || [];

    // Regular (nonfoil) version
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

    // Foil version
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

    // Etched foil version (some cards have this)
    if (finishes.includes('etched') && prices.usd_etched) {
      const price = parseFloat(prices.usd_etched);
      if (price > 0) {
        expanded.push({
          ...card,
          price,
          isFoil: false, // etched is its own thing
          treatment: getCardTreatment(card, false).replace('Regular', 'Etched') || 'Etched',
          finishKey: 'etched'
        });
      }
    }
  }

  return expanded;
}

// Filter and sort cards by price (booster filtering already done server-side)
function filterAndSortCards(cards, minPrice, boosterType) {
  const expanded = expandCardFinishes(cards);
  return expanded
    .filter(card => card.price >= minPrice)
    .sort((a, b) => b.price - a.price);
}

// Render cards to the grid
function renderCards(cards) {
  const grid = document.getElementById('card-grid');
  const countEl = document.getElementById('card-count');

  if (cards.length === 0) {
    grid.innerHTML = `
      <div class="no-results" style="grid-column: 1 / -1;">
        <h3>No cards found</h3>
        <p>Try lowering the minimum price or switching booster type</p>
      </div>
    `;
    countEl.classList.add('hidden');
    return;
  }

  countEl.textContent = `Showing ${cards.length} card${cards.length === 1 ? '' : 's'}`;
  countEl.classList.remove('hidden');

  grid.innerHTML = cards.map(card => {
    const imageUrl = card.image_uris?.normal ||
                     card.card_faces?.[0]?.image_uris?.normal ||
                     '';
    const scryfallUrl = card.scryfall_uri || '#';

    return `
      <a class="card" href="${scryfallUrl}" target="_blank" rel="noopener noreferrer">
        <img
          class="card-image"
          src="${imageUrl}"
          alt="${card.name}"
          loading="lazy"
        />
        <div class="card-info">
          <div class="card-name" title="${card.name}">${card.name}</div>
          <div class="card-details">
            <span class="card-treatment">${card.treatment}</span>
            <span class="card-price">$${card.price.toFixed(2)}</span>
          </div>
        </div>
      </a>
    `;
  }).join('');
}

// Show/hide loading state
function setLoading(loading) {
  document.getElementById('loading').classList.toggle('hidden', !loading);
  document.getElementById('card-grid').classList.toggle('hidden', loading);
}

// Show error message
function showError(message) {
  const errorEl = document.getElementById('error');
  errorEl.textContent = message;
  errorEl.classList.remove('hidden');
  document.getElementById('card-grid').classList.add('hidden');
  document.getElementById('card-count').classList.add('hidden');
}

// Cache for loaded queries
const cardCache = new Map();

// Load and display cards for selected set
async function loadCards() {
  const setCode = document.getElementById('set-select').value;
  const boosterType = document.getElementById('booster-type').value;
  const minPrice = parseFloat(document.getElementById('min-price').value);

  if (!setCode) return;

  document.getElementById('error').classList.add('hidden');
  setLoading(true);

  // Cache key includes all query parameters
  const cacheKey = `${setCode}-${boosterType}-${minPrice}`;

  try {
    let cards;
    if (cardCache.has(cacheKey)) {
      cards = cardCache.get(cacheKey);
    } else {
      // Fetch with server-side filtering
      const rawCards = await fetchSetCards(setCode, boosterType, minPrice);
      // Expand finishes and do final client-side filtering
      cards = filterAndSortCards(rawCards, minPrice, boosterType);
      cardCache.set(cacheKey, cards);
    }

    renderCards(cards);
  } catch (error) {
    console.error('Error loading cards:', error);
    showError('Failed to load cards. Please try again.');
  } finally {
    setLoading(false);
  }
}

// Store sets data globally for release date lookups
let setsData = [];

// Handle set selection change
function onSetChange() {
  const setCode = document.getElementById('set-select').value;
  const set = setsData.find(s => s.code === setCode);
  if (set) {
    updateBoosterTypeOptions(set.released);
  }
  loadCards();
}

// Initialize the app
async function init() {
  const setSelect = document.getElementById('set-select');
  const boosterType = document.getElementById('booster-type');
  const minPrice = document.getElementById('min-price');

  try {
    // Load sets from static JSON
    setsData = await fetchSets();

    setSelect.innerHTML = setsData.map(set =>
      `<option value="${set.code}">${set.name} (${set.released.slice(0, 4)})</option>`
    ).join('');
    setSelect.disabled = false;

    // Set initial booster type options
    if (setsData.length > 0) {
      updateBoosterTypeOptions(setsData[0].released);
    }

    // Set up event listeners
    setSelect.addEventListener('change', onSetChange);
    boosterType.addEventListener('change', loadCards);
    minPrice.addEventListener('change', loadCards);

    // Load initial set
    await loadCards();

  } catch (error) {
    console.error('Error initializing:', error);
    showError('Failed to load sets. Please refresh the page.');
  }
}

// Start the app
init();
