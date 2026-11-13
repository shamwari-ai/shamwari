import { expect, test, type Page } from '@playwright/test';
import { openChat } from './helpers';

// Updates are forced: a new release's service worker takes over at once and the page reloads ONCE, not while something is
// being written, and never in a loop. The e2e server turns /__sw/bump into "a new release" (it changes sw.js).

// The e2e server's /__sw/bump counter is shared by every page it serves, so these tests must not run side by side: one test's
// "new release" would reach another test's page in the middle of it and reload it. Run the file's tests one after another.
test.describe.configure({ mode: 'default' });

// Each test waits through a real worker install, a takeover and a guard window: allow for a loaded CI machine.
test.beforeEach(() => test.setTimeout(60_000));
// Leave nothing running behind the test: a worker that is mid-takeover can hold the browser context open on teardown.
test.afterEach(async ({ page }) => {
  await page
    .evaluate(async () => {
      for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
    })
    .catch(() => {});
  await page.close().catch(() => {});
});

const controlled = (page: Page) =>
  page.waitForFunction(() => !!navigator.serviceWorker.controller, undefined, { timeout: 15_000 });

/** Mark this page load, so a reload shows up as the mark disappearing. */
const mark = (page: Page, name: string) => page.evaluate((n) => ((window as unknown as Record<string, boolean>)[n] = true), name);
// A page that is navigating away throws on evaluate: that IS the reload, so it reads as "mark gone".
const marked = (page: Page, name: string) =>
  page.evaluate((n) => !!(window as unknown as Record<string, boolean>)[n], name).catch(() => false);

/** Publish a new release and ask for it, as the hourly check would. */
async function release(page: Page) {
  const base = new URL(page.url()).origin;
  expect((await page.request.get(`${base}/__sw/bump`)).ok()).toBe(true);
  await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration('/lite/');
    await reg?.update();
  });
}

test('a new release takes over and the page reloads exactly once', async ({ page }) => {
  await openChat(page);
  await controlled(page);
  await mark(page, 'before');
  await release(page);
  await expect.poll(() => marked(page, 'before'), { timeout: 15_000 }).toBe(false); // reloaded
  await expect(page.locator('#q')).toBeVisible();
  await controlled(page);
  // The reload is recorded, and the page that came back is the new release's: its worker is the one in charge.
  expect(await page.evaluate(() => sessionStorage.getItem('shamwari.updateReload'))).not.toBeNull();
  // Exactly once: the fresh page is not reloaded again by the takeover that caused it.
  await mark(page, 'after');
  await page.waitForTimeout(3000);
  expect(await marked(page, 'after')).toBe(true);
});

test('LOOP GUARD: a second release right after an update reload does not reload the page at once (it waits out the guard window)', async ({ page }) => {
  await openChat(page);
  await controlled(page);
  await mark(page, 'first');
  await release(page);
  await expect.poll(() => marked(page, 'first'), { timeout: 15_000 }).toBe(false);
  await controlled(page);
  await mark(page, 'second');
  await release(page); // another takeover inside the guard window
  await page.waitForTimeout(4000);
  expect(await marked(page, 'second'), 'the page stayed put').toBe(true);
});

test('NEVER MID-DRAFT: a release waits while there is text in the question box, and reloads once it is cleared', async ({ page }) => {
  await openChat(page);
  await controlled(page);
  await page.locator('#q').fill('a question I am still writing');
  await mark(page, 'draft');
  await release(page);
  await page.waitForTimeout(4000); // plenty of time for the takeover
  expect(await marked(page, 'draft'), 'not reloaded while writing').toBe(true);
  await expect(page.locator('#q')).toHaveValue('a question I am still writing');
  await page.locator('#q').fill('');
  await expect.poll(() => marked(page, 'draft'), { timeout: 15_000 }).toBe(false); // right after it settles
});

test('a question sent while a release is waiting is not lost: it is on the device after the reload', async ({ page }) => {
  await openChat(page);
  await controlled(page);
  await page.locator('#q').fill('Is everyone equal under the law?');
  await mark(page, 'sending');
  await release(page);
  await page.waitForTimeout(3000); // the takeover has happened; the reload is waiting for the box to be empty
  expect(await marked(page, 'sending')).toBe(true);
  await page.locator('#q').press('Enter'); // clears the box AND starts the ask: the page must not reload in between
  await expect.poll(() => marked(page, 'sending'), { timeout: 20_000 }).toBe(false); // reloaded, once the answer has settled
  await expect(page.locator('#log')).toContainText('Is everyone equal under the law?'); // kept on the device
  await expect(page.locator('.cite-link').first()).toBeVisible(); // and so is its answer, with its citation
});
