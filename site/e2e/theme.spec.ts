import { expect, test, type Page } from '@playwright/test';
import { openChat } from './helpers';

// Light and dark are Mzizi's themes (@bundu/ui tokens.css + color-scheme.css), and the page follows the device: with
// prefers-color-scheme dark the background and text tokens change, an explicit data-theme="light" wins over a dark device, and
// the pieces of the page (page, drawer, top bar) all take the token colours, not the browser's own black and white. This was
// broken once: nothing set .dark or data-theme and color-scheme.css was not imported, so a dark phone got a light page with
// white text.

const colours = (page: Page) =>
  page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    const probe = document.createElement('i');
    const resolve = (cssVar: string) => {
      probe.style.color = `var(${cssVar})`;
      document.body.append(probe);
      const c = getComputedStyle(probe).color;
      probe.remove();
      return c;
    };
    const bg = (sel: string) => getComputedStyle(document.querySelector(sel)!).backgroundColor;
    return {
      pageBg: getComputedStyle(document.body).backgroundColor,
      pageText: getComputedStyle(document.body).color,
      tokenBackground: resolve('--background'),
      tokenForeground: resolve('--foreground'),
      drawerBg: bg('[data-slot="app-sidebar"]'),
      schemes: root.colorScheme,
    };
  });

test('with a dark device the background and text tokens change, and the page, not just the browser, follows them', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await openChat(page);
  const light = await colours(page);
  await page.emulateMedia({ colorScheme: 'dark' });
  const dark = await colours(page);

  expect(dark.tokenBackground, 'the background token differs between light and dark').not.toBe(light.tokenBackground);
  expect(dark.tokenForeground, 'the text token differs between light and dark').not.toBe(light.tokenForeground);
  for (const [name, c] of [['light', light], ['dark', dark]] as const) {
    expect(c.pageBg, `${name}: the page background is the background token`).toBe(c.tokenBackground);
    expect(c.pageText, `${name}: the page text is the foreground token`).toBe(c.tokenForeground);
    expect(c.drawerBg, `${name}: the drawer is drawn in the background token`).toBe(c.tokenBackground);
  }
  expect(dark.pageBg).not.toBe(light.pageBg);
  // A dark page is dark and its text is light, and the other way round: contrast is real, not just different.
  const lum = (rgb: string) => {
    const [r, g, b] = rgb.match(/\d+/g)!.map(Number).map((v) => v / 255);
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  };
  expect(lum(dark.pageBg)).toBeLessThan(lum(dark.pageText));
  expect(lum(light.pageBg)).toBeGreaterThan(lum(light.pageText));
});

test('an explicit data-theme="light" wins over a dark device, and data-theme="dark" over a light one', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await openChat(page);
  const light = await colours(page);
  await page.emulateMedia({ colorScheme: 'dark' });
  const dark = await colours(page);

  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
  const forcedLight = await colours(page);
  expect(forcedLight.pageBg).toBe(light.pageBg);
  expect(forcedLight.pageText).toBe(light.pageText);
  expect(forcedLight.drawerBg).toBe(light.drawerBg);

  await page.emulateMedia({ colorScheme: 'light' });
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  const forcedDark = await colours(page);
  expect(forcedDark.pageBg).toBe(dark.pageBg);
  expect(forcedDark.pageText).toBe(dark.pageText);
});

test('the brand colour is the same sodalite family in both themes (the overlay comes after the theme)', async ({ page }) => {
  await openChat(page);
  const primary = async (scheme: 'light' | 'dark') => {
    await page.emulateMedia({ colorScheme: scheme });
    return page.evaluate(() => {
      const probe = document.createElement('i');
      probe.style.color = 'var(--primary)';
      document.body.append(probe);
      const c = getComputedStyle(probe).color;
      const s = document.createElement('i');
      s.style.color = 'var(--color-sodalite)';
      document.body.append(s);
      const sod = getComputedStyle(s).color;
      probe.remove();
      s.remove();
      return { c, sod };
    });
  };
  for (const scheme of ['light', 'dark'] as const) {
    const { c, sod } = await primary(scheme);
    expect(c, `${scheme}: --primary is sodalite`).toBe(sod);
  }
});

// Muted text (captions, the group labels, the placeholder) must be readable in BOTH themes: at least 4.5:1 on the page and on
// the hover fill. (The drawer's row labels use a stronger mix, held to 7:1 in drawer.spec.ts.) The values are asserted, not assumed.
test('muted text is at least 4.5:1 on the background and on the hover fill, in light and in dark', async ({ page }) => {
  await openChat(page);
  const lum = (rgb: string) => {
    const [r, g, b] = (rgb.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number).map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  };
  const ratio = (a: string, b: string) => {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (hi! + 0.05) / (lo! + 0.05);
  };
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    const c = await page.evaluate(() => {
      const resolve = (v: string) => {
        const probe = document.createElement('i');
        probe.style.color = `var(${v})`;
        document.body.append(probe);
        const out = getComputedStyle(probe).color;
        probe.remove();
        return out;
      };
      return { muted: resolve('--muted-foreground'), bg: resolve('--background'), fill: resolve('--muted'), fg: resolve('--foreground') };
    });
    expect(ratio(c.muted, c.bg), `${scheme}: muted text on the page`).toBeGreaterThanOrEqual(4.5);
    expect(ratio(c.muted, c.fill), `${scheme}: muted text on the hover fill`).toBeGreaterThanOrEqual(4.5);
    expect(ratio(c.fg, c.bg), `${scheme}: body text on the page`).toBeGreaterThanOrEqual(7);
  }
});
