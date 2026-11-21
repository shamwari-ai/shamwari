import { expect, test } from '@playwright/test';

// The app moved from /lite/ to /chat/ (docs/chat-app.md, "Moving from /lite/ to /chat/"). A browser that used /lite/ has a
// service worker there that answers every /lite/ navigation from its cache, so on its own it never sees the Worker's 301. This
// drives a REAL worker swap: a stand-in for the old app's worker is installed for /lite/ (the e2e server serves it at
// /lite/sw.js to a context holding the cookie legacysw=1), then the release happens (the cookie goes, and /lite/sw.js is the
// build's own retiring worker), and the old page has to end up on /chat/ by itself, with what the origin stores kept.

test.beforeEach(() => test.setTimeout(60_000));
test.afterEach(async ({ page }) => {
  await page
    .evaluate(async () => {
      for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
    })
    .catch(() => {});
  await page.close().catch(() => {});
});

test('an installed /lite/ worker is retired: the old page reloads onto /chat/, its cache is gone, the origin storage is kept', async ({ page, context, baseURL }) => {
  // 1. Before the release: the old app's worker in charge of /lite/.
  await context.addCookies([{ name: 'legacysw', value: '1', url: baseURL! }]);
  await page.goto('/chat/disclaimer/');
  await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.register('/lite/sw.js', { scope: '/lite/' });
    const w = reg.installing ?? reg.waiting ?? reg.active!;
    if (w.state !== 'activated') await new Promise<void>((done) => w.addEventListener('statechange', () => w.state === 'activated' && done()));
  });
  await page.goto('/lite/');
  await expect(page.locator('#old')).toBeVisible(); // the old shell, from the old cache: the 301 is not reached
  await page.evaluate(() => localStorage.setItem('shamwari.e2e.liteMove', 'kept'));
  expect(await page.evaluate(() => caches.keys())).toContain('shamwari-chat-0ld000000000');

  // 2. The release. The old page's own update check (on load) fetches /lite/sw.js and gets the retiring worker, which takes
  //    over, deletes the old cache and unregisters; the takeover reloads the page, and with no worker left the reload reaches
  //    the 301 to /chat/.
  await context.clearCookies({ name: 'legacysw' });
  await page.reload();
  await page.waitForURL((u) => u.pathname === '/chat/', { timeout: 30_000 });
  await page.waitForSelector('html[data-ready="true"]');

  expect(await page.evaluate(() => localStorage.getItem('shamwari.e2e.liteMove'))).toBe('kept');
  await expect.poll(() => page.evaluate(() => caches.keys()), { timeout: 10_000 }).not.toContain('shamwari-chat-0ld000000000');
  await expect
    .poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).map((r) => new URL(r.scope).pathname)), { timeout: 10_000 })
    .not.toContain('/lite/');

  // And a fresh visit to the old address goes straight to the app.
  await page.goto('/lite/?from=bookmark');
  expect(new URL(page.url()).pathname + new URL(page.url()).search).toBe('/chat/?from=bookmark');
});

test('the old address redirects to /chat/ with its path and query, but keeps the retiring worker and the old sign-in routes', async ({ page }) => {
  const go = (path: string) => page.request.get(path, { maxRedirects: 0 });
  for (const [from, to] of [
    ['/lite', '/chat/'],
    ['/lite/', '/chat/'],
    ['/lite/disclaimer/?x=1', '/chat/disclaimer/?x=1'],
    ['/lite/manifest.webmanifest', '/chat/manifest.webmanifest'],
  ] as const) {
    const res = await go(from);
    expect(res.status(), from).toBe(301);
    expect(res.headers()['location'], from).toBe(to);
  }
  const sw = await go('/lite/sw.js');
  expect(sw.status()).toBe(200);
  expect(sw.headers()['cache-control']).toBe('no-cache');
  expect(await sw.text()).toContain('registration.unregister()');
});
