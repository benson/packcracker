const { test, expect } = require('@playwright/test');

test('MH3 retro frame cards appear', async ({ page }) => {
  await page.goto('/?set=mh3&booster=play&min=2');
  await page.waitForFunction(() => document.getElementById('loading')?.classList.contains('hidden'), { timeout: 15000 });
  await page.waitForTimeout(1000);
  
  // Get all card names
  const allCards = await page.locator('.card-name').allTextContents();
  console.log('Total cards:', allCards.length);
  console.log('Cards:', allCards.join(', '));
  
  // Check for Flooded Strand (retro frame fetchland)
  const floodedStrand = page.locator('.card-name', { hasText: 'flooded strand' });
  await expect(floodedStrand.first()).toBeVisible({ timeout: 5000 });
});
