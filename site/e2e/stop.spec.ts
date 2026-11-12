import { expect, test } from '@playwright/test';
import { ask, openChat } from './helpers';

// A slow answer can be stopped. The question stays on this device, unanswered and not queued: it is not sent again by itself.

test('after ten seconds a slow answer can be stopped; the question is kept, not retried, and can be sent now', async ({ page }) => {
  await page.clock.install();
  await openChat(page);
  const posts: string[] = [];
  page.on('request', (r) => r.method() === 'POST' && posts.push(r.url()));
  await ask(page, 'hang please');
  await expect(page.locator('.pending')).toBeVisible();
  await expect(page.locator('.stop-answer')).toHaveCount(0); // not at first
  await page.clock.fastForward(10_500);
  await expect(page.locator('.pending .note')).toContainText('Still working');
  await page.locator('.stop-answer').click();
  await expect(page.locator('.pending')).toHaveCount(0);
  // Kept on this device, said plainly, with the person's own choices; focus is back in the question box.
  const q = page.locator('article.msg.user');
  await expect(q).toContainText('Stopped. Your question is kept on this device and was not answered.');
  await expect(q.getByRole('button', { name: 'Send now' })).toBeVisible();
  await expect(q.getByRole('button', { name: 'Discard' })).toBeVisible();
  await expect(page.locator('#q')).toBeFocused();
  // Not retried by itself, even much later.
  const before = posts.length;
  await page.clock.fastForward(10 * 60_000);
  expect(posts.length).toBe(before);
  // Still there after a reload, still stopped.
  await page.reload();
  await page.waitForSelector('html[data-ready="true"]');
  await expect(page.locator('article.msg.user')).toContainText('Stopped.');
});

test('a stopped question can be discarded', async ({ page }) => {
  await page.clock.install();
  await openChat(page);
  await ask(page, 'hang please');
  await page.clock.fastForward(10_500);
  await page.locator('.stop-answer').click();
  await page.locator('article.msg.user').getByRole('button', { name: 'Discard' }).click();
  await expect(page.locator('article.msg.user')).toHaveCount(0);
});
