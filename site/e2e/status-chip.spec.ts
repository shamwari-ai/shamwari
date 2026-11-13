import { expect, test } from '@playwright/test';
import { openChat } from './helpers';

// The composer is one rounded card. Its top holds a status chip slot (#269): the offline and offline-mode notices sit there, one quiet
// dismissible line, instead of a banner across the top of the page. "+" and send are round.

test('offline: the notice is a chip inside the composer card, above the box, and the X dismisses it', async ({ page, context }) => {
  await openChat(page);
  await context.setOffline(true);
  const chip = page.locator('.composer #offline');
  await expect(chip).toBeVisible();
  await expect(chip).toContainText('You are offline');
  const [c, q, card] = await Promise.all([chip.boundingBox(), page.locator('#q').boundingBox(), page.locator('.composer').boundingBox()]);
  expect(c!.y + c!.height, 'above the question box').toBeLessThanOrEqual(q!.y + 1);
  expect(c!.x).toBeGreaterThanOrEqual(card!.x);
  expect(c!.x + c!.width).toBeLessThanOrEqual(card!.x + card!.width + 1);
  const x = chip.getByRole('button', { name: 'Close' });
  expect((await x.boundingBox())!.height, 'a 49px hit region').toBeGreaterThanOrEqual(49);
  await x.click();
  await expect(chip).toBeHidden();
  // Dismissed is for this stretch offline only: going online and offline again shows it again.
  await context.setOffline(false);
  await context.setOffline(true);
  await expect(chip).toBeVisible();
});

test('offline mode on: its note is a chip in the card too, and says nothing is sent', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('shamwari.offlineMode', '1'));
  await openChat(page);
  const chip = page.locator('.composer #offline-mode-note');
  await expect(chip).toBeVisible();
  await expect(chip).toContainText('Nothing is sent');
});

test('"+" and send are round buttons', async ({ page }) => {
  await openChat(page);
  for (const sel of ['#plus', '#send']) {
    const r = await page.locator(sel).evaluate((el) => {
      const b = el.getBoundingClientRect();
      return { h: b.height, w: b.width, radius: parseFloat(getComputedStyle(el).borderTopLeftRadius) };
    });
    expect(r.radius, `${sel} is round`).toBeGreaterThanOrEqual(Math.min(r.h, r.w) / 2 - 0.5);
  }
});

for (const scheme of ['light', 'dark'] as const) {
  test(`the chip reads at 7:1 and wraps without sideways scroll at 320px (${scheme})`, async ({ page, context }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width: 320, height: 640 });
    await openChat(page);
    await context.setOffline(true);
    await expect(page.locator('.composer #offline')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
    const ratio = await page.evaluate(() => {
      const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
      const rgb = (css: string) => {
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillStyle = '#000';
        ctx.fillStyle = css;
        ctx.fillRect(0, 0, 1, 1);
        const d = ctx.getImageData(0, 0, 1, 1).data;
        return [d[0], d[1], d[2], d[3] / 255];
      };
      const lum = (c: number[]) => {
        const f = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
        return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
      };
      const el = document.querySelector('.composer #offline')!;
      const a = lum(rgb(getComputedStyle(el).color));
      const b = lum(rgb(getComputedStyle(el).backgroundColor));
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    });
    expect(ratio).toBeGreaterThanOrEqual(7);
  });
}
