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
      await expect(page.locator('#history-list button.chat-row').first()).toBeVisible();

      expect(await page.evaluate(() => matchMedia('(pointer: fine) and (hover: hover)').matches)).toBe(true);
      expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--size-control-sm').trim())).toBe('2rem');

      const list = (await rows(page, '.side-row')).sort((a, b) => a.top - b.top);
      expect(list.length, 'new chat, search, section rows, a chat title and the account row').toBeGreaterThanOrEqual(8);
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

    test(`the account row is the only thing in the foot; the links inside Settings are text only (${scheme})`, async ({ page }) => {
      await openChat(page);
      expect((await rows(page, '.side-foot > .side-nav > #open-settings')).map((r) => r.text)).toEqual(['Settings']);
      await page.locator('#open-settings').click();
      const links = await rows(page, '.settings-dialog a.side-row');
      expect(links.map((r) => r.text.replace(/\(opens in a new tab\)/, '').trim())).toEqual(['Disclaimer and privacy', 'Use the API']);
      for (const r of links) expect(r.svgs, `${r.text} has no icon`).toBe(0);
    });
  });
}

// ---- the geometry guard: widths a desktop browser really has, light and dark ------------------------------------------------
// No label wraps (a word is never broken, a chip stays on one line), nothing scrolls sideways, the sidebar is a fixed column wide
// enough for its labels, the top bar's actions say what they are, and nothing is a marketing pill. At 1000px the drawer is a
// popover (below 64rem) and keeps the touch size; from 1024px it is a column of 32px rows.

/** How many lines a piece of text is drawn on: the number of distinct tops among its client rects. */
const lines = (page: Page, selector: string) =>
  page.locator(selector).evaluateAll((els) =>
    els
      .filter((e) => (e as HTMLElement).offsetParent !== null || getComputedStyle(e).position === 'fixed')
      .map((e) => {
        const range = document.createRange();
        range.selectNodeContents(e);
        const tops = new Set([...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top)));
        return { text: (e.textContent || '').trim().slice(0, 40), lines: tops.size };
      }),
  );

for (const width of [1000, 1280, 1440]) {
  for (const scheme of ['light', 'dark'] as const) {
    test(`at ${width}px (${scheme}): no label wraps, nothing scrolls sideways, the sidebar and top bar are right`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ width, height: 800 });
      await openChat(page);
      const popover = width < 1024;
      if (popover) await page.getByRole('button', { name: 'Open chats' }).click();
      await page.waitForTimeout(400); // the drawer's slide

      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no horizontal scroll').toBe(true);

      // Every row label and chip is one line: "Factory" is not "Factor / y", "Coming soon" is not two lines.
      // (the visible spans only: the screen-reader-only note on Use the API is clipped text, not a drawn line)
      const labels = await lines(page, '.side-row > span:not(.sr-only, .chat-row-title, .chat-row-when)');
      expect(labels.length).toBeGreaterThanOrEqual(7);
      for (const l of labels) expect(l.lines, `"${l.text}" is on one line`).toBe(1);
      const inert = await page.locator('.side-row.side-disabled').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height));
      expect(inert).toHaveLength(2); // Factory and Plugins
      for (const h of inert) expect(h, 'a coming-soon row is one row high, chip included').toBeLessThanOrEqual(popover ? 50 : 33);

      if (!popover) {
        const w = await page.locator('[data-slot="app-sidebar"]').evaluate((el) => el.getBoundingClientRect().width);
        expect(w, 'a slim sidebar column of about 280px').toBeGreaterThanOrEqual(272);
        expect(w).toBeLessThanOrEqual(288);
      }
      // The sidebar's own labels fit their rows without being cut (no horizontal overflow inside the drawer).
      expect(await page.locator('.chats').evaluate((el) => el.scrollWidth <= el.clientWidth + 1), 'the drawer does not scroll sideways').toBe(true);

      // The top bar says what its actions are (from 40rem up).
      // Really drawn, not just present: a 1px clipped box counts as "visible" to Playwright, so measure the box and the clipping.
      for (const sel of ['#offline-mode .bar-label', '#new-chat .bar-label']) {
        const drawn = await page.locator(sel).evaluate((el) => {
          const c = getComputedStyle(el);
          const r = el.getBoundingClientRect();
          return { w: r.width, h: r.height, clipPath: c.clipPath, overflow: c.overflow, clip: c.clip };
        });
        expect(drawn.w, `${sel} is drawn`).toBeGreaterThan(40);
        expect(drawn.h, `${sel} is a line of text`).toBeGreaterThan(14);
        expect(drawn.clipPath, `${sel} is not clipped away`).toBe('none');
        expect(drawn.overflow).toBe('visible');
      }
      await expect(page.locator('#offline-mode')).toContainText('Offline mode');
      await expect(page.locator('#offline-mode')).toContainText('Off');
    });
  }
}

