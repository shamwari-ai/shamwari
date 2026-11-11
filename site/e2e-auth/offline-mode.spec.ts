import { expect, test } from '@playwright/test';

// With a session behind it (the Mukoko build), offline mode must not even renew the session: no request to the Worker at all.
const STUB = 'http://127.0.0.1:4323/__stub/auth';
const state = async (page: import('@playwright/test').Page) => (await (await page.request.get(STUB)).json()) as { tokenCalls: number };

test('with offline mode on, the page loads from the hint of a past sign-in and makes no session request', async ({ page }) => {
  await page.request.post(STUB, { data: { session: true } });
  await page.addInitScript(() => {
    localStorage.setItem('shamwari.mukoko.hint', '1');
    localStorage.setItem('shamwari.offlineMode', '1');
  });
  const seen: string[] = [];
  page.on('request', (r) => {
    if (['fetch', 'xhr', 'ping', 'eventsource', 'websocket'].includes(r.resourceType())) seen.push(new URL(r.url()).pathname);
  });
  await page.goto('/lite/');
  await page.waitForSelector('html[data-ready="true"]');
  await page.waitForSelector('html[data-auth-ready="true"]');
  await expect(page.locator('#q')).toBeVisible();
  await page.locator('#q').fill('hello');
  await page.locator('#send').click();
  await expect(page.locator('article.msg.user')).toContainText('Saved on this device only. Not sent.');
  await page.waitForTimeout(1000);
  expect(seen).toEqual([]);
  expect((await state(page)).tokenCalls, 'the session Worker was never asked for a token').toBe(0);
});
