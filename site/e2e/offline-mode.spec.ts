import { expect, test, type Page } from '@playwright/test';
import { ask, openChat } from './helpers';

// OFFLINE MODE: a switch at the top right. While it is on nothing is sent, no queue replays, and it is remembered.

const OFFLINE_KEY = 'shamwari.offlineMode';
const sw = (page: Page) => page.getByRole('switch', { name: /offline mode/i });

/** Every request the page itself makes with fetch, XHR, a beacon, an event stream or a socket. */
const watchNetwork = (page: Page) => {
  const seen: string[] = [];
  page.on('request', (r) => {
    if (['fetch', 'xhr', 'ping', 'eventsource', 'websocket'].includes(r.resourceType())) seen.push(`${r.method()} ${new URL(r.url()).host}${new URL(r.url()).pathname}`);
  });
  return seen;
};

test('the switch is at the top right of the top bar, a real switch, with the floor size and a visible state', async ({ page }) => {
  await openChat(page);
  const s = sw(page);
  await expect(s).toBeVisible();
  await expect(s).toHaveAttribute('aria-checked', 'false');
  const [b, bar] = await Promise.all([s.boundingBox(), page.locator('[data-slot="app-topbar"]').boundingBox()]);
  const width = page.viewportSize()!.width;
  expect(b!.x + b!.width / 2, 'in the right half').toBeGreaterThan(width / 2);
  expect(b!.y).toBeGreaterThanOrEqual(bar!.y);
  expect(b!.y + b!.height).toBeLessThanOrEqual(bar!.y + bar!.height);
  expect(b!.height).toBeGreaterThanOrEqual(49);
  expect(b!.width).toBeGreaterThanOrEqual(49);
  expect(b!.x + b!.width, 'inside the screen with a 14px edge').toBeLessThanOrEqual(width - 14);
  await expect(s).toContainText('Off');
  await s.click();
  await expect(s).toHaveAttribute('aria-checked', 'true');
  await expect(s).toContainText('On');
  await expect(page.locator('#offline-mode-note')).toBeVisible();
  await expect(page.locator('#offline-mode-note')).toContainText('Nothing is sent');
});

test('it is remembered across reloads', async ({ page }) => {
  await openChat(page);
  await sw(page).click();
  await page.reload();
  await page.waitForSelector('html[data-ready="true"]');
  await expect(sw(page)).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('#offline-mode-note')).toBeVisible();
  expect(await page.evaluate((k) => localStorage.getItem(k), OFFLINE_KEY)).toBe('1');
  await sw(page).click();
  await page.reload();
  await page.waitForSelector('html[data-ready="true"]');
  await expect(sw(page)).toHaveAttribute('aria-checked', 'false');
});

test('while it is on, nothing is sent: not on load, not when asking, not when the network comes back', async ({ page, context }) => {
  await page.addInitScript((k) => localStorage.setItem(k, '1'), OFFLINE_KEY);
  const seen = watchNetwork(page);
  await openChat(page);
  await expect(sw(page)).toHaveAttribute('aria-checked', 'true');
  await ask(page, 'Is everyone equal under the law?');
  const q = page.locator('article.msg.user').first();
  await expect(q).toContainText('Is everyone equal');
  await expect(q).toContainText('Saved on this device only. Not sent.');
  // Network away and back, and the tab hidden and shown: none of it replays anything.
  await context.setOffline(true);
  await ask(page, 'A second question');
  await context.setOffline(false);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForTimeout(1500);
  expect(seen, 'no network request while offline mode is on').toEqual([]);
  await expect(page.locator('article.msg.bot')).toHaveCount(0);
});

test('a question written in the mode is kept on the device across a reload, still not sent, with no button that sends it', async ({ page }) => {
  await openChat(page);
  await sw(page).click();
  await ask(page, 'Is everyone equal under the law?');
  // The note appears only once the question is written to the device, so a reload after it cannot lose the question.
  await expect(page.locator('article.msg.user').first()).toContainText('Saved on this device only. Not sent.');
  const seen = watchNetwork(page);
  await page.reload();
  await page.waitForSelector('html[data-ready="true"]');
  const q = page.locator('article.msg.user').first();
  await expect(q).toContainText('Is everyone equal');
  await expect(q).toContainText('Saved on this device only. Not sent.');
  await expect(q.getByRole('button', { name: 'Send now' })).toHaveCount(0);
  await page.waitForTimeout(1000);
  expect(seen).toEqual([]);
});

test('turning it off sends nothing by itself; "Send now" is the person\'s own act, and Discard removes it', async ({ page }) => {
  await openChat(page);
  await sw(page).click();
  await ask(page, 'Is everyone equal under the law?');
  await ask(page, 'to be discarded');
  const seen = watchNetwork(page);
  await sw(page).click(); // off
  await expect(sw(page)).toHaveAttribute('aria-checked', 'false');
  await page.waitForTimeout(1200);
  expect(seen.filter((s) => s.includes('/v1/')), 'turning the mode off does not send what was written in it').toEqual([]);
  const first = page.locator('article.msg.user').first();
  await expect(first).toContainText('Saved on this device only. Not sent.');
  await page.locator('article.msg.user').nth(1).getByRole('button', { name: 'Discard' }).click();
  await expect(page.locator('article.msg.user')).toHaveCount(1);
  await first.getByRole('button', { name: 'Send now' }).click();
  await expect(page.locator('article.msg.bot .cite').first()).toBeVisible();
  expect(seen.some((s) => s.includes('/v1/'))).toBe(true);
});

test('a question queued before the mode went on does not replay while it is on, and resumes when it goes off', async ({ page, context }) => {
  await openChat(page);
  await context.setOffline(true);
  await ask(page, 'Is everyone equal under the law?');
  await expect(page.locator('article.msg.user.queued')).toHaveCount(1);
  await sw(page).click(); // on
  const seen = watchNetwork(page);
  await context.setOffline(false);
  await page.waitForTimeout(2500);
  expect(seen.filter((s) => s.includes('/v1/')), 'nothing replays while the mode is on').toEqual([]);
  await sw(page).click(); // off: the normal retry resumes for what was queued before
  await expect(page.locator('article.msg.bot .cite').first()).toBeVisible();
});
