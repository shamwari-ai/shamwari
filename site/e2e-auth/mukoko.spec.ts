import { expect, test, type Page } from '@playwright/test';
import { openAccount, openChats } from '../e2e/helpers';

// Mukoko sign-in (WorkOS access token) against a STAND-IN for the session Worker and
// the mock gateway. The flag is a build setting and is off in the normal build.
const STUB = 'http://127.0.0.1:4323/__stub/auth';
const MOCK = 'http://127.0.0.1:8789';
const VALID = 'eyJhbGciOiJSUzI1NiJ9.valid-secret-payload.sig';
const EXPIRED = 'eyJhbGciOiJSUzI1NiJ9.expired.sig';

/** An access token that names a person (the page reads only `sub`, to choose whose store of messages to open). */
const b64url = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
const tokenFor = (sub: string) => `eyJhbGciOiJSUzI1NiJ9.${b64url({ sub })}.sig`;

/** Sign out through the dialog: keeping the messages is the default, deleting them is a choice made in the dialog. */
async function signOut(page: Page, opts: { alsoDelete?: boolean } = {}) {
  await openAccount(page);
  await page.locator('#signout').click();
  const dialog = page.locator('#signout-dialog');
  await expect(dialog).toBeVisible();
  await expect(page.locator('#signout-delete')).not.toBeChecked(); // keep is the default
  if (opts.alsoDelete) await page.locator('#signout-delete').check();
  await dialog.getByRole('button', { name: 'Sign out' }).click();
}

const steer = (page: Page, body: object) => page.request.post(STUB, { data: body });
const state = async (page: Page) => (await page.request.get(STUB)).json() as Promise<{ tokenCalls: number; logoutCalls: number; session: boolean }>;
const seen = async (page: Page) => ((await (await page.request.get(`${MOCK}/__seen`)).json()) as { seen: string[] }).seen;
const reset = (page: Page) => page.request.delete(`${MOCK}/__seen`);

async function open(page: Page) {
  await page.goto('/lite/');
  await page.waitForSelector('html[data-ready="true"]');
  await page.waitForSelector('html[data-auth-ready="true"]'); // the silent start-up renewal has answered
}
const ask = async (page: Page, text: string) => {
  await page.locator('#q').fill(text);
  await page.locator('#send').click();
};

/** As if the page had just been sent to the hosted sign-in and come back without a session: the sign-in screen stays. */
const justSentToSignIn = (page: Page) => page.addInitScript(() => sessionStorage.setItem('shamwari.signin.hop', String(Date.now())));
const SIGNIN_SCREEN_ONLY = async (page: Page) => {
  await expect(page.locator('#auth')).toBeVisible();
  for (const sel of ['#thread', '#q', '#send', '#scope', '#log', '[data-slot="app-topbar"]', '.dock']) await expect(page.locator(sel), sel).toBeHidden();
  await expect(page.getByText('Sign in to ask')).toHaveCount(0);
  expect(await page.getByRole('button').filter({ visible: true }).count()).toBe(1); // one primary button, nothing else to press
};

test.beforeEach(async ({ page }) => {
  await reset(page);
  await steer(page, { session: true, tokens: [VALID] });
});

test('the flag changes the sign-in screen: Mukoko is real, the developer key is gone, and it is a whole screen', async ({ page }) => {
  await steer(page, { session: false });
  await justSentToSignIn(page);
  await open(page);
  await expect(page.locator('html')).toHaveAttribute('data-auth', 'mukoko');
  await SIGNIN_SCREEN_ONLY(page);
  expect(await page.locator('#auth').boundingBox()).toMatchObject({ x: 0, y: 0, width: 360, height: 640 });
  await expect(page.getByRole('button', { name: 'Sign in with Mukoko' })).toBeEnabled();
  await expect(page.locator('#key')).toHaveCount(0);
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
  await openAccount(page);
  await expect(page.locator('#signout')).toHaveText('Sign out');
  await page.locator('#signout').click();
  await page.locator('#signout-dialog').getByRole('button', { name: 'Sign out' }).click();

  await SIGNIN_SCREEN_ONLY(page);
  await expect(page.locator('#signin-note')).toContainText('Signed out'); // said on the sign-in screen, where the person is looking
  expect((await state(page)).logoutCalls).toBe(1);
  // Nothing was sent, there is no chat left to type in, and it did not quietly sign itself back in from the old cookie.
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
  await justSentToSignIn(page);
  await open(page);
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await steer(page, { session: false });
  await page.reload();
  await page.waitForSelector('html[data-auth-ready="true"]');
  await page.getByRole('button', { name: 'Sign in with Mukoko' }).click();
  await page.waitForURL('**/lite/');
  // The login route set the session: the shell the service worker serves is the SAME page,
  // so the only proof it reached the network is the state the stub recorded.
  expect((await state(page)).session).toBe(true);
});

