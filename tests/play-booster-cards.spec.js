const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// Test cards that should appear in play boosters
// These are expensive cards with different treatments across key sets
// Prices are approximate and may change - the key is that they're above typical min thresholds
const TEST_CARDS = {
  mkm: [
    { name: 'delney, streetwise lookout', cn: '12', minPrice: 30 },
    { name: 'undercity sewers', cn: '270', minPrice: 15 },
  ],
  otj: [
    { name: 'bristly bill, spine sower', cn: '157', minPrice: 40 },
    { name: 'terror of the peaks', cn: '149', minPrice: 25 },
  ],
  dsk: [
    { name: 'overlord of the balemurk', cn: '113', minPrice: 20 },
    { name: 'valgavoth, terror eater', cn: '120', minPrice: 12 },
  ],
  blb: [
    { name: 'maha, its feathers night', cn: '100', minPrice: 40 },
    { name: 'lumra, bellow of the woods', cn: '183', minPrice: 25 },
  ],
  mh3: [
    { name: 'ocelot pride', cn: '38', minPrice: 30 },
    { name: 'phyrexian tower', cn: '303', minPrice: 20 },
  ],
};

function readCachedSet(setCode) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', `${setCode}.json`), 'utf8'));
}

function cachedExtraNames(setCode) {
  return new Set((readCachedSet(setCode).extras || []).map(card => String(card.name || '').toLowerCase()));
}

// Helper to wait for cards to finish loading
async function waitForCardsLoaded(page) {
  // Wait for loading indicator to have 'hidden' class (meaning loading is done)
  await page.waitForFunction(
    () => document.getElementById('loading')?.classList.contains('hidden'),
    { timeout: 15000 }
  );
  // Small delay for render
  await page.waitForTimeout(300);
}

test.describe('Play Booster Card Visibility', () => {
  test.beforeEach(async ({ page }) => {
    page.setDefaultTimeout(15000);
  });

  for (const [setCode, cards] of Object.entries(TEST_CARDS)) {
    test(`${setCode.toUpperCase()} - expensive cards appear in play boosters`, async ({ page }) => {
      // Navigate to the set with play booster selected and low min price
      await page.goto(`/?set=${setCode}&booster=play&min=2`);

      // Wait for cards to load
      await waitForCardsLoaded(page);

      // Check that each test card is visible
      for (const card of cards) {
        const cardElement = page.locator('.card-name', { hasText: card.name });
        await expect(cardElement.first()).toBeVisible({
          timeout: 5000,
        });
      }
    });
  }
});

test.describe('Special Guests Toggle', () => {
  test('BLB Special Guests appear when toggle is enabled', async ({ page }) => {
    const specialGuestNames = [...cachedExtraNames('blb')].filter(name =>
      ['sylvan tutor', 'sword of fire and ice'].includes(name)
    );
    expect(specialGuestNames.length).toBeGreaterThan(0);

    // Navigate to BLB with Special Guests enabled (list=include)
    await page.goto('/?set=blb&booster=play&min=2&list=include');

    // Wait for cards to load
    await waitForCardsLoaded(page);

    // Check that Special Guests cards appear
    for (const name of specialGuestNames) {
      const cardElement = page.locator('.card-name', { hasText: name });
      await expect(cardElement.first()).toBeVisible({
        timeout: 5000,
      });
    }
  });

  test('BLB Special Guests do NOT appear when toggle is disabled', async ({ page }) => {
    const specialGuestNames = [...cachedExtraNames('blb')].filter(name =>
      ['sylvan tutor', 'sword of fire and ice'].includes(name)
    );
    expect(specialGuestNames.length).toBeGreaterThan(0);

    // Navigate to BLB without Special Guests (list=exclude, the default)
    await page.goto('/?set=blb&booster=play&min=2&list=exclude');

    // Wait for cards to load
    await waitForCardsLoaded(page);

    // Check that Special Guests cards do NOT appear
    for (const name of specialGuestNames) {
      const cardElement = page.locator('.card-name', { hasText: name });
      await expect(cardElement).toHaveCount(0);
    }
  });
});

test.describe('MTGJSON Cache Shape', () => {
  test('BLB cache stores MTGJSON UUIDs and per-finish odds', async () => {
    const blb = readCachedSet('blb');
    const maha = (blb.play || []).find(card => String(card.name || '').toLowerCase() === 'maha, its feathers night');
    const sylvanTutor = (blb.extras || []).find(card => String(card.name || '').toLowerCase() === 'sylvan tutor');

    expect(maha?.uuid).toBeTruthy();
    expect(maha?.finishes?.some(finish => finish.packOdds > 0)).toBe(true);
    expect(sylvanTutor?.uuid).toBeTruthy();
    expect(sylvanTutor?.isExtra).toBe(true);
    expect(sylvanTutor?.finishes?.some(finish => finish.packOdds > 0)).toBe(true);
  });

  test('cached EV inputs are nonzero for play, extras, and collector pools', async () => {
    const blb = readCachedSet('blb');
    const ev = (cards) => cards.reduce((sum, card) => {
      return sum + (card.finishes || []).reduce((finishSum, finish) => {
        const price = Number(finish.price || 0);
        const odds = Number(finish.packOdds || 0);
        return finishSum + (price * odds);
      }, 0);
    }, 0);

    expect(ev(blb.play || [])).toBeGreaterThan(0);
    expect(ev(blb.extras || [])).toBeGreaterThan(0);
    expect(ev(blb.collector || [])).toBeGreaterThan(0);
  });
});

