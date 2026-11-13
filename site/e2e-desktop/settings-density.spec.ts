import { expect, test } from '@playwright/test';
import { openChat } from '../e2e/helpers';

// With a mouse on a desktop the Settings radio rows and the offline switch are drawn at the density size, and a draft language's
// rows still leave the 7px floor gap between them.
test('on a desktop the Settings language rows and the offline switch are drawn at the density size, 7px apart', async ({ page }) => {
  await openChat(page);
  await page.locator('#open-settings').click();
  const rows = await page.locator('#lang .radio-row').evaluateAll((els) =>
    els.map((e) => {
      const r = e.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, h: r.height };
    }),
  );
  expect(rows).toHaveLength(3);
  for (const r of rows) {
    expect(r.h).toBeGreaterThanOrEqual(32);
    expect(r.h).toBeLessThan(40);
  }
  for (let i = 1; i < rows.length; i++) expect(rows[i].top - rows[i - 1].bottom).toBeGreaterThanOrEqual(7);
  const sw = (await page.locator('#offline-mode').boundingBox())!;
  expect(sw.height).toBeGreaterThanOrEqual(32);
  expect(sw.height).toBeLessThan(55);
});
