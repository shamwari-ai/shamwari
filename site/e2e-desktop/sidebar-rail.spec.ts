import { expect, test } from '@playwright/test';
import { openChat, underTheFloor } from '../e2e/helpers';

// After shadcn's sidebar-07: the session list collapses to an icon rail (not out of sight), keeps every control's name, is
// remembered, and its foot is an account card. With a mouse the rows keep the 32px density size.

test('the panel button collapses the sidebar to an icon rail, names kept, and it comes back', async ({ page }) => {
  await openChat(page);
  const side = page.locator('#chat-sidebar');
  const full = (await side.boundingBox())!.width;
  expect(full).toBeCloseTo(280, 0);
  await page.locator('#side-toggle').click();
  await expect.poll(async () => Math.round((await side.boundingBox())!.width)).toBe(80);
  // Still on screen, still named: the labels are drawn away, not removed.
  for (const name of ['New chat', 'Search chats', 'Chat', 'Projects', 'Artifacts', 'Settings']) {
    const b = page.locator('#chat-sidebar').getByRole('button', { name, exact: true });
    await expect(b, name).toBeVisible();
    const box = (await b.boundingBox())!;
    expect(box.width, `${name} is an icon`).toBeLessThan(60);
    expect(box.x, `${name} stays inside the rail`).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(80);
  }
  expect(await page.locator('#chat-sidebar .side-head .wordmark').evaluate((el) => el.getBoundingClientRect().width), 'the wordmark is drawn away').toBeLessThanOrEqual(1);
  expect(await underTheFloor(page, { minHit: 32 }), 'the rail meets the floor with a mouse').toEqual([]);
  // The choice is remembered.
  await page.reload();
  await page.waitForSelector('html[data-ready="true"]');
  await expect.poll(async () => Math.round((await side.boundingBox())!.width)).toBe(80);
  await page.locator('#side-toggle').click();
  await expect.poll(async () => Math.round((await side.boundingBox())!.width)).toBe(280);
});

test('the foot is an account card: an avatar, the label and a chevrons mark, opening Settings', async ({ page }) => {
  await openChat(page);
  const card = page.locator('#open-settings');
  await expect(card).toHaveText('Settings');
  await expect(card.locator('.avatar')).toBeVisible();
  await expect(card.locator('svg[data-icon="chevrons-up-down"]')).toBeVisible();
  await card.click();
  await expect(page.locator('#settings-dialog')).toBeVisible();
});
