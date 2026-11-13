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
  await expect(page.locator('#history-list button.chat-row[aria-current="true"]')).toHaveCount(1);

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
  const text = (await answer.locator('.text').textContent()) ?? '';
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

test('the composer has one edge: the container, not the text box inside it', async ({ page }) => {
  await openChat(page);
  const box = await page.locator('#q').evaluate((el) => ({ border: parseFloat(getComputedStyle(el).borderTopWidth), bg: getComputedStyle(el).backgroundColor }));
  expect(box.border).toBe(0);
  expect(box.bg).toBe('rgba(0, 0, 0, 0)');
  await page.locator('#q').focus();
  expect(await page.locator('.composer').evaluate((el) => getComputedStyle(el).outlineStyle), 'the ring is the container\'s').toBe('solid');
});

test('the chat\'s "..." menu sits by its title and holds pin, project and delete', async ({ page }) => {
  await openChat(page);
  await expect(page.locator('#chat-menu')).toBeHidden(); // no chat yet
  await ask(page, 'Is it legal to be searched?');
  await expect(page.locator('article.msg.bot:not(.pending)')).toBeVisible();
  await expect(page.locator('#chat-tools')).toBeHidden(); // closed: not a toolbar over the thread
  await page.locator('#chat-menu').click();
  await expect(page.locator('#chat-tools')).toBeVisible();
  for (const sel of ['#pin-chat', '#chat-project', '#delete-chat']) await expect(page.locator(sel)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#chat-tools')).toBeHidden();
  // Delete asks first: declining keeps the chat.
  page.once('dialog', (d) => void d.dismiss());
  await page.locator('#chat-menu').click();
  await page.locator('#delete-chat').click();
  await expect(page.locator('article.msg.user')).toHaveCount(1);
});

test('a source is one compact row, with the detail under it', async ({ page }) => {
  await openChat(page);
  await ask(page, 'Is everyone equal under the law?');
  const cite = page.locator('.cite').first();
  await expect(cite).toBeVisible();
  await expect(cite.locator('.badge')).toHaveText('Ground');
  expect(await cite.evaluate((el) => el.getBoundingClientRect().height), 'one row').toBeLessThanOrEqual(56);
  await expect(cite.locator('.cite-meta')).toBeHidden();
  await expect(cite.locator('.cite-link')).toBeVisible();
  await cite.locator('summary').click();
  await expect(cite.locator('.cite-meta')).toBeVisible();
});

test('a chat in the list has its own "..." menu: pin, project, delete', async ({ page }) => {
  await openChat(page);
  await ask(page, 'What does the Constitution say about equality?');
  await expect(page.locator('.cite').first()).toBeVisible();
  await newChat(page);
  await ask(page, 'Is it legal to be searched?');
  await expect(page.locator('article.msg.bot:not(.pending) .cite').first()).toBeVisible();
  await openChats(page);
  const first = page.locator('#history-list li.chat-li').filter({ hasText: 'What does the' });
  await first.locator('.row-more').click();
  await expect(page.locator('#row-menu')).toBeVisible();
  // Pin: the chat moves under Pinned.
  await page.locator('#row-pin').click();
  await expect(page.locator('#pinned-list')).toContainText('What does the');
  await expect(page.locator('#row-menu')).toBeHidden();
  // Delete asks first; declining keeps it, accepting removes only that chat.
  await page.locator('#pinned-list li.chat-li .row-more').click();
  page.once('dialog', (d) => void d.dismiss());
  await page.locator('#row-delete').click();
  await expect(page.locator('#pinned-list')).toContainText('What does the');
  await page.locator('#pinned-list li.chat-li .row-more').click();
  page.once('dialog', (d) => void d.accept());
  await page.locator('#row-delete').click();
  await expect(page.locator('#pinned-list')).not.toContainText('What does the');
  await expect(page.locator('article.msg.user')).toHaveCount(1); // the open chat is untouched
});
