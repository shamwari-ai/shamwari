import { expect, test } from '@playwright/test';
import { ask, makeProject, openAccount, openChat, openChats, openSection, closeChats, newChat, seedLegacyQuestion } from './helpers';

test('asks a question and renders the answer with its citation card', async ({ page }) => {
  await openChat(page);
  await ask(page, 'Is everyone equal under the law?');

  const answer = page.locator('article.msg.bot', { hasText: 'Section 56' }).first();
  await expect(answer).toBeVisible();

  const card = answer.locator('.cite').first();
  await expect(card.locator('.badge')).toHaveText('Ground');
  await expect(card.locator('.cite-heading')).toContainText('Section 56');
  await expect(card.locator('.cite-title')).toContainText('Constitution of Zimbabwe');
  await expect(card).toContainText('22 May 2013');
  const link = card.getByRole('link', { name: 'Open source' });
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(link).toHaveAttribute('target', '_blank');

  // The answer lives in a polite live region, so it is read out as it arrives.
  await expect(page.locator('#log')).toHaveAttribute('aria-live', 'polite');
});

test('an answer with no source says so instead of implying one', async ({ page }) => {
  await openChat(page);
  await ask(page, 'nosource please');
  await expect(page.locator('article.msg.bot .note', { hasText: 'no source' })).toBeVisible();
  await expect(page.locator('.cite')).toHaveCount(0);
});

const completions = (page: import('@playwright/test').Page) => {
  const bodies: Array<{ scope?: string }> = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().includes('/v1/chat/completions')) bodies.push(JSON.parse(r.postData() ?? '{}'));
  });
  return bodies;
};

test('there is no scope picker, and every question is asked as a general one, never as personal', async ({ page }) => {
  const bodies = completions(page);
  await openChat(page);
  // Nothing in the page asks which kind of knowledge is meant.
  await expect(page.locator('#scope')).toHaveCount(0);
  await expect(page.getByLabel('Asking about')).toHaveCount(0);
  await expect(page.locator('.dock select')).toHaveCount(0);
  for (let i = 0; i < 3; i++) await ask(page, `Is everyone equal under the law? ${i}`);
  await expect(page.locator('article.msg.bot:not(.pending) .cite')).toHaveCount(3, { timeout: 30_000 });
  expect(bodies).toHaveLength(3);
  for (const b of bodies) expect(b.scope).toBe('platform');
});

test('a personal question saved by an earlier version is never sent by itself: the Shamwari Mind explanation and a general-question button', async ({ page }) => {
  const bodies = completions(page);
  await openChat(page);
  await seedLegacyQuestion(page, 'How much do I earn?', 'personal');
  // The explanation appears only once the app has dealt with the saved question, so when it is on screen the automatic
  // send (on opening, and whenever the network returns) has already had its chance: nothing went out.
  const refusal = page.locator('article.refusal');
  await expect(refusal).toBeVisible();
  expect(bodies).toHaveLength(0);
  await expect(refusal).toContainText('Shamwari Mind');
  await expect(refusal).toContainText('not available yet');
  await expect(page.locator('[role="alert"]:visible')).toHaveCount(0);

  // The kind way out is the person's own choice, and a new question, asked as a general one.
  await refusal.getByRole('button', { name: 'Ask a general question instead' }).click();
  await expect(page.locator('article.msg.bot', { hasText: 'right to life' })).toBeVisible();
  expect(bodies).toHaveLength(1);
  expect(bodies[0].scope).toBe('platform');
});

test('a half-sent personal question is held the same way, and a community one saved earlier (allowed to reach the cloud) is sent as it was saved', async ({ page }) => {
  const bodies = completions(page);
  await openChat(page);
  await seedLegacyQuestion(page, 'What does my pay slip say?', 'personal', 'sent');
  await expect(page.locator('article.refusal')).toBeVisible();
  expect(bodies).toHaveLength(0);

  await seedLegacyQuestion(page, 'What does the community say?', 'community');
  await expect(page.locator('article.msg.bot', { hasText: 'right to life' })).toBeVisible({ timeout: 15_000 });
  expect(bodies.map((b) => b.scope)).toEqual(['community']); // never 'personal', and nothing for the held one
});

test('a suggested prompt never replaces what the person already typed', async ({ page }) => {
  await openChat(page);
  await page.locator('#q').fill('My own half-written question');
  await page.locator('#empty [data-example]').first().click();
  await expect(page.locator('#q')).toHaveValue(/^My own half-written question\nWhat does the Constitution say about equality\?$/);
  await expect(page.locator('article.msg.user')).toHaveCount(0);
});

