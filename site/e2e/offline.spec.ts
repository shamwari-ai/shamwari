import { expect, test } from '@playwright/test';
import { ask, openChat } from './helpers';

const onlyOnce = (urls: string[], needle: string) => urls.filter((u) => u.includes(needle)).length;

test('a question written offline is queued, then sent once when the network returns', async ({ page, context }) => {
  const posts: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST') posts.push(r.url());
  });
  await openChat(page);

  await context.setOffline(true);
  await expect(page.locator('#offline')).toBeVisible();
  await ask(page, 'Is everyone equal under the law?');

  // Saved and honest about it: a status, not an error, and the text is kept.
  const queued = page.locator('article.msg.user.queued');
  await expect(queued).toContainText('Is everyone equal');
  await expect(queued.locator('[role="status"]')).toContainText('saved and will be sent');
  await expect(page.locator('[role="alert"]:visible')).toHaveCount(0);
  expect(posts).toHaveLength(0);

  await context.setOffline(false);
  await expect(page.locator('article.msg.bot .cite').first()).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('article.queued')).toHaveCount(0);
  expect(onlyOnce(posts, '/v1/chat/completions')).toBe(1);

  // The answer sits right under its question.
  await expect(page.locator('#log article').nth(1)).toContainText('Section 56');
});

test('a queued question survives a reload and can be discarded', async ({ page, context }) => {
  await openChat(page);
  await context.setOffline(true);
  await ask(page, 'Will this still be here?');
  await expect(page.locator('article.queued')).toBeVisible();

  await page.reload().catch(() => {});
  await context.setOffline(false);
  await page.goto('/chat/');
  await page.waitForSelector('html[data-ready="true"]');
  // Back online it was sent by itself on load.
  await expect(page.locator('article.msg.bot').first()).toBeVisible({ timeout: 15_000 });

  await context.setOffline(true);
  await ask(page, 'Discard me');
  await page.getByRole('button', { name: 'Discard' }).click();
  await expect(page.locator('article.queued')).toHaveCount(0);
  await expect(page.locator('article.user', { hasText: 'Discard me' })).toHaveCount(0);
});

test('a question queued in an earlier chat is still delivered after New chat', async ({ page, context }) => {
  await openChat(page);
  await context.setOffline(true);
  await ask(page, 'Queued in the first chat');
  await page.getByRole('button', { name: 'New chat' }).click();
  await expect(page.locator('#log article')).toHaveCount(0);

  await context.setOffline(false);
  // Delivered in the background while another chat is open; open the old one to see it.
  await page.locator('#history summary').click();
  await page.locator('#history-list button').first().click();
  await expect(page.locator('article.msg.bot').first()).toBeVisible({ timeout: 15_000 });
});

test('the shell opens from the service worker with no network at all', async ({ page, context }) => {
  await openChat(page);
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  // Wait until this page is actually controlled, so the reload below is served by the worker.
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

  await ask(page, 'Is everyone equal under the law?');
  await expect(page.locator('.cite').first()).toBeVisible();

  await context.setOffline(true);
  await page.reload();
  await page.waitForSelector('html[data-ready="true"]');
  await expect(page.getByRole('heading', { name: 'Shamwari Chat' })).toBeVisible();
  // History is on the device, so the earlier answer is there too.
  await expect(page.locator('.cite').first()).toBeVisible();
  await expect(page.locator('#offline')).toBeVisible();
});

test('the worker never caches the API and is scoped to /chat/', async ({ page }) => {
  await openChat(page);
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await ask(page, 'hello');
  await expect(page.locator('article.msg.bot').first()).toBeVisible();

  const scope = await page.evaluate(() => navigator.serviceWorker.getRegistration('/chat/').then((r) => r?.scope));
  expect(scope).toMatch(/\/chat\/$/);
  const cached = await page.evaluate(async () => {
    const out: string[] = [];
    for (const name of await caches.keys()) for (const req of await (await caches.open(name)).keys()) out.push(req.url);
    return out;
  });
  expect(cached.length).toBeGreaterThan(3);
  expect(cached.some((u) => u.includes('8788') || u.includes('completions'))).toBe(false);
  expect(cached.every((u) => /\/(chat|_astro)\/|favicon|apple-touch/.test(u))).toBe(true);
});

test('the content security policy holds: no violations while chatting', async ({ page }) => {
  const problems: string[] = [];
  page.on('console', (m) => {
    if (/content security policy|refused to/i.test(m.text())) problems.push(m.text());
  });
  page.on('pageerror', (e) => problems.push(String(e)));
  await openChat(page);
  await ask(page, 'Is everyone equal under the law?');
  await expect(page.locator('.cite').first()).toBeVisible();
  await page.locator('#lang').selectOption('nd');
  expect(problems).toEqual([]);

  const csp = (await page.request.get('/chat/')).headers()['content-security-policy'];
  expect(csp).toContain("script-src 'self'");
  expect(csp).not.toMatch(/unsafe-/);
});

test('discarding the only question leaves nothing behind after a reload', async ({ page, context }) => {
  await openChat(page);
  await context.setOffline(true);
  await ask(page, 'Do not send this');
  await page.getByRole('button', { name: 'Discard' }).click();
  await context.setOffline(false);
  await page.reload();
  await page.waitForSelector('html[data-ready="true"]');
  await expect(page.locator('#log article')).toHaveCount(0);
  await expect(page.locator('#history')).toBeHidden();
});

test('a question in flight when the tab reloads is not lost', async ({ page }) => {
  const posts: string[] = [];
  page.on('request', (r) => r.method() === 'POST' && posts.push(r.postData() ?? ''));
  await openChat(page);
  await ask(page, 'slow answer please'); // the mock holds it for 3 s
  await expect(page.locator('.pending')).toBeVisible();
  await page.reload(); // killed mid-request
  await page.waitForSelector('html[data-ready="true"]');
  await expect(page.locator('article.msg.user')).toHaveCount(1);
  await expect(page.locator('article.msg.bot .cite').first()).toBeVisible({ timeout: 15_000 });
});

test('three unanswered tries while online say so instead of retrying quietly forever', async ({ page }) => {
  await page.clock.install();
  await openChat(page);
  let tries = 0;
  await page.route('**/v1/chat/completions', (r) => {
    tries += 1;
    return r.abort();
  });
  await ask(page, 'hello');
  await expect.poll(() => tries).toBe(1);
  await expect(page.locator('article.queued')).toBeVisible();
  await page.clock.runFor(16_000); // the first retry, after 15 s
  await expect.poll(() => tries).toBe(2);
  await expect(page.locator('article.queued')).toBeVisible();
  await page.clock.runFor(31_000); // the second, after 30 s
  await expect.poll(() => tries).toBe(3);
  const err = page.locator('article.error [role="alert"]');
  await expect(err).toContainText('did not arrive');
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  await page.clock.runFor(10 * 60_000); // and it really has stopped
  expect(tries).toBe(3);
});

test('the question stays the same element while it is answered, so a screen reader is not re-reading it', async ({ page }) => {
  await openChat(page);
  await page.locator('#q').fill('Is everyone equal under the law?');
  await page.locator('#send').click();
  const mine = await page.locator('article.msg.user').elementHandle();
  await expect(page.locator('.cite').first()).toBeVisible();
  expect(await mine!.evaluate((el) => el.isConnected)).toBe(true);
});
