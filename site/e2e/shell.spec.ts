import { expect, test } from '@playwright/test';
import { ask, newChat, openChat, openChats } from './helpers';

// The shell's console behaviours: history grouped by day with a muted time, search, the title in the top bar, copy under a
// reply, and a send button that waits for text.

test('history is grouped by day, one line per chat with its time, and Search narrows it', async ({ page }) => {
  await openChat(page);
  await ask(page, 'What does the Constitution say about equality?');
  await expect(page.locator('.cite').first()).toBeVisible();
  await newChat(page);
  await ask(page, 'Is it legal to be searched?');
  await expect(page.locator('article.msg.bot:not(.pending) .cite').first()).toBeVisible();
  await openChats(page);
  await expect(page.locator('#history-list .side-date')).toHaveText(['Today']);
  const rows = page.locator('#history-list button.chat-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.first().locator('.chat-row-when')).not.toHaveText('');
  // One line each: the title is cut with an ellipsis, never wrapped.
  for (const h of await rows.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height))) expect(h).toBeLessThanOrEqual(50);
  await expect(page.locator('#history-list button[aria-current="true"]')).toHaveCount(1);

  await page.locator('#side-search').click();
  await page.locator('#side-filter').fill('searched');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('searched');
  await page.locator('#side-filter').fill('zzzz');
  await expect(page.locator('#chats-empty')).toHaveText('No chats match.');
  await page.locator('#side-filter').press('Escape');
  await expect(rows).toHaveCount(2);
});

test('the chat title is the page heading and shows in the top bar once there is a chat', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openChat(page);
  const title = page.locator('h1#chat-title');
  await expect(title).toHaveText('Shamwari Chat'); // an empty chat: the app name, for screen readers only
  expect(await title.evaluate((el) => el.classList.contains('sr-only'))).toBe(true);
  await ask(page, 'Is it legal to be searched?');
  await expect(title).toHaveText('Is it legal to be searched?');
  expect(await title.evaluate((el) => el.classList.contains('sr-only'))).toBe(false);
  await expect(page.locator('h1:visible')).toHaveCount(1); // the sign-in screen's own h1 is hidden while signed in
});

test('a reply has a quiet Copy action that puts its words on the clipboard', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openChat(page);
  await ask(page, 'Is everyone equal under the law?');
  const answer = page.locator('article.msg.bot:not(.pending)').first();
  await expect(answer.locator('.cite').first()).toBeVisible();
  const text = (await answer.locator('p.text').textContent()) ?? '';
  await answer.getByRole('button', { name: 'Copy answer' }).click();
  await expect(answer.getByRole('button', { name: 'Copied' })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(text);
});

test('the round send button waits for text; Enter sends and Shift+Enter is a new line', async ({ page }) => {
  await openChat(page);
  await expect(page.locator('#send')).toBeDisabled();
  await expect(page.locator('#send')).toHaveAccessibleName('Send');
  await page.locator('#q').fill('Is it legal to be searched?');
  await expect(page.locator('#send')).toBeEnabled();
  await page.locator('#q').press('Shift+Enter');
  await expect(page.locator('#q')).toHaveValue('Is it legal to be searched?\n');
  await page.locator('#q').press('Backspace');
  await page.locator('#q').press('Enter');
  await expect(page.locator('article.msg.user')).toHaveCount(1);
  await expect(page.locator('#send')).toBeDisabled();
});