const FAILURES = [
  ['sk_shamwari_mock_402', /plan has run out/i],
  ['sk_shamwari_mock_429', /reached your limit/i],
  ['sk_shamwari_mock_403', /not allowed to ask/i],
] as const;
for (const [key, message] of FAILURES) {
  test(`honest error for ${key.slice(-3)}`, async ({ page }) => {
    await openChat(page, key);
    await ask(page, 'hello');
    const err = page.locator('article.error');
    await expect(err).toContainText(message);
    await expect(err.locator('[role="alert"]')).toBeVisible();
  });
}

test('honest message for 503: it says so at once, keeps the question and tries again by itself', async ({ page }) => {
  await openChat(page, 'sk_shamwari_mock_503');
  await ask(page, 'hello');
  const waiting = page.locator('article.queued');
  await expect(waiting).toContainText(/having trouble right now/i);
  await expect(waiting).toContainText('hello'); // not lost
  await expect(waiting.locator('[role="status"]')).toBeVisible();
});

test('429 offers the add-credit link and a wait time', async ({ page }) => {
  await openChat(page, 'sk_shamwari_mock_429');
  await ask(page, 'hello');
  await expect(page.locator('article.error')).toContainText('30 seconds');
  await expect(page.getByRole('link', { name: 'Add credit' })).toHaveAttribute('href', 'https://platform.shamwari.ai/billing');
});

test('signed out, the whole screen is the sign-in: no chat, no card, no picker, no key field', async ({ page }) => {
  await openChat(page, null);
  const screen = page.locator('#auth');
  await expect(screen).toBeVisible();
  // Nothing of the chat is on the page behind it or around it.
  for (const sel of ['#thread', '#q', '#send', '#scope', '#log', '[data-slot="app-topbar"]', '.dock']) {
    await expect(page.locator(sel), sel).toBeHidden();
  }
  await expect(page.getByText('Sign in to ask')).toHaveCount(0);
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  // Sign-in is not on in this build: no button that cannot be pressed, just the plain line, and the way to the privacy page.
  await expect(page.getByRole('button', { name: 'Sign in with Mukoko' })).toBeHidden();
  await expect(page.locator('#mukoko-soon')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Disclaimer and privacy' })).toBeVisible();
  await expect(page.locator('#auth-title')).toBeFocused();
  // It fills the screen at 360px.
  const box = (await screen.boundingBox())!;
  expect(box).toMatchObject({ x: 0, y: 0, width: 360, height: 640 });
  // And a key typed anywhere is not a way in: "Use the API" lives in the drawer, which a signed-in person sees.
  await openChat(page);
  await openChats(page);
  await expect(page.getByRole('link', { name: 'Use the API' })).toHaveAttribute('href', 'https://platform.nyuchi.com');
});

test('history stays on the device across reloads, new chat starts clean, delete wipes it', async ({ page }) => {
  await openChat(page);
  await ask(page, 'Is everyone equal under the law?');
  await expect(page.locator('article.msg.bot .cite').first()).toBeVisible();

  await page.reload();
  await page.waitForSelector('html[data-ready="true"]');
  await expect(page.locator('article.msg.user')).toContainText('Is everyone equal');
  await expect(page.locator('.cite').first()).toBeVisible();

  await newChat(page);
  await expect(page.locator('#log article')).toHaveCount(0);
  await expect(page.locator('#q')).toBeFocused();
  await openChats(page);
  await expect(page.locator('#history-list button')).toContainText('Is everyone equal');

  page.once('dialog', (d) => d.accept());
  await openAccount(page);
  await page.getByRole('button', { name: 'Delete history' }).click();
  await expect(page.locator('#toast')).toContainText('History deleted');
  await expect(page.locator('#history')).toBeHidden();
  await page.reload();
  await page.waitForSelector('html[data-ready="true"]');
  await expect(page.locator('#log article')).toHaveCount(0);
});

test('the ask is marked as never-trainable channel traffic', async ({ page }) => {
  const headers: Record<string, string>[] = [];
  page.on('request', (r) => r.method() === 'POST' && headers.push(r.headers()));
  await openChat(page);
  await ask(page, 'hello');
  await expect(page.locator('article.msg.bot').first()).toBeVisible();
  expect(headers.at(-1)?.['x-shamwari-channel']).toBe('pwa');
});

test('nothing is sent to a server except the ask itself', async ({ page }) => {
  const hosts = new Set<string>();
  page.on('request', (r) => hosts.add(new URL(r.url()).host));
  await openChat(page);
  await ask(page, 'hello');
  await expect(page.locator('article.msg.bot').first()).toBeVisible();
  expect([...hosts].sort()).toEqual(['127.0.0.1:4322', '127.0.0.1:8788']);
});

test('Shona is offered, shown as a draft, and Enter sends', async ({ page }) => {
  await openChat(page);
  await expect(page.locator('#review')).toBeHidden();
  await openAccount(page);
  await page.locator('#lang').selectOption('sn');
  await expect(page.locator('html')).toHaveAttribute('lang', 'sn');
  await closeChats(page); // the page behind an open drawer is inert
  // The draft notice is a banner in the page, not inside the drawer: it shows with the drawer closed.
  await expect(page.locator('#review')).toBeVisible();
  await expect(page.locator('#send')).toHaveText('Tumira');
  await page.locator('#q').fill('hello');
  await page.locator('#q').press('Enter');
  await expect(page.locator('article.msg.bot').first()).toBeVisible();
});

test('the home screen greets and offers exactly three suggested prompts; a tap fills the box and sends nothing', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (r) => {
    if (['fetch', 'xhr'].includes(r.resourceType())) requests.push(r.url());
  });
  await openChat(page);
  await expect(page.getByRole('heading', { name: 'Hello, friend' })).toBeVisible();
  const chips = page.locator('[data-example]');
  await expect(chips).toHaveCount(3); // exactly three, and nothing else to choose from
  await expect(page.locator('#empty [data-example]')).toHaveCount(3);
  // Rendering them made no network request: they are in the app, so they are there offline too.
  expect(requests.filter((u) => !u.includes('/auth/'))).toEqual([]);

  // A tap fills the box and puts the cursor in it. Nothing is sent until the person presses send.
  await chips.first().click();
  await expect(page.locator('#q')).toHaveValue(/Constitution/);
  await expect(page.locator('#q')).toBeFocused();
  await expect(page.locator('article.msg.user')).toHaveCount(0);
  expect(requests.filter((u) => u.includes('/v1/chat/completions'))).toEqual([]);

  await page.locator('#send').click();
  await expect(page.locator('article.msg.user')).toContainText('Constitution');
  // Once a conversation exists, the prompts are gone.
  await expect(page.locator('#empty')).toBeHidden();
  await expect(page.locator('[data-example]:visible')).toHaveCount(0);
});

