import { expect, test, type Page } from '@playwright/test';
import { ask, openAccount, openChat } from './helpers';

// OFFLINE MODE: a switch in Settings, with a badge in the top bar only while it is on. While it is on nothing is sent, no queue replays, and it is remembered.

const OFFLINE_KEY = 'shamwari.offlineMode';
const state = (page: Page) => page.locator('#offline-mode');
/** Flip the switch in Settings, then close Settings so the page is reachable again. */
const toggle = async (page: Page) => {
  await openAccount(page);
  await page.getByRole('switch', { name: /offline mode/i }).click();
  await page.keyboard.press('Escape');
  await expect(page.locator('#settings-dialog')).toBeHidden();
};

/** Every request the page itself makes with fetch, XHR, a beacon, an event stream or a socket. */
const watchNetwork = (page: Page) => {
  const seen: string[] = [];
  page.on('request', (r) => {
    if (['fetch', 'xhr', 'ping', 'eventsource', 'websocket'].includes(r.resourceType())) seen.push(`${r.method()} ${new URL(r.url()).host}${new URL(r.url()).pathname}`);
  });
  return seen;
};

test('the switch is in Settings, a real switch with the floor size and a visible state; the top bar shows a badge only while it is on', async ({ page }) => {
  await openChat(page);
  await expect(page.locator('#offline-badge'), 'no badge while it is off').toBeHidden();
  await openAccount(page);
  const s = page.getByRole('switch', { name: /offline mode/i });
  await expect(s).toBeVisible();
  await expect(s).toHaveAttribute('aria-checked', 'false');
  const b = await s.boundingBox();
  expect(b!.height).toBeGreaterThanOrEqual(32);
  await expect(s).toContainText('Off');
  await s.click();
  await expect(s).toHaveAttribute('aria-checked', 'true');
  await expect(s).toContainText('On');
  await page.keyboard.press('Escape');
  await expect(page.locator('#offline-mode-note')).toBeVisible();
  await expect(page.locator('#offline-mode-note')).toContainText('Nothing is sent');
  const badge = page.locator('#offline-badge');
  await expect(badge).toBeVisible();
  await expect(badge).toContainText('Offline mode');
  const bar = (await page.locator('[data-slot="app-topbar"]').boundingBox())!;
  const bb = (await badge.boundingBox())!;
  expect(bb.height).toBeGreaterThanOrEqual(49);
  expect(bb.x + bb.width, 'inside the screen with a 14px edge').toBeLessThanOrEqual(page.viewportSize()!.width - 14);
  expect(bb.y).toBeGreaterThanOrEqual(bar.y);
  // The badge opens Settings, where the switch is.
  await badge.click();
  await expect(page.locator('#settings-dialog')).toBeVisible();
});

test('it is remembered across reloads', async ({ page }) => {
  await openChat(page);
  await toggle(page);
  await page.reload();
  await page.waitForSelector('html[data-ready="true"]');
  await expect(state(page)).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('#offline-mode-note')).toBeVisible();
  expect(await page.evaluate((k) => localStorage.getItem(k), OFFLINE_KEY)).toBe('1');
  await toggle(page);
  await page.reload();
  await page.waitForSelector('html[data-ready="true"]');
  await expect(state(page)).toHaveAttribute('aria-checked', 'false');
});

test('while it is on, nothing is sent: not on load, not when asking, not when the network comes back', async ({ page, context }) => {
  await page.addInitScript((k) => localStorage.setItem(k, '1'), OFFLINE_KEY);
  const seen = watchNetwork(page);
  await openChat(page);
  await expect(state(page)).toHaveAttribute('aria-checked', 'true');
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
  await toggle(page);
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
  await toggle(page);
  await ask(page, 'Is everyone equal under the law?');
  await ask(page, 'to be discarded');
  const seen = watchNetwork(page);
  await toggle(page); // off
  await expect(state(page)).toHaveAttribute('aria-checked', 'false');
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
  await toggle(page); // on
  const seen = watchNetwork(page);
  await context.setOffline(false);
  await page.waitForTimeout(2500);
  expect(seen.filter((s) => s.includes('/v1/')), 'nothing replays while the mode is on').toEqual([]);
  await toggle(page); // off: the normal retry resumes for what was queued before
  await expect(page.locator('article.msg.bot .cite').first()).toBeVisible();
});
