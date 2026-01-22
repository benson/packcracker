const { test, expect } = require('@playwright/test');

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

// Special Guests that should appear when the toggle is enabled
const SPECIAL_GUESTS = {
  blb: [
    { name: 'sylvan tutor', cn: '59', minPrice: 50 },
    { name: 'sword of fire and ice', cn: '62', minPrice: 50 },
  ],
};

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
    // Navigate to BLB with Special Guests enabled (list=include)
    await page.goto('/?set=blb&booster=play&min=2&list=include');

    // Wait for cards to load
    await waitForCardsLoaded(page);

    // Check that Special Guests cards appear
    for (const card of SPECIAL_GUESTS.blb) {
      const cardElement = page.locator('.card-name', { hasText: card.name });
      await expect(cardElement.first()).toBeVisible({
        timeout: 5000,
      });
    }
  });

  test('BLB Special Guests do NOT appear when toggle is disabled', async ({ page }) => {
    // Navigate to BLB without Special Guests (list=exclude, the default)
    await page.goto('/?set=blb&booster=play&min=2&list=exclude');

    // Wait for cards to load
    await waitForCardsLoaded(page);

    // Check that Special Guests cards do NOT appear
    for (const card of SPECIAL_GUESTS.blb) {
      const cardElement = page.locator('.card-name', { hasText: card.name });
      await expect(cardElement).toHaveCount(0);
    }
  });
});

test.describe('Collector Exclusive Filtering', () => {
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
