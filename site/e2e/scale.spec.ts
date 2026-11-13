import { expect, test } from '@playwright/test';
import { ask, openAccount, openChat, openChats, underTheFloor } from './helpers';

// Do the components scale? The same screens at the widths people really have (320, 390, 768, 1024, 1440), in light and dark,
// with a finger (coarse pointer, no hover) and with a mouse (fine pointer, hover): nothing scrolls sideways, nothing is under the
// Bundu floor, the thread keeps a readable measure, and the density layer picks the size by pointer and width the way it says
// (49px hit regions with a finger or below 64rem, the 32px density size only with a mouse from 64rem).

const WIDTHS = [320, 390, 768, 1024, 1440];
const REM = 16;

for (const pointer of ['touch', 'mouse'] as const) {
  test.describe(`${pointer}`, () => {
    test.use(pointer === 'touch' ? { hasTouch: true, isMobile: true } : { hasTouch: false, isMobile: false });
    for (const scheme of ['light', 'dark'] as const) {
      for (const width of WIDTHS) {
        test(`${width}px, ${scheme}, ${pointer}: no sideways scroll, nothing under the floor, a readable measure, the right control size`, async ({ page }) => {
          await page.emulateMedia({ colorScheme: scheme });
          await page.setViewportSize({ width, height: 900 });
          await openChat(page);
          const wide = width >= 64 * REM;

          expect(await page.evaluate(() => document.documentElement.scrollWidth), 'the page does not scroll sideways').toBeLessThanOrEqual(width);
          // The density size (32px) is allowed only with a mouse from 64rem; everywhere else the hit region is 49px.
          const floor = { minHit: wide && pointer === 'mouse' ? 32 : 49 };
          expect(await underTheFloor(page, floor), 'home').toEqual([]);

          // The measure: the messages, the home screen and the composer keep one centred column of at most 46rem on a big screen.
          const measure = await page.evaluate(() => ({
            empty: document.querySelector('#empty')!.getBoundingClientRect().width,
            log: document.querySelector('#log')!.getBoundingClientRect().width,
            ask: document.querySelector('.ask')!.getBoundingClientRect().width,
          }));
          for (const [name, w] of Object.entries(measure)) expect(w, `${name} column`).toBeLessThanOrEqual(46 * REM + 1);

          // Control sizes follow the pointer and the width: a finger always gets the 49px hit region; a mouse gets the density
          // size only from 64rem, and only for controls that follow the density layer.
          const plus = (await page.locator('#plus').boundingBox())!;
          if (wide && pointer === 'mouse') expect(plus.height, '#plus with a mouse on a desktop').toBeLessThan(40);
          else expect(plus.height, '#plus is the 49px hit region').toBeGreaterThanOrEqual(49);
          const sizes = await page.evaluate(() =>
            [...document.querySelectorAll<HTMLElement>('.side-primary .side-row:not(.side-disabled), #side-new')]
              .filter((e) => e.offsetParent !== null)
              .map((e) => Math.round(e.getBoundingClientRect().height)),
          );
          if (wide && pointer === 'mouse') for (const h of sizes) expect(h, 'a drawer row with a mouse on a desktop').toBeLessThan(40);
          else if (sizes.length) for (const h of sizes) expect(h, `a drawer row at ${width}px with ${pointer}`).toBeGreaterThanOrEqual(49);

          if (!wide) {
            await openChats(page);
            expect(await underTheFloor(page, floor), 'drawer open').toEqual([]);
            await page.keyboard.press('Escape');
          }
          if (wide) await page.locator('#open-settings').click(); // the sidebar is a column here: no drawer to open first
          else await openAccount(page);
          await expect(page.locator('#settings-dialog')).toBeVisible();
          expect(await underTheFloor(page, floor), 'settings open').toEqual([]);
          expect(await page.evaluate(() => document.documentElement.scrollWidth), 'settings does not scroll sideways').toBeLessThanOrEqual(width);
        });
      }
    }
  });
}

test('the sidebar is the same width as the drawer, so crossing 64rem does not make it jump', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 800 });
  await openChat(page);
  await openChats(page);
  const drawer = (await page.locator('#chat-sidebar').boundingBox())!.width;
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1100, height: 800 });
  await openChat(page);
  const column = (await page.locator('#chat-sidebar').boundingBox())!.width;
  expect(Math.abs(drawer - column), `drawer ${drawer}px, column ${column}px`).toBeLessThanOrEqual(1);
});

// A conversation, not just the home screen: a question, its answer with a source, and the message's own actions.
for (const pointer of ['touch', 'mouse'] as const) {
  test.describe(`conversation, ${pointer}`, () => {
    test.use(pointer === 'touch' ? { hasTouch: true, isMobile: true } : { hasTouch: false, isMobile: false });
    for (const width of WIDTHS) {
      test(`${width}px, ${pointer}: an answer with its source and actions fits, keeps the measure and meets the floor`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await openChat(page);
        await ask(page, 'Is everyone equal under the law?');
        await expect(page.locator('.cite-link').first()).toBeVisible();
        const floor = { minHit: width >= 64 * REM && pointer === 'mouse' ? 32 : 49 };
        expect(await underTheFloor(page, floor), 'conversation').toEqual([]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
        expect(await page.locator('#log').evaluate((el) => el.getBoundingClientRect().width), 'the messages column').toBeLessThanOrEqual(46 * REM + 1);
      });
    }
  });
}
