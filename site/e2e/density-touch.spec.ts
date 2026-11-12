import { expect, test } from '@playwright/test';
import { closeChats, openChat, openChats } from './helpers';

// On touch (a phone, or a tablet or a laptop with a touch screen at any width) every drawer row keeps the Bundu floor:
// drawn and hit at 49px or more, 7px between rows, no overlap. The desktop density (32px) is for a mouse only and is
// tested in e2e-desktop/density.spec.ts. The foot rows have no icons.

const measure = (page: import('@playwright/test').Page) =>
  page.locator('.side-row').evaluateAll((els) =>
    els
      .filter((e) => (e as HTMLElement).offsetParent !== null)
      .map((e) => {
        const r = e.getBoundingClientRect();
        return { text: (e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 24), top: r.top, bottom: r.bottom, h: r.height, left: r.left, right: r.right, svgs: e.querySelectorAll('svg').length };
      }),
  );

for (const [name, size] of [['a phone', { width: 360, height: 640 }], ['a touch laptop or tablet at 1280px', { width: 1280, height: 800 }]] as const) {
  for (const scheme of ['light', 'dark'] as const) {
    test(`on ${name} the drawer's rows are at least 49px, 7px apart, not overlapping (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize(size);
      await openChat(page);
      if (size.width < 1024) await openChats(page);
      expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
      const list = (await measure(page)).sort((a, b) => a.top - b.top);
      expect(list.length).toBeGreaterThanOrEqual(8);
      for (const r of list) expect(r.h, `${r.text} is at least the 49px floor`).toBeGreaterThanOrEqual(48.9);
      for (let i = 1; i < list.length; i++) {
        const a = list[i - 1]!, b = list[i]!;
        if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1) {
          expect(b.top - a.bottom, `${a.text} / ${b.text}: no overlap, 7px apart`).toBeGreaterThanOrEqual(6.9);
        }
      }
      if (size.width < 1024) await closeChats(page);
    });
  }
}

test('on a phone the foot rows have no icon', async ({ page }) => {
  await openChat(page);
  await openChats(page);
  const foot = await page.locator('.side-nav .side-row').evaluateAll((els) => els.map((e) => ({ text: (e.textContent || '').trim(), svgs: e.querySelectorAll('svg').length })));
  expect(foot).toHaveLength(3);
  for (const r of foot) expect(r.svgs, r.text).toBe(0);
});
