import { expect, test, type Page } from '@playwright/test';
import { openAccount, openChat, openChats } from './helpers';

// The account row and the links in Settings (Use the API, Disclaimer and privacy) are quiet rows, not buttons.

const ROWS = [{ name: 'Use the API' }, { name: 'Disclaimer and privacy' }, { name: 'Settings' }];

/**
 * Any CSS colour (rgb, oklab, color-mix results...) as 8-bit sRGB: the browser itself paints it on a canvas and the pixel
 * is read back. A computed `color-mix()` is serialised as oklab(), so its numbers cannot be read as RGB channels.
 */
const toRgb = (page: Page, colour: string) =>
  page.evaluate((c) => {
    const ctx = document.createElement('canvas').getContext('2d')!;
    ctx.fillStyle = '#000';
    ctx.fillStyle = c;
    ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2]] as [number, number, number];
  }, colour);

/** WCAG contrast ratio of two sRGB colours. */
const ratio = (a: [number, number, number], b: [number, number, number]) => {
  const lum = ([r, g, bl]: [number, number, number]) => {
    const [R, G, B] = [r, g, bl].map((v) => {
      const x = v / 255;
      return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * R + 0.7152 * G + 0.0722 * B;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const row = (page: Page, name: string) =>
  name === 'Settings' ? page.locator('#open-settings') : page.getByRole('link', { name });

test('the foot rows are quiet text rows, not buttons: no button chrome, no icon, the same names', async ({ page }) => {
  await openChat(page);
  await openChats(page);
  await openAccount(page);
  await page.mouse.move(0, 0); // not over a row: a hovered row is filled
  for (const { name } of ROWS) {
    const r = row(page, name);
    await expect(r, name).toBeVisible();
    await expect(r, name).not.toHaveClass(/\bbtn\b/);
    await expect(r, name).toHaveClass(/side-row/);
    const style = await r.evaluate((el) => {
      const c = getComputedStyle(el);
      return { bg: c.backgroundColor, border: c.borderTopWidth, shadow: c.boxShadow, height: el.getBoundingClientRect().height, radius: c.borderRadius };
    });
    expect(style.bg, `${name} has no fill`).toBe('rgba(0, 0, 0, 0)');
    expect(parseFloat(style.border), `${name} has no outline`).toBe(0);
    // On touch the row is the 49px hit region (small-android here); a desktop mouse gets Mzizi's 32px (e2e-desktop/density.spec.ts).
    expect(style.height, `${name} keeps the 49px hit region on touch`).toBeGreaterThanOrEqual(49);
    // Text only: the foot rows have no icon of any kind (owner, 2026-11-12), not even the "opens in a new tab" mark; the
    // label (and, for Use the API, a screen-reader note) carries the meaning.
    if (name !== 'Settings') await expect(r.locator('svg'), `${name} has no icon`).toHaveCount(0); // the account row has its avatar and gear
    await expect(r, name).toContainText(name);
  }
  // The names a screen reader hears are unchanged: links are links, and Settings is a button that opens a dialog.
  await expect(page.getByRole('link', { name: 'Use the API' })).toHaveAttribute('href', 'https://platform.nyuchi.com');
  await expect(page.getByRole('link', { name: 'Disclaimer and privacy' })).toHaveAttribute('href', '/lite/disclaimer/');
  await expect(page.locator('#open-settings')).toHaveText('Settings');
});

test('muted text on the drawer surface keeps its contrast, in light and in dark, and hover and focus are clear', async ({ page }) => {
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await openChat(page);
    await openChats(page);
    await openAccount(page);
    const surface = await toRgb(page, await page.locator('[data-slot="app-sidebar"]').evaluate((el) => getComputedStyle(el).backgroundColor));
    for (const { name } of ROWS) {
      const r = row(page, name);
      const colour = await toRgb(page, await r.evaluate((el) => getComputedStyle(el).color));
      // The row is body-size text, so the Bundu floor's 7:1 applies (the shared muted token is about 6:1 here, which is why
      // the rows do not use it).
      expect(ratio(colour, surface), `${name} in ${scheme}`).toBeGreaterThanOrEqual(7);
    }
    // Hover: a soft fill appears and the text steps up to full strength.
    const r = row(page, 'Use the API');
    await page.mouse.move(0, 0); // the pointer may still rest where an earlier tap was, which can be over this row
    const before = await r.evaluate((el) => getComputedStyle(el).color);
    await r.hover();
    const hovered = await r.evaluate((el) => ({ bg: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color }));
    expect(hovered.bg).not.toBe('rgba(0, 0, 0, 0)');
    expect(hovered.color).not.toBe(before);
    expect(ratio(await toRgb(page, hovered.color), await toRgb(page, hovered.bg)), `hover in ${scheme}`).toBeGreaterThanOrEqual(7);
    // Focus by keyboard (so it is :focus-visible): from the disclaimer row, Tab lands on Use the API, and the page's ring is on it.
    await row(page, 'Disclaimer and privacy').focus();
    await page.keyboard.press('Tab');
    await expect(r).toBeFocused();
    expect(await r.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('solid');
    expect(parseFloat(await r.evaluate((el) => getComputedStyle(el).outlineWidth))).toBeGreaterThanOrEqual(2);
  }
});

test('a long chat title wraps inside the drawer instead of widening it', async ({ page }) => {
  await openChat(page);
  await openChats(page);
  await page.evaluate(() => {
    const list = document.querySelector('#history-list')!;
    for (const title of ['An extremely long chat title that goes on and on about the Constitution and the rights of every person in Zimbabwe', 'Unbroken' + 'x'.repeat(80)]) {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.className = 'btn link';
      b.textContent = title;
      li.append(b);
      list.append(li);
    }
    (document.querySelector('#side-chats') as HTMLElement).hidden = false;
  });
  const m = await page.evaluate(() => {
    const el = document.querySelector('.chats') as HTMLElement;
    const side = document.querySelector('#chat-sidebar') as HTMLElement;
    return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, sideRight: side.getBoundingClientRect().right, maxRight: Math.max(...[...document.querySelectorAll('#history-list button.chat-row')].map((b) => b.getBoundingClientRect().right)) };
  });
  expect(m.scrollWidth, 'nothing in the drawer scrolls sideways').toBeLessThanOrEqual(m.clientWidth);
  expect(m.maxRight, 'every title ends inside the drawer').toBeLessThanOrEqual(m.sideRight);
});
