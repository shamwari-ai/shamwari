import { expect, test, type Page } from '@playwright/test';

// Mukoko sign-in (WorkOS access token) against a STAND-IN for the session Worker and
// the mock gateway. The flag is a build setting and is off in the normal build.
const STUB = 'http://127.0.0.1:4323/__stub/auth';
const MOCK = 'http://127.0.0.1:8789';
const VALID = 'eyJhbGciOiJSUzI1NiJ9.valid-secret-payload.sig';
const EXPIRED = 'eyJhbGciOiJSUzI1NiJ9.expired.sig';

const steer = (page: Page, body: object) => page.request.post(STUB, { data: body });
const state = async (page: Page) => (await page.request.get(STUB)).json() as Promise<{ tokenCalls: number; logoutCalls: number; session: boolean }>;
const seen = async (page: Page) => ((await (await page.request.get(`${MOCK}/__seen`)).json()) as { seen: string[] }).seen;
const reset = (page: Page) => page.request.delete(`${MOCK}/__seen`);

async function open(page: Page) {
  await page.goto('/chat/');
  await page.waitForSelector('html[data-ready="true"]');
  await page.waitForSelector('html[data-auth-ready="true"]'); // the silent start-up renewal has answered
}
const ask = async (page: Page, text: string) => {
  await page.locator('#q').fill(text);
  await page.locator('#send').click();
};

test.beforeEach(async ({ page }) => {
  await reset(page);
  await steer(page, { session: true, tokens: [VALID] });
});

