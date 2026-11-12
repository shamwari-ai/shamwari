import { expect, test } from '@playwright/test';

// The production bug this guards: the session cookie is scoped to /lite/, the gate protected /_astro/*.js as well, and the
// browser never sent the cookie for a path outside /lite/, so after a good sign-in every script answered 401 and the page
// had no JavaScript. Here a real browser holds a real cookie jar (Path=/) in front of a server that applies the gate.
test.use({ baseURL: 'http://127.0.0.1:4324' });

test('after sign-in the gated page loads its scripts under the cookie Path and the chat becomes interactive', async ({ page }) => {
  const responses: { url: string; status: number }[] = [];
  page.on('response', (r) => responses.push({ url: new URL(r.url()).pathname, status: r.status() }));

  await page.goto('/lite/'); // no cookie: the gate sends this to /auth/login, which signs in and comes back
  await page.waitForSelector('html[data-ready="true"]');

  const scripts = responses.filter((r) => r.url.endsWith('.js') && r.url !== '/lite/sw.js');
  expect(scripts.length, 'the page loaded at least one script').toBeGreaterThan(0);
  for (const s of scripts) {
    expect(s.url.startsWith('/lite/'), `${s.url} is inside the cookie Path`).toBe(true);
    expect(s.status, s.url).toBe(200);
  }
  expect(responses.filter((r) => r.status === 401)).toEqual([]);

  // Interactive, not just present: the script ran (it set the ready flag), and typing and the drawer work.
  await page.locator('#q').fill('hello');
  await expect(page.locator('#send')).toBeEnabled();
  await page.getByRole('button', { name: /open chats/i }).click();
  await expect(page.locator('#chat-sidebar')).toBeVisible();
});

test('the privacy page renders styled with no session at all', async ({ page, context }) => {
  await context.clearCookies();
  const responses: { url: string; status: number }[] = [];
  page.on('response', (r) => responses.push({ url: new URL(r.url()).pathname, status: r.status() }));
  await page.goto('/lite/disclaimer/');
  const css = responses.filter((r) => r.url.endsWith('.css'));
  expect(css.length, 'the page names a stylesheet').toBeGreaterThan(0);
  for (const c of css) expect(c.status, c.url).toBe(200);
  // Styled: the chat's 17px body size, not the browser's 16px default.
  expect(await page.evaluate(() => getComputedStyle(document.body).fontSize)).toBe('17px');
  expect(responses.filter((r) => r.status === 401)).toEqual([]);
});

test('a script requested with no cookie is refused, so the app is not public', async ({ playwright }) => {
  const api = await playwright.request.newContext({ baseURL: 'http://127.0.0.1:4324' });
  const html = await (await api.get('/lite/disclaimer/')).text();
  expect(html).not.toContain('<script'); // nothing to find there; fetch the app's script by name instead
  const login = await api.get('/lite/', { maxRedirects: 0 });
  expect(login.status()).toBe(302);
  expect((await api.get('/lite/_astro/x.Abc123.js')).status()).toBe(401);
});
