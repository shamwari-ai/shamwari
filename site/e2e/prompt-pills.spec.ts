import { expect, test } from '@playwright/test';
import { openChat } from './helpers';

// The suggested prompts are pills (Mzizi's suggested-prompts shape) that WRAP onto more rows rather than scrolling sideways,
// each a real button with a 49px hit region (32px drawn on a desktop mouse), in light and dark, at the widths people use.

for (const scheme of ['light', 'dark'] as const) {
  for (const width of [320, 390, 1440]) {
    test(`the suggested prompts are pills that wrap and never overflow, at ${width}px (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ width, height: 900 });
      await openChat(page);
      const group = page.getByRole('group', { name: 'Suggested prompts' });
      await expect(group).toBeVisible();
      const pills = group.getByRole('button');
      await expect(pills).toHaveCount(3);
      const geo = await pills.evaluateAll((els) =>
        els.map((e) => {
          const r = e.getBoundingClientRect();
          const cs = getComputedStyle(e);
          return { left: r.left, right: r.right, top: r.top, h: r.height, radius: parseFloat(cs.borderTopLeftRadius), border: cs.borderTopWidth };
        }),
      );
      for (const g of geo) {
        expect(g.left, 'inside the left edge').toBeGreaterThanOrEqual(0);
        expect(g.right, 'inside the right edge').toBeLessThanOrEqual(width);
        expect(g.radius, 'a pill: the corner radius is at least half the height').toBeGreaterThanOrEqual(g.h / 2);
        expect(g.border).toBe('1px');
        expect(g.h, 'a hit region of at least 32px drawn').toBeGreaterThanOrEqual(32);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth), 'the page does not scroll sideways').toBeLessThanOrEqual(width);
      if (width <= 390) {
        const rows = new Set(geo.map((g) => Math.round(g.top)));
        expect(rows.size, 'on a narrow screen they wrap onto several rows').toBeGreaterThan(1);
      }
    });
  }
}

test('a tap on a pill fills the box and never sends, and never overwrites a draft', async ({ page }) => {
  await openChat(page);
  await page.getByRole('group', { name: 'Suggested prompts' }).getByRole('button').first().click();
  await expect(page.locator('#q')).toHaveValue(/Constitution/);
  await expect(page.locator('article.msg')).toHaveCount(0);
});

test('a pill tapped over a draft keeps the draft and adds the prompt after it', async ({ page }) => {
  await openChat(page);
  await page.locator('#q').fill('my own words');
  await page.getByRole('group', { name: 'Suggested prompts' }).getByRole('button').first().click();
  await expect(page.locator('#q')).toHaveValue(/^my own words\n.*Constitution/s);
});