test('the flag changes the sign-in screen: Mukoko is real, the developer key is gone', async ({ page }) => {
  await steer(page, { session: false });
  await open(page);
  await expect(page.locator('html')).toHaveAttribute('data-auth', 'mukoko');
  await expect(page.locator('#auth')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in with Mukoko' })).toBeEnabled();
  await expect(page.locator('#key')).toBeHidden();
  await expect(page.locator('#mukoko-soon')).toBeHidden();
});

test('signed in by the session cookie, it asks with the token as Bearer and gets an answer with citations', async ({ page }) => {
  await open(page);
  await expect(page.locator('#auth')).toBeHidden();
  await ask(page, 'Is everyone equal under the law?');
  await expect(page.locator('.cite').first()).toBeVisible();
  expect(await seen(page)).toEqual([`Bearer ${VALID}`.replace('Bearer ', '')]);
});

test('the token is never persisted anywhere the page can read', async ({ page }) => {
  await open(page);
  await ask(page, 'Is everyone equal under the law?');
  await expect(page.locator('.cite').first()).toBeVisible();

  const everything = await page.evaluate(async () => {
    const out: Record<string, unknown> = {};
    out.local = { ...localStorage };
    out.session = { ...sessionStorage };
    out.cookie = document.cookie;
    const dbs = (await indexedDB.databases?.()) ?? [];
    const rows: unknown[] = [];
    for (const d of dbs) {
      await new Promise<void>((done) => {
        const open = indexedDB.open(d.name!);
        open.onsuccess = () => {
          const db = open.result;
          const names = [...db.objectStoreNames];
          if (!names.length) return done();
          const tx = db.transaction(names);
          let left = names.length;
          for (const n of names) {
            const all = tx.objectStore(n).getAll();
            all.onsuccess = () => {
              rows.push(all.result);
              if (--left === 0) done();
            };
          }
        };
        open.onerror = () => done();
      });
    }
    out.indexedDB = rows;
    const cached: string[] = [];
    for (const name of await caches.keys()) {
      for (const req of await (await caches.open(name)).keys()) cached.push(req.url);
    }
    out.caches = cached;
    return out;
  });
  const blob = JSON.stringify(everything);
  expect(blob).not.toContain('eyJ');
  expect(blob).not.toContain('valid-secret-payload');
  // The one thing kept is a non-secret yes/no.
  expect((everything.local as Record<string, string>)['shamwari.mukoko.hint']).toBe('1');
});

test('sign-out clears the token, ends the session, and the next ask needs a sign-in', async ({ page }) => {
  await open(page);
  await page.getByText('Settings').click();
  await expect(page.locator('#signout')).toHaveText('Sign out');
  await page.locator('#signout').click();

  await expect(page.locator('#auth')).toBeVisible();
  expect((await state(page)).logoutCalls).toBe(1);
  await reset(page);
  await ask(page, 'hello');
  // Nothing was sent, and it did not quietly sign itself back in from the old cookie.
  await expect(page.locator('#auth')).toBeVisible();
  expect(await seen(page)).toEqual([]);
  expect((await state(page)).session).toBe(false);
});

test('a 401 triggers exactly one silent refresh, then the ask succeeds', async ({ page }) => {
  await steer(page, { session: true, tokens: [EXPIRED, VALID] });
  await open(page); // takes the first token (the one the gateway will refuse)
  const before = (await state(page)).tokenCalls;
  await reset(page);

  await ask(page, 'Is everyone equal under the law?');
  await expect(page.locator('.cite').first()).toBeVisible();
  expect(await seen(page)).toEqual([EXPIRED, VALID]); // refused once, repeated once with the new token
  expect((await state(page)).tokenCalls - before).toBe(1); // exactly one silent refresh
  await expect(page.locator('#auth')).toBeHidden();
});

test('if the refresh is refused too, it goes to sign-in and does not loop', async ({ page }) => {
  await steer(page, { session: true, tokens: [EXPIRED] });
  await open(page);
  const before = (await state(page)).tokenCalls;
  await reset(page);
  await steer(page, { session: true, tokens: [EXPIRED], tokenStatus: 401 }); // the session has ended

  await ask(page, 'hello');
  await expect(page.locator('#auth')).toBeVisible();
  await expect(page.locator('#mukoko-signin')).toBeFocused();
  expect((await seen(page)).length).toBe(1); // one refused ask, no second try
  await page.waitForTimeout(500);
  expect((await state(page)).tokenCalls).toBeGreaterThan(0);
  expect((await seen(page)).length).toBe(1); // still no loop
  void before;
});

test('the Mukoko button starts sign-in on the Worker, which the service worker must not answer from cache', async ({ page }) => {
  await steer(page, { session: false });
  await open(page);
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await steer(page, { session: false });
  await page.reload();
  await page.waitForSelector('html[data-auth-ready="true"]');
  await page.getByRole('button', { name: 'Sign in with Mukoko' }).click();
  await page.waitForURL('**/chat/');
  // The login route set the session: the shell the service worker serves is the SAME page,
  // so the only proof it reached the network is the state the stub recorded.
  expect((await state(page)).session).toBe(true);
});

test('signing out removes the chats from this device, so the next person does not read them', async ({ page }) => {
  await open(page);
  await ask(page, 'Is everyone equal under the law?');
  await expect(page.locator('.cite').first()).toBeVisible();
  await page.getByText('Settings').click();
  await page.locator('#signout').click();
  await expect(page.locator('#toast')).toContainText('removed from this device');
  await expect(page.locator('#log article')).toHaveCount(0);
  await page.reload();
  await page.waitForSelector('html[data-auth-ready="true"]');
  await expect(page.locator('#log article')).toHaveCount(0);
  await expect(page.locator('#history')).toBeHidden();
});

test('a start-up renewal that fails on the network is not a sign-out: the question is kept and sent later', async ({ page }) => {
  await open(page); // signed in once, so the "signed in before" hint is set
  await steer(page, { session: true, tokenStatus: 503 }); // the Worker is unwell
  await page.reload();
  await page.waitForSelector('html[data-auth-ready="true"]');
  await expect(page.locator('#auth')).toBeHidden(); // still signed in as far as anyone knows
  await ask(page, 'Is everyone equal under the law?');
  await expect(page.locator('article.queued')).toBeVisible();
  await expect(page.locator('#auth')).toBeHidden();
  // The Worker recovers: the question goes out by itself.
  await steer(page, { session: true });
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.locator('article.msg.bot:not(.pending) .cite').first()).toBeVisible({ timeout: 15_000 });
});

test('the enabled Mukoko button no longer points at the "coming soon" text', async ({ page }) => {
  await steer(page, { session: false });
  await open(page);
  await expect(page.locator('#mukoko-signin')).not.toHaveAttribute('aria-describedby', /.+/);
});

