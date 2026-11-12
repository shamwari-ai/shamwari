import { expect, test, type Page } from '@playwright/test';
import { ask, openChat } from '../e2e/helpers';

// On a desktop with a mouse (64rem up, fine pointer, hover, no touch) Mzizi's density layer draws controls smaller, and the
// drawer's rows follow it: 32px rows (--size-control-sm), flat, with the 7px gap between them (--gap-floor) so their hit
// regions never overlap. The 49px hit region is never lowered on touch: e2e/density-touch.spec.ts. The foot rows have no icons.

const rows = (page: Page, selector: string) =>
  page.locator(selector).evaluateAll((els) =>
    els
      .filter((e) => (e as HTMLElement).offsetParent !== null)
      .map((e) => {
        const r = e.getBoundingClientRect();
        return { text: (e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60), top: r.top, bottom: r.bottom, left: r.left, right: r.right, h: r.height, svgs: e.querySelectorAll('svg').length };
      }),
  );

for (const scheme of ['light', 'dark'] as const) {
  test.describe(scheme, () => {
    test.use({ colorScheme: scheme });

    test(`on a desktop the drawer's rows are drawn 32px, with 7px between them and no overlap (${scheme})`, async ({ page }) => {
      await openChat(page);
      await ask(page, 'Is it legal?'); // a chat with a short title, so the history list has one row that does not wrap
      await expect(page.locator('.cite-link').first()).toBeVisible();
      await page.locator('#side-new').click();
      await expect(page.locator('#history-list button').first()).toBeVisible();

      expect(await page.evaluate(() => matchMedia('(pointer: fine) and (hover: hover)').matches)).toBe(true);
      expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--size-control-sm').trim())).toBe('2rem');

      const list = [...(await rows(page, '.side-row')), ...(await rows(page, '#history-list .btn.link'))].sort((a, b) => a.top - b.top);
      expect(list.length, 'section rows, foot rows and a chat title').toBeGreaterThanOrEqual(9);
      for (const r of list) expect(r.h, r.text).toBeGreaterThanOrEqual(31.5);
      for (const r of list) expect(r.h, `${r.text} is drawn at 32px, not 49`).toBeLessThanOrEqual(33);
      for (let i = 1; i < list.length; i++) {
        const a = list[i - 1]!, b = list[i]!;
        const gap = b.top - a.bottom;
        // Rows may sit beside each other only if they do not overlap; stacked ones keep the 7px floor.
        if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1) expect(gap, `${a.text} / ${b.text}`).toBeGreaterThanOrEqual(6.9);
      }
    });

    test(`flat at rest: no border, no fill; the open section has the fill and aria-current (${scheme})`, async ({ page }) => {
      await openChat(page);
      const style = (sel: string) =>
        page.locator(sel).first().evaluate((el) => {
          const c = getComputedStyle(el);
          return { bg: c.backgroundColor, border: parseFloat(c.borderTopWidth), shadow: c.boxShadow, size: parseFloat(c.fontSize), weight: Number(c.fontWeight) };
        });
      const projects = await style('button.side-row[data-section="projects"]');
      expect(projects.bg, 'no fill at rest').toBe('rgba(0, 0, 0, 0)');
      expect(projects.border, 'no border at rest').toBe(0);
      expect(projects.shadow).toBe('none');
      expect(projects.size, 'a 14px label').toBe(14);
      expect(projects.weight, 'regular weight at rest').toBeLessThanOrEqual(400);
      const chat = page.locator('button.side-row[data-section="chat"]');
      await expect(chat).toHaveAttribute('aria-current', 'page');
      const open = await style('button.side-row[data-section="chat"]');
      expect(open.bg, 'the open section is filled').not.toBe('rgba(0, 0, 0, 0)');
      // Hover adds a fill on a row that has none.
      await page.locator('button.side-row[data-section="projects"]').hover();
      expect((await style('button.side-row[data-section="projects"]')).bg).not.toBe('rgba(0, 0, 0, 0)');
    });

    test(`the foot rows are text only: no icon of any kind (${scheme})`, async ({ page }) => {
      await openChat(page);
      const foot = await rows(page, '.side-nav .side-row');
      expect(foot.map((r) => r.text.replace(/\(opens in a new tab\)/, '').trim())).toEqual(['Use the API', 'Disclaimer and privacy', 'Settings']);
      for (const r of foot) expect(r.svgs, `${r.text} has no icon`).toBe(0);
    });
  });
}