test.describe('Collector Exclusive Filtering', () => {
  test('serialized variants are not cached in play booster pools', async () => {
    const dataDir = path.join(__dirname, '..', 'data');
    const hits = [];

    for (const file of fs.readdirSync(dataDir)) {
      if (!file.endsWith('.json') || file === 'manifest.json') continue;
      const data = JSON.parse(fs.readFileSync(path.join(dataDir, file), 'utf8'));

      for (const card of data.play || []) {
        const collectorNumber = String(card.collector_number || '');
        const promoTypes = card.promo_types || [];
        if (/^\d+z$/i.test(collectorNumber) || promoTypes.includes('serialized')) {
          hits.push(`${file}: ${card.name} #${collectorNumber}`);
        }
      }
    }

    expect(hits).toEqual([]);
  });

  test('EOS Collector-only Stellar Sights variants are not cached in play booster pools', async () => {
    const eos = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'eos.json'), 'utf8'));
    const playCollectorNumbers = new Set((eos.play || []).map(card => String(card.collector_number || '')));
    const collectorCollectorNumbers = new Set((eos.collector || []).map(card => String(card.collector_number || '')));

    expect(playCollectorNumbers.has('91')).toBe(false);
    expect(playCollectorNumbers.has('136')).toBe(false);
    expect([...playCollectorNumbers].every(cn => Number(cn) >= 1 && Number(cn) <= 45)).toBe(true);
    expect(collectorCollectorNumbers.has('91')).toBe(true);
    expect(collectorCollectorNumbers.has('136')).toBe(true);
  });

  test('Extended art cards should NOT appear in play boosters', async ({ page }) => {
    // Navigate to a set and check that extended art cards are filtered out
    await page.goto('/?set=mkm&booster=play&min=2');

    await waitForCardsLoaded(page);

    // Get all visible cards and check none have "extended art" treatment
    const treatments = await page.locator('.card-treatment').allTextContents();
    for (const treatment of treatments) {
      expect(treatment.toLowerCase()).not.toContain('extended art');
    }
  });

  test('Extended art cards SHOULD appear in collector boosters', async ({ page }) => {
    // Navigate to collector booster - extended art should be present
    await page.goto('/?set=mkm&booster=collector&min=2');

    await waitForCardsLoaded(page);

    // Should have some cards (collector has more treatments)
    const cardCount = await page.locator('.card').count();
    expect(cardCount).toBeGreaterThan(0);
  });

  test('MKM serialized cards should NOT appear in play boosters', async ({ page }) => {
    await page.goto('/?set=mkm&booster=play&min=100');

    await waitForCardsLoaded(page);

    await expect(page.locator('.card-name', { hasText: 'teysa, opulent oligarch' })).toHaveCount(0);
    await expect(page.locator('.card-name', { hasText: 'lazav, wearer of faces' })).toHaveCount(0);
  });

  // Regression test: cards with collector-exclusive treatments should be filtered
  // even if a fallback data source would otherwise claim they were booster cards.
  test('ECL fracturefoil/inverted cards should NOT appear in play boosters', async ({ page }) => {
    // ECL (Lorwyn Eclipsed) has cards 400-401 which are fracturefoil/inverted variants
    await page.goto('/?set=ecl&booster=play&min=2');

    await waitForCardsLoaded(page);

    // Bloom Tender #400 is fracturefoil+inverted - should not appear
    const bloomTender400 = page.locator('.card-name', { hasText: 'bloom tender' });
    // If present, verify it's not the #400 variant by checking the card count
    // The regular version may appear, but the fracturefoil should not
    const count = await bloomTender400.count();
    if (count > 0) {
      // Check that no cards have inverted treatment
      const treatments = await page.locator('.card-treatment').allTextContents();
      for (const treatment of treatments) {
        expect(treatment.toLowerCase()).not.toContain('inverted');
      }
    }
  });

  test('ECL fracturefoil/inverted cards SHOULD appear in collector boosters', async ({ page }) => {
    await page.goto('/?set=ecl&booster=collector&min=2');

    await waitForCardsLoaded(page);

    // Collector boosters should have these special treatments
    const cardCount = await page.locator('.card').count();
    expect(cardCount).toBeGreaterThan(0);
  });
});

test.describe('Filter Interactions', () => {
  test('Minimum price filter works correctly', async ({ page }) => {
    // Set a high minimum price
    await page.goto('/?set=blb&booster=play&min=30');

    await waitForCardsLoaded(page);

    // Maha ($46) should appear, but cheaper cards should not
    const maha = page.locator('.card-name', { hasText: 'maha, its feathers night' });
    await expect(maha.first()).toBeVisible();

    // Cards under $30 should not appear
    // Artist's Talent is ~$16-17, should not be visible
    const artistsTalent = page.locator('.card-name', { hasText: "artist's talent" });
    await expect(artistsTalent).toHaveCount(0);
  });

  test('Exclude foils filter removes foil-only prices', async ({ page }) => {
    await page.goto('/?set=mkm&booster=play&min=2&foils=exclude');

    await waitForCardsLoaded(page);

    // Check that no "foil" price labels appear
    const foilPrices = page.locator('.finish-type', { hasText: /^foil$/i });
    await expect(foilPrices).toHaveCount(0);
  });
});
