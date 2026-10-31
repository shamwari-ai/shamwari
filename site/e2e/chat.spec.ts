import { expect, test } from '@playwright/test';
import { ask, openChat } from './helpers';

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
  ['sk_shamwari_mock_503', /having trouble right now/i],
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
  await page.locator('#history summary').click();
  await expect(page.locator('#history-list button')).toContainText('Is everyone equal');

  page.once('dialog', (d) => d.accept());
  await page.getByText('Settings').click();
  await page.getByRole('button', { name: 'Delete history' }).click();
  await expect(page.locator('#toast')).toContainText('History deleted');
  await expect(page.locator('#history')).toBeHidden();
  await page.reload();
  await page.waitForSelector('html[data-ready="true"]');
  await expect(page.locator('#log article')).toHaveCount(0);
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
  await page.locator('#lang').selectOption('sn');
  await expect(page.locator('html')).toHaveAttribute('lang', 'sn');
  await expect(page.locator('#review')).toBeVisible();
  await expect(page.locator('#send')).toHaveText('Tumira');
  await page.locator('#q').fill('hello');
  await page.locator('#q').press('Enter');
  await expect(page.locator('article.msg.bot').first()).toBeVisible();
});