test('no control is a marketing pill except the suggested prompts (Mzizi\'s pills) and Send: buttons use the small radius, the composer a soft one', async ({ page }) => {
  await openChat(page);
  const radii = await page.evaluate(() => {
    const r = (sel: string) => {
      const el = document.querySelector(sel);
      return el ? parseFloat(getComputedStyle(el).borderTopLeftRadius) : null;
    };
    return { newChat: r('#side-new'), composer: r('.composer') };
  });
  for (const [name, v] of Object.entries(radii)) {
    expect(v, name).not.toBeNull();
    expect(v!, `${name} is not a pill`).toBeLessThanOrEqual(16);
  }
  // The suggested prompts are the one exception: pills, as Mzizi's suggested-prompts component draws them.
  expect(await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.btn.chip')!).borderTopLeftRadius))).toBeGreaterThan(100);
});

test('hierarchy: New chat is a plain row, the round send button is the one filled control and is muted until there is text', async ({ page }) => {
  await openChat(page);
  const bg = (sel: string) => page.locator(sel).first().evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(await bg('#side-new'), 'New chat has no fill').toBe('rgba(0, 0, 0, 0)');
  await expect(page.locator('#send')).toBeDisabled();
  const muted = await bg('#send');
  await page.locator('#q').fill('hello');
  await expect(page.locator('#send')).toBeEnabled();
  expect(await bg('#send'), 'Send fills in once there is text').not.toBe(muted);
  expect(await page.locator('#send').evaluate((el) => getComputedStyle(el).borderTopLeftRadius), 'a round button').toBe('50%');
});

test('clutter is gone: the version line is in Settings (not the drawer foot) and Install is in Settings (not above the composer)', async ({ page }) => {
  await openChat(page);
  await expect(page.locator('.side-foot > .version-line')).toHaveCount(0);
  await expect(page.locator('#settings-dialog .version-line')).toHaveCount(1);
  await expect(page.locator('#settings-dialog #install')).toHaveCount(1);
  await expect(page.locator('.thread #install, #empty #install')).toHaveCount(0);
  await expect(page.locator('p.install')).toHaveCount(0);
});

test('a chat row shows its "..." on hover (over the time) and keeps a 32px hit region', async ({ page }) => {
  await openChat(page);
  await ask(page, 'Is it legal?');
  await expect(page.locator('.cite-link').first()).toBeVisible();
  await page.locator('#side-new').click();
  // The list is drawn again when a question finishes (after its answer is on the screen), which can land just around this click and
  // REPLACES the row. An element read in that moment is detached, and a detached element has no computed style (opacity reads as
  // ""). So every check below is an assertion that looks the row up again each time it tries, never a value read once.
  const li = page.locator('#history-list li.chat-li').first();
  const more = li.locator('.row-more');
  await expect(li).toBeVisible();
  await expect(more, 'hidden at rest').toHaveCSS('opacity', '0');
  await li.hover();
  await expect(more, 'shown on hover').toHaveCSS('opacity', '1');
  await expect(li.locator('.chat-row-when')).toHaveCSS('visibility', 'hidden');
  await expect.poll(async () => Math.round((await more.boundingBox())?.height ?? 0), 'a 32px hit region').toBe(32);
  await more.click();
  await expect(page.locator('#row-menu')).toBeVisible();
});
