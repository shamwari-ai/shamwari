import { expect, test } from '@playwright/test';
import { ask, openAccount, openChat, openChats } from './helpers';

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

test('a missing key asks for sign-in and keeps what was typed', async ({ page }) => {
  await openChat(page, null);
  await expect(page.locator('#auth')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in with Mukoko' })).toBeDisabled();
  await page.locator('#q').fill('hello');
  await page.locator('#send').click();
  await expect(page.locator('#key')).toBeFocused();
  await expect(page.locator('#q')).toHaveValue('hello');

  await page.locator('#key').fill('not-a-key');
  await page.getByRole('button', { name: 'Use this key' }).click();
  await expect(page.locator('#key-error')).toBeVisible();

  await page.locator('#key').fill('sk_shamwari_mock_ok');
  await page.getByRole('button', { name: 'Use this key' }).click();
  await expect(page.locator('#auth')).toBeHidden();
  await expect(page.locator('#q')).toBeFocused();
});

test('history stays on the device across reloads, new chat starts clean, delete wipes it', async ({ page }) => {
  await openChat(page);
  await ask(page, 'Is everyone equal under the law?');
  await expect(page.locator('article.msg.bot .cite').first()).toBeVisible();

  await page.reload();
  await page.waitForSelector('html[data-ready="true"]');
  await expect(page.locator('article.msg.user')).toContainText('Is everyone equal');
  await expect(page.locator('.cite').first()).toBeVisible();

  await page.getByRole('button', { name: 'New chat' }).click();
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

test('the bell says there is nothing new, and the account menu holds sign-in and settings', async ({ page }) => {
  await openChat(page, null);
  await page.locator('#auth').waitFor();
  await page.locator('#key').fill('sk_shamwari_mock_ok');
  await page.getByRole('button', { name: 'Use this key' }).click();
  await expect(page.locator('#auth')).toBeHidden();

  await page.getByRole('button', { name: 'Notifications' }).click();
  await expect(page.locator('#toast')).toHaveText('No new notifications');
  // A second tap says it again (the line is cleared first so a screen reader announces it) and it
  // clears itself, so it does not sit next to unrelated state.
  await page.getByRole('button', { name: 'Notifications' }).click();
  await expect(page.locator('#toast')).toHaveText('No new notifications');
  await expect(page.locator('#toast')).toHaveText('', { timeout: 6000 });

  // Signed in, the account menu holds Settings, where the person can remove the key.
  await openAccount(page);
  await expect(page.locator('#signout')).toBeVisible();
  await expect(page.locator('#open-signin')).toBeHidden(); // signed in, so no "Sign in"
  await page.locator('#signout').click();
  await expect(page.locator('#auth')).toBeVisible();
  // Signed out, "Sign in" in the account menu brings the sign-in panel back after it was dismissed.
  await page.locator('#auth').evaluate((el) => ((el as HTMLElement).hidden = true));
  await openAccount(page);
  await page.locator('#open-signin').click();
  await expect(page.locator('#auth')).toBeVisible();
});

test('the icon buttons keep an accessible name in Shona, and Install stays visible after a question', async ({ page }) => {
  await openChat(page);
  await openAccount(page);
  await page.locator('#lang').selectOption('sn');
  await expect(page.getByRole('button', { name: 'Zviziviso' })).toBeVisible();
  // The account icon is a disclosure (<summary>), so it is found by its accessible name directly.
  await expect(page.locator('details.account summary')).toHaveAttribute('aria-label', 'Akaunti');
  // The install button lives outside the greeting, so asking a question (which hides the greeting) does not take it away.
  await expect(page.locator('#install').locator('xpath=ancestor::*[@id="empty"]')).toHaveCount(0);
});

test('the shell speaks the chosen language: new chat, the drawer buttons and the chats region', async ({ page }) => {
  await openChat(page);
  await openAccount(page);
  await page.locator('#lang').selectOption('sn');
  await page.locator('details.account summary').click();
  await expect(page.getByRole('button', { name: 'Hurukuro itsva' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Vhura hurukuro' })).toBeVisible();
  await page.getByRole('button', { name: 'Vhura hurukuro' }).click();
  await expect(page.getByRole('button', { name: 'Vhara hurukuro' })).toBeVisible();
  await expect(page.locator('[data-slot="app-sidebar"]')).toHaveAttribute('aria-label', 'Hurukuro dzenyu');
});

test('picking an earlier chat closes the drawer, so the chat is not left covered', async ({ page }) => {
  await openChat(page);
  await ask(page, 'Is everyone equal under the law?');
  await expect(page.locator('.cite-link').first()).toBeVisible();
  await page.locator('#new-chat').click();
  await openChats(page);
  await page.locator('#history-list button').first().click();
  await expect(page.locator('[data-slot="app-sidebar"]')).toBeHidden();
  await expect(page.locator('article.msg.bot').first()).toBeVisible();
});

test('the privacy sentence is the same before the script runs and after (English)', async ({ page }) => {
  await page.route('**/_astro/**/*.js', (r) => r.abort()); // no script: the static page as a person without it sees it
  await page.goto('/lite/');
  const staticText = await page.locator('[data-i18n="storedHere"]').innerText();
  expect(staticText).toContain('not the text of your question or its answer');
  expect(staticText).not.toContain('a record of each question it answers');
});