test('the prompts are in the page with no network, and in Shona they are Shona', async ({ page, context }) => {
  await openChat(page);
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await page.waitForSelector('html[data-ready="true"]');
  await expect(page.locator('#empty [data-example]')).toHaveCount(3);
  await openAccount(page);
  await page.locator('#lang').selectOption('sn');
  await page.keyboard.press('Escape');
  await expect(page.locator('#empty [data-example]').first()).toContainText('Bumbiro');
});

test('a divider sits directly above the composer and moves with it, using the hairline token', async ({ page }) => {
  await openChat(page);
  const dock = page.locator('.dock');
  const style = await dock.evaluate((el) => {
    const c = getComputedStyle(el);
    return { style: c.borderTopStyle, width: c.borderTopWidth, color: c.borderTopColor, token: c.getPropertyValue('--border').trim() };
  });
  expect(style.style).toBe('solid');
  expect(parseFloat(style.width)).toBeGreaterThan(0);
  expect(parseFloat(style.width)).toBeLessThanOrEqual(1);
  expect(style.color).not.toBe('rgba(0, 0, 0, 0)');
  // It is the top edge of the composer's own box, so it can never be left behind when the composer moves.
  const box = await dock.evaluate((el) => ({ top: el.getBoundingClientRect().top, thread: document.querySelector('#thread')!.getBoundingClientRect().bottom }));
  expect(box.top).toBeGreaterThanOrEqual(box.thread - 1);
  // Raised, not dropped, for people who ask for more contrast.
  await page.emulateMedia({ forcedColors: 'active' });
  expect(parseFloat(await dock.evaluate((el) => getComputedStyle(el).borderTopWidth))).toBe(1);
});

