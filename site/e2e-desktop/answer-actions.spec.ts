import { expect, test } from '@playwright/test';
import { ask, openChat } from '../e2e/helpers';

// With a mouse, the actions under an answer are small icon-only squares (28px, over the 24px desktop floor), out of sight under
// every answer but the latest until that answer is hovered or reached with the keyboard, so a long chat reads as words.

const ANSWERS = 'article.msg.bot:not(.pending)';

test('icon-only 28px squares; hidden under an older answer until hovered or focused; always there under the latest', async ({ page }) => {
  await openChat(page);
  await ask(page, 'Is everyone equal under the law?');
  await expect(page.locator(`${ANSWERS} .cite`).first()).toBeVisible();
  await ask(page, 'Is it legal?');
  await expect(page.locator(ANSWERS)).toHaveCount(2);
  await expect(page.locator(`${ANSWERS} .cite`).nth(1)).toBeVisible();
  await page.mouse.move(0, 0);

  const older = page.locator(ANSWERS).first();
  const latest = page.locator(ANSWERS).last();
  const opacity = (loc: typeof older) => loc.locator('.msg-actions').evaluate((el) => getComputedStyle(el).opacity);

  for (const b of await latest.locator('.msg-actions button').all()) {
    const box = (await b.boundingBox())!;
    expect(Math.round(box.width)).toBe(28);
    expect(Math.round(box.height)).toBe(28);
  }
  await expect.poll(() => opacity(latest), 'the latest answer keeps its actions in view').toBe('1');
  await expect.poll(() => opacity(older), 'an older answer hides them at rest').toBe('0');
  await older.hover();
  await expect.poll(() => opacity(older), 'hovering the answer shows them').toBe('1');
  await page.mouse.move(0, 0);
  await expect.poll(() => opacity(older)).toBe('0');
  await older.locator('.copy-answer').focus();
  await expect.poll(() => opacity(older), 'reaching one with the keyboard shows them').toBe('1');
});
