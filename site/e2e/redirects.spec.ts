import { expect, test } from '@playwright/test';

// The apex is the app's. Its root goes to the chat, and the few marketing URLs that used
// to live there are sent to www (a redirect, never a page). Exercised through the same
// _redirects file Workers static assets reads.
const go = (page: import('@playwright/test').Page, path: string) => page.request.get(path, { maxRedirects: 0 });

test('the root goes to the chat', async ({ page }) => {
  const res = await go(page, '/');
  expect(res.status()).toBe(302);
  expect(res.headers()['location']).toBe('/chat/');
});

test('old marketing links on the apex are sent to www', async ({ page }) => {
  for (const [from, to] of [
    ['/blueprint/', 'https://www.shamwari.ai/blueprint/'],
    ['/project', 'https://www.shamwari.ai/project/'],
    ['/contact/', 'https://www.shamwari.ai/contact/'],
    ['/sitemap.xml', 'https://www.shamwari.ai/sitemap.xml'],
    ['/robots.txt', 'https://www.shamwari.ai/robots.txt'],
    ['/og/home.png', 'https://www.shamwari.ai/og/home.png'],
  ] as const) {
    const res = await go(page, from);
    expect(res.status(), from).toBe(301);
    expect(res.headers()['location'], from).toBe(to);
  }
});

test('the app serves no marketing page of its own', async ({ page }) => {
  for (const path of ['/index.html', '/blueprint/index.html', '/project/index.html']) {
    expect((await page.request.get(path)).status(), path).toBe(404);
  }
  expect((await page.request.get('/chat/')).status()).toBe(200);
});