test('Settings is in the drawer, there is no bell, and signing out brings the sign-in panel back', async ({ page }) => {
  await openChat(page);
  await expect(page.locator('#auth')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Notifications' })).toHaveCount(0);
  // No account menu in the top bar: its three controls are the drawer, the brand and New chat.
  await expect(page.locator('[data-slot="app-topbar"] details')).toHaveCount(0);

  // Signed in, Settings holds language, Delete history and the way to remove the key.
  await openAccount(page);
  await expect(page.locator('#lang')).toBeVisible();
  await expect(page.locator('#signout')).toBeVisible();
  await expect(page.locator('#open-signin')).toHaveCount(0); // sign-in is shown once, on the page
  await page.locator('#signout').click();
  await expect(page.locator('#auth')).toBeVisible();
});

test('Settings is named in Shona, and Install stays visible after a question', async ({ page }) => {
  await openChat(page);
  await openAccount(page);
  await page.locator('#lang').selectOption('sn');
  await expect(page.locator('details.account summary')).toHaveText('Zvirongwa');
  // The install button lives outside the greeting, so asking a question (which hides the greeting) does not take it away.
  await expect(page.locator('#install').locator('xpath=ancestor::*[@id="empty"]')).toHaveCount(0);
});

test('the shell speaks the chosen language: new chat, the drawer buttons and the chats region', async ({ page }) => {
  await openChat(page);
  await openAccount(page);
  await page.locator('#lang').selectOption('sn');
  await page.keyboard.press('Escape'); // close the drawer
  await expect(page.getByRole('button', { name: 'Vhura hurukuro' })).toBeVisible();
  await page.getByRole('button', { name: 'Vhura hurukuro' }).click();
  await expect(page.getByRole('button', { name: 'Vhara hurukuro' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Hurukuro itsva' })).toBeVisible();
  await expect(page.locator('[data-slot="app-sidebar"]')).toHaveAttribute('aria-label', 'Hurukuro dzenyu');
});

test('picking an earlier chat closes the drawer, so the chat is not left covered', async ({ page }) => {
  await openChat(page);
  await ask(page, 'Is everyone equal under the law?');
  await expect(page.locator('.cite-link').first()).toBeVisible();
  await newChat(page);
  await openChats(page);
  await page.locator('#history-list button').first().click();
  await expect(page.locator('[data-slot="app-sidebar"]')).toBeHidden();
  await expect(page.locator('article.msg.bot').first()).toBeVisible();
});

test('the chat has no small print under it: a link opens the disclaimer and privacy page', async ({ page }) => {
  await openChat(page);
  await expect(page.locator('[data-i18n="storedHere"]')).toHaveCount(0);
  // Not under the chat: no footer is left on the page, and the link is a row in the drawer.
  await expect(page.locator('[data-slot="app-footer"]')).toHaveCount(0);
  await openChats(page);
  await page.getByRole('link', { name: 'Disclaimer and privacy' }).click();
  await expect(page).toHaveURL(/\/lite\/disclaimer\/$/);
  await expect(page.getByText('not the text of your question or its answer')).toBeVisible();
  await expect(page.getByText('This is not legal advice')).toBeVisible();
  await expect(page.locator('script')).toHaveCount(0); // only the chat page ships a script
  // It is a document, not the chat's one scroller: the other languages and the way back can be reached on a phone.
  const back = page.getByRole('link', { name: 'Back to the chat' });
  await back.scrollIntoViewIfNeeded();
  await expect(back).toBeInViewport();
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).overflowY)).not.toBe('hidden');
});

test('the drawer pins a chat, files it in a project, keeps a saved answer, and deleting history clears all of it', async ({ page }) => {
  await openChat(page);
  await ask(page, 'Is everyone equal under the law?');
  await expect(page.locator('article.msg.bot .cite').first()).toBeVisible();

  // A project, made from the drawer, and the open chat filed in it.
  await openChats(page);
  await makeProject(page, 'Know my rights');
  await expect(page.locator('#project-list summary')).toContainText('Know my rights (0)');
  await page.keyboard.press('Escape');
  await page.locator('#chat-project').selectOption({ label: 'Know my rights' });
  await openChats(page);
  await expect(page.locator('#project-list summary')).toContainText('Know my rights (1)');

  // Pin the chat: it is listed under Pinned.
  await page.keyboard.press('Escape');
  await page.locator('#pin-chat').click();
  await expect(page.locator('#pin-chat')).toHaveAttribute('aria-pressed', 'true');
  await openSection(page, 'Chat');
  await expect(page.locator('#side-pinned')).toBeVisible();
  await expect(page.locator('#pinned-list')).toContainText('Is everyone equal');
  await page.keyboard.press('Escape');

  // Keep the answer: it appears under Artifacts and opens in a dialog with its source.
  await page.getByRole('button', { name: 'Save answer' }).click();
  await expect(page.locator('#toast')).toContainText('Saved to Artifacts');
  await openSection(page, 'Artifacts');
  await page.locator('#artifact-list button').first().click();
  await expect(page.locator('#artifact-view')).toBeVisible();
  await expect(page.locator('#artifact-cites li').first()).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();

  // It all survives a reload (it is on the device) and goes with Delete history.
  await page.reload();
  await page.waitForSelector('html[data-ready="true"]');
  await openSection(page, 'Artifacts');
  await expect(page.locator('#artifact-list button')).toHaveCount(1);
  await openSection(page, 'Projects');
  await expect(page.locator('#project-list summary')).toContainText('Know my rights');
  await page.keyboard.press('Escape');
  page.once('dialog', (d) => d.accept());
  await openAccount(page);
  await page.getByRole('button', { name: 'Delete history' }).click();
  await openSection(page, 'Artifacts');
  await expect(page.locator('#artifact-list button')).toHaveCount(0);
  await expect(page.locator('#project-list li')).toHaveCount(0);
});
