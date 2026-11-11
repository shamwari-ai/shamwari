import { expect, test } from '@playwright/test';

// With a session behind it (the Mukoko build), offline mode must not even renew the session: no request to the Worker at all.
const STUB = 'http://127.0.0.1:4323/__stub/auth';

test('with offline mode on, the page loads from the hint of a past sign-in and makes no session request', async ({ page, context }) => {
  await page.request.post(STUB, { data: { session: true } });
  await page.addInitScript(() => {
    localStorage.setItem('shamwari.mukoko.hint', '1');
    localStorage.setItem('shamwari.offlineMode', '1');
  });
  const seen: string[] = [];
  const toWorker: string[] = [];
  page.on('request', (r) => {
    const path = new URL(r.url()).pathname;
    if (['fetch', 'xhr', 'ping', 'eventsource', 'websocket'].includes(r.resourceType())) seen.push(path);
    // Of any kind: this page asking the session Worker for anything. (The stub's own counter is shared with the other
    // tests of this project, which run one after another, so it cannot say which page made a call.)
  });
  // Seen from the browser context, so a request from the service worker would count too.
  context.on('request', (r) => {
    const path = new URL(r.url()).pathname;
    if (path.startsWith('/lite/auth/')) toWorker.push(path);
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
  expect(toWorker, 'nothing asked the session Worker for anything').toEqual([]);
  await page.request.post(STUB, { data: {} }); // leave the shared stub as it was found (signed out, counters at zero)
});
