import { expect, test } from '@playwright/test';
import { ask, openChat } from './helpers';

// A failure says WHY, in the app: the gateway's reasons (gateway/src/failure.ts) and the request id that finds it in the
// logs. Before this, "Shamwari is having trouble" was all a person saw while AI Gateway was blocking every prompt.

test('while a question waits on an outage, the note says what the gateway said is wrong, and the request id', async ({ page }) => {
  await openChat(page);
  await ask(page, 'this one is blocked');
  const why = page.locator('.msg.user .queue-extra .why');
  await expect(why).toBeVisible();
  await expect(why).toContainText('What went wrong');
  await expect(why).toContainText('AI Gateway (424 · 2016): Prompt blocked due to security configurations');
  await expect(why).toContainText('Workers AI: workers ai returned no text');
  await expect(why.locator('.why-id code')).toHaveText('7a9ee814-3ff5-4bdf-95bc-2339047fabe6');
});

test('when it stops retrying, the failed answer keeps the reasons, and a reload still shows them', async ({ page }) => {
  await openChat(page);
  await ask(page, 'this one is blocked');
  // Three tries while online, then it is shown as failed (MAX_SILENT_ATTEMPTS in app.ts): press "Send now" to try at once.
  for (let i = 0; i < 2; i++) {
    await page.locator('.msg.user .queue-extra button').first().click();
  }
  const err = page.locator('.msg.error');
  await expect(err).toBeVisible({ timeout: 20_000 });
  await expect(err.locator('.why')).toContainText('Prompt blocked due to security configurations');
  await page.reload();
  await page.waitForSelector('html[data-ready="true"]');
  await expect(page.locator('.msg.error .why')).toContainText('Prompt blocked due to security configurations');
});
