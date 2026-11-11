import { expect, test } from '@playwright/test';
import { ask, makeProject, openAccount, openChat, openChats, newChat } from './helpers';

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

test('a personal question gets the Shamwari Mind explanation, not a generic error', async ({ page }) => {
  await openChat(page);
  await page.getByLabel('Asking about').selectOption('personal');
  await ask(page, 'How much do I earn?');

  const refusal = page.locator('article.refusal');
  await expect(refusal).toBeVisible();
  await expect(refusal).toContainText('Shamwari Mind');
  await expect(refusal).toContainText('not available yet');
  await expect(page.locator('article.error')).toHaveCount(0);
  await expect(page.locator('[role="alert"]:visible')).toHaveCount(0);

  // The kind way out: ask it as a general question instead.
  await refusal.getByRole('button', { name: 'Ask a general question instead' }).click();
  await expect(page.locator('article.msg.bot', { hasText: 'right to life' })).toBeVisible();
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

test('a missing key asks for sign-in, keeps what was typed, and offers no key field', async ({ page }) => {
  await openChat(page, null);
  await expect(page.locator('#auth')).toBeVisible();
  // Sign-in is not on in this build: no button that cannot be pressed, just the plain line.
  await expect(page.getByRole('button', { name: 'Sign in with Mukoko' })).toBeHidden();
  await expect(page.locator('#mukoko-soon')).toBeVisible();
  await page.locator('#q').fill('hello');
  await page.locator('#send').click();
  await expect(page.locator('#auth-title')).toBeFocused();
  await expect(page.locator('#q')).toHaveValue('hello');
  // API keys are not typed into the page: "Use the API" in the drawer goes to the platform that issues them.
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
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
  // The draft notice is a banner in the page, not inside the menu: it shows with the menu closed.
  await page.locator('details.account summary').click();
  await expect(page.locator('details.account')).not.toHaveAttribute('open', '');
  await expect(page.locator('#review')).toBeVisible();
  await expect(page.locator('#send')).toHaveText('Tumira');
  await page.locator('#q').fill('hello');
  await page.locator('#q').press('Enter');
  await expect(page.locator('article.msg.bot').first()).toBeVisible();
});

test('the home screen greets, offers suggested prompts, and the chips ask the question', async ({ page }) => {
  await openChat(page);
  await expect(page.getByRole('heading', { name: 'Hello, friend' })).toBeVisible();
  const chips = page.locator('#empty [data-example]');
  await expect(chips).toHaveCount(3);
  // A chip is a question the person did not have to type: it asks, and the greeting steps aside.
  await chips.first().click();
  await expect(page.locator('article.msg.user')).toContainText('Constitution');
  await expect(page.locator('#empty')).toBeHidden();
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
  await page.goto('/lite/');
  await expect(page.locator('[data-i18n="storedHere"]')).toHaveCount(0);
  await page.getByRole('link', { name: 'Disclaimer and privacy' }).click();
  await expect(page).toHaveURL(/\/lite\/disclaimer\/$/);
  await expect(page.getByText('not the text of your question or its answer')).toBeVisible();
  await expect(page.getByText('This is not legal advice')).toBeVisible();
  await expect(page.locator('script')).toHaveCount(0); // only the chat page ships a script
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
  await openChats(page);
  await expect(page.locator('#side-pinned')).toBeVisible();
  await expect(page.locator('#pinned-list')).toContainText('Is everyone equal');
  await page.keyboard.press('Escape');

  // Keep the answer: it appears under Artifacts and opens in a dialog with its source.
  await page.getByRole('button', { name: 'Save answer' }).click();
  await expect(page.locator('#toast')).toContainText('Saved to Artifacts');
  await openChats(page);
  await page.locator('#artifact-list button').first().click();
  await expect(page.locator('#artifact-view')).toBeVisible();
  await expect(page.locator('#artifact-cites li').first()).toBeVisible();
  await page.getByRole('button', { name: 'Close' }).click();

  // It all survives a reload (it is on the device) and goes with Delete history.
  await page.reload();
  await page.waitForSelector('html[data-ready="true"]');
  await openChats(page);
  await expect(page.locator('#artifact-list button')).toHaveCount(1);
  await expect(page.locator('#project-list summary')).toContainText('Know my rights');
  await page.keyboard.press('Escape');
  page.once('dialog', (d) => d.accept());
  await openAccount(page);
  await page.getByRole('button', { name: 'Delete history' }).click();
  await openChats(page);
  await expect(page.locator('#artifact-list button')).toHaveCount(0);
  await expect(page.locator('#project-list li')).toHaveCount(0);
});