test('signing out keeps the messages on this device by default, and says they are not encrypted', async ({ page }) => {
  await steer(page, { session: true, tokens: [tokenFor('user-A')] });
  await open(page);
  await ask(page, 'Is everyone equal under the law?');
  await expect(page.locator('.cite').first()).toBeVisible();
  await openAccount(page);
  await page.locator('#signout').click();
  await expect(page.locator('#signout-dialog')).toContainText('not encrypted');
  await expect(page.locator('#signout-dialog')).toContainText('Also delete messages from this device');
  await page.locator('#signout-dialog').getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('#signout-dialog')).toBeHidden();
  await expect(page.locator('#log article')).not.toHaveCount(0); // cancelling signs nothing out
  await signOut(page);
  await expect(page.locator('#signin-note')).toContainText('stay on this device');
  await expect(page.locator('#log article')).toHaveCount(0); // not on screen for the next person
  // The same person signs in again: their messages are there.
  await steer(page, { session: true, tokens: [tokenFor('user-A')] });
  await page.goto('/lite/');
  await page.waitForSelector('html[data-auth-ready="true"]');
  await expect(page.locator('article.msg.user')).toContainText('Is everyone equal');
});

test('another person signing in on the same device does not read them; the first person still has them', async ({ page }) => {
  await steer(page, { session: true, tokens: [tokenFor('user-A')] });
  await open(page);
  await ask(page, 'Is everyone equal under the law?');
  await expect(page.locator('.cite').first()).toBeVisible();
  await signOut(page);

  await steer(page, { session: true, tokens: [tokenFor('user-B')] });
  await page.goto('/lite/');
  await page.waitForSelector('html[data-auth-ready="true"]');
  await expect(page.locator('#log article')).toHaveCount(0);
  await openChats(page);
  await expect(page.locator('#history-list button')).toHaveCount(0);
  await expect(page.getByText('Is everyone equal')).toHaveCount(0);
  await ask(page, 'Question from B');
  await expect(page.locator('.cite').first()).toBeVisible();
  await signOut(page);

  await steer(page, { session: true, tokens: [tokenFor('user-A')] });
  await page.goto('/lite/');
  await page.waitForSelector('html[data-auth-ready="true"]');
  await expect(page.locator('article.msg.user')).toContainText('Is everyone equal');
  await expect(page.getByText('Question from B')).toHaveCount(0);
});

test('chats from before stores were per person go to the first person who signs in, not to the next', async ({ page }) => {
  // A device from before this change: its chats are in the unowned store (the one developer-key mode uses).
  await steer(page, { session: true, tokens: [VALID] }); // a token that names nobody: the unowned store stays in use
  await open(page);
  await ask(page, 'Old question');
  await expect(page.locator('.cite').first()).toBeVisible();
  await signOut(page);
  await steer(page, { session: true, tokens: [tokenFor('user-A')] });
  await page.goto('/lite/');
  await page.waitForSelector('html[data-auth-ready="true"]');
  await expect(page.locator('article.msg.user')).toContainText('Old question'); // adopted by the first person
  await signOut(page);
  await steer(page, { session: true, tokens: [tokenFor('user-B')] });
  await page.goto('/lite/');
  await page.waitForSelector('html[data-auth-ready="true"]');
  await expect(page.getByText('Old question')).toHaveCount(0);
});

test('"Also delete messages from this device" removes them, and signing in again finds nothing', async ({ page }) => {
  await steer(page, { session: true, tokens: [tokenFor('user-A')] });
  await open(page);
  await ask(page, 'Is everyone equal under the law?');
  await expect(page.locator('.cite').first()).toBeVisible();
  await signOut(page, { alsoDelete: true });
  await expect(page.locator('#signin-note')).toContainText('removed from this device');
  await expect(page.locator('#log article')).toHaveCount(0);
  await steer(page, { session: true, tokens: [tokenFor('user-A')] });
  await page.goto('/lite/');
  await page.waitForSelector('html[data-auth-ready="true"]');
  await expect(page.locator('#log article')).toHaveCount(0);
  await openChats(page);
  await expect(page.locator('#history-list button')).toHaveCount(0);
});

test('signing out leaves the chat at once even when the sign-out request hangs', async ({ page }) => {
  await open(page);
  await ask(page, 'Is everyone equal under the law?');
  await expect(page.locator('.cite').first()).toBeVisible();
  await steer(page, { session: true, logoutDelayMs: 30_000 }); // the Worker never answers in time
  await signOut(page);
  await expect(page.locator('#signin-note')).toContainText('Signed out', { timeout: 3_000 });
  await expect(page.locator('#log article')).toHaveCount(0);
});

