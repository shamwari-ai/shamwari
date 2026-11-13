import { expect, test } from '@playwright/test';
import { openAccount, openChat } from './helpers';

// Quiet text (the home screen's hint, "Try asking", Settings' section labels and notes) reaches the Bundu floor's 7:1 against its
// surface in both themes, and the top bar stays one tidy row at the narrowest widths even with the offline badge showing.

const contrastOf = (page: import('@playwright/test').Page, selector: string) =>
  page.evaluate((sel) => {
    // Any CSS colour (rgb, oklab, color-mix results) is turned into plain rgb by painting one pixel of it.
    const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
    const toRgb = (css: string): number[] => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = '#000';
      ctx.fillStyle = css;
      ctx.fillRect(0, 0, 1, 1);
      const d = ctx.getImageData(0, 0, 1, 1).data;
      return [d[0], d[1], d[2], d[3] / 255];
    };
    const rgb = toRgb;
    const bgOf = (el: Element): number[] => {
      let e: Element | null = el;
      while (e) {
        const c = toRgb(getComputedStyle(e).backgroundColor);
        if ((c[3] ?? 1) > 0.5) return c;
        e = e.parentElement;
      }
      return [255, 255, 255];
    };
    const lum = (c: number[]) => {
      const f = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
      return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
    };
    const el = document.querySelector(sel)!;
    const a = lum(rgb(getComputedStyle(el).color));
    const b = lum(bgOf(el));
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  }, selector);

for (const scheme of ['light', 'dark'] as const) {
  test(`quiet text reaches 7:1 in ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await openChat(page);
    for (const sel of ['.lead', '#empty .try']) expect(await contrastOf(page, sel), `${sel} on the home screen`).toBeGreaterThanOrEqual(7);
    await openAccount(page);
    for (const sel of ['.settings-section h3', '.settings-hint']) expect(await contrastOf(page, sel), `${sel} in Settings`).toBeGreaterThanOrEqual(7);
  });
}

for (const width of [320, 360]) {
  test(`the top bar is one row at ${width}px, also with the offline badge showing`, async ({ page }) => {
    await page.setViewportSize({ width, height: 640 });
    await page.addInitScript(() => localStorage.setItem('shamwari.offlineMode', '1'));
    await openChat(page);
    await expect(page.locator('#offline-badge')).toBeVisible();
    const bar = await page.evaluate(() => {
      const t = document.querySelector('[data-slot="app-topbar"]')!.getBoundingClientRect();
      const kids = [...document.querySelectorAll<HTMLElement>('[data-slot="app-topbar"] button, [data-slot="app-topbar"] a')]
        .filter((e) => e.offsetParent !== null)
        .map((e) => {
          const r = e.getBoundingClientRect();
          return { left: r.left, right: r.right, top: r.top, mid: r.top + r.height / 2 };
        });
      return { h: t.height, kids };
    });
    expect(bar.h, 'one row, not wrapped').toBeLessThan(80);
    for (const k of bar.kids) {
      expect(k.left).toBeGreaterThanOrEqual(0);
      expect(k.right).toBeLessThanOrEqual(width);
    }
    const mids = bar.kids.map((k) => k.mid);
    expect(Math.max(...mids) - Math.min(...mids), 'all on one line (their centres line up)').toBeLessThan(10);
  });
}