test('a question sent while the start-up renewal is still in flight waits for it and is not dropped', async ({ page }) => {
  await steer(page, { session: true, tokens: [VALID], tokenDelayMs: 1_500 });
  await page.goto('/lite/');
  await page.waitForSelector('html[data-ready="true"]'); // the renewal has been asked for, not answered
  await ask(page, 'Is everyone equal under the law?');
  await expect(page.locator('article.msg.bot:not(.pending) .cite').first()).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('#auth')).toBeHidden();
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

test('a failed sign-in sends the person back with a kind message on the sign-in screen, once', async ({ page }) => {
  await steer(page, { session: false });
  await page.goto('/lite/?signin=failed');
  await page.waitForSelector('html[data-ready="true"]');
  await expect(page.locator('#signin-failed')).toContainText('could not sign you in');
  await SIGNIN_SCREEN_ONLY(page); // and it does not bounce straight back to sign-in
  expect(new URL(page.url()).search).toBe(''); // the parameter is gone, so the message is said once
  // A reload is a new try: it goes to the hosted sign-in again, and does not repeat the old failure on the way.
  await page.route('**/lite/auth/login', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><p id="hosted">HOSTED</p>' }));
  await page.reload();
  await expect(page.locator('#hosted')).toBeVisible();
});

test('a device whose session has ended goes straight to the hosted sign-in: no chat and no card on the way', async ({ page }) => {
  await steer(page, { session: false });
  // The hosted sign-in, stood in for: it records that it was reached and shows only itself.
  let reached = 0;
  await page.route('**/lite/auth/login', (route) => {
    reached += 1;
    return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>hosted</title><p id="hosted">HOSTED SIGN-IN</p>' });
  });
  await page.goto('/lite/');
  await expect(page.locator('#hosted')).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/lite/auth/login');
  expect(reached).toBe(1);
});

test('if that sign-in comes straight back signed out, it stops on the sign-in screen and does not loop', async ({ page }) => {
  await steer(page, { session: false });
  let reached = 0;
  await page.route('**/lite/auth/login', (route) => {
    reached += 1;
    return route.fulfill({ status: 302, headers: { Location: '/lite/' } }); // back, still no session
  });
  await page.goto('/lite/');
  await page.waitForSelector('html[data-ready="true"]');
  await page.waitForSelector('html[data-auth-ready="true"]');
  await SIGNIN_SCREEN_ONLY(page);
  await page.waitForTimeout(800);
  expect(reached).toBe(1); // once, not forever
});

test('offline: a device that held a session opens the chat; one that did not sees the sign-in screen and says it is offline', async ({ page, context }) => {
  await page.goto('/lite/');
  await page.waitForSelector('html[data-auth-ready="true"]'); // signed in (the beforeEach session): the hint is set
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await page.waitForSelector('html[data-ready="true"]');
  await expect(page.locator('#auth')).toBeHidden();
  await expect(page.locator('#q')).toBeVisible();

  // No hint (never signed in on this device, or signed out): offline there is nothing to open, so the sign-in screen says so.
  await page.evaluate(() => localStorage.removeItem('shamwari.mukoko.hint'));
  await page.reload();
  await page.waitForSelector('html[data-ready="true"]');
  await expect(page.locator('#auth')).toBeVisible();
  await expect(page.locator('#signin-offline')).toBeVisible();
  await expect(page.locator('#q')).toBeHidden();
  expect(new URL(page.url()).pathname).toBe('/lite/'); // it did not try to leave for a page it cannot reach
});

test('the enabled Mukoko button no longer points at the "coming soon" text', async ({ page }) => {
  await steer(page, { session: false });
  await open(page);
  await expect(page.locator('#mukoko-signin')).not.toHaveAttribute('aria-describedby', /.+/);
});


test('while the first answer from the session is awaited, neither the sign-in nor the chat flashes', async ({ page }) => {
  await steer(page, { session: true, tokens: [VALID], tokenDelayMs: 1500 }); // a session, but no hint on this device
  await page.goto('/lite/');
  await page.waitForSelector('html[data-ready="true"]');
  await expect(page.locator('html')).toHaveAttribute('data-view', 'pending');
  await expect(page.locator('#auth')).toBeHidden();
  await expect(page.locator('#q')).toBeHidden();
  await page.waitForSelector('html[data-auth-ready="true"]');
  await expect(page.locator('html')).toHaveAttribute('data-view', 'app');
  await expect(page.locator('#q')).toBeVisible();
  await expect(page.locator('#auth')).toBeHidden();
});
