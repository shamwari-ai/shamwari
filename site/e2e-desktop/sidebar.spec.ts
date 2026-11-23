import { expect, test } from '@playwright/test';
import { openChat } from '../e2e/helpers';

// From 64rem the session list is a column that the top bar's panel button collapses to an icon rail and expands again (issue #329,
// after shadcn's sidebar-07); the choice is kept on this device. e2e-desktop/sidebar-rail.spec.ts checks the rail itself. The palette's key is shown beside its button.

test('the panel button collapses the session list to an icon rail and back, and the choice survives a reload', async ({ page }) => {
  await openChat(page);
  const side = page.locator('[data-slot="app-sidebar"]');
  const toggle = page.getByRole('button', { name: 'Collapse the chat list' });
  await expect(side).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await toggle.click();
  await expect.poll(async () => Math.round((await side.boundingBox())!.width), 'an icon rail, still on screen').toBeLessThan(100);
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  expect((await page.locator('#log').boundingBox())!.width, 'the column keeps its measure').toBeLessThanOrEqual(46 * 16 + 1);
  await page.reload();
  await page.waitForSelector('html[data-ready="true"]');
  await expect.poll(async () => Math.round((await side.boundingBox())!.width)).toBeLessThan(100);
  await toggle.click();
  await expect.poll(async () => Math.round((await side.boundingBox())!.width)).toBeGreaterThan(250);
});

test('the command button shows its key and opens the palette', async ({ page }) => {
  await openChat(page);
  await expect(page.locator('#open-palette .kbd')).toBeVisible();
  await page.locator('#open-palette').click();
  await expect(page.getByRole('dialog', { name: 'Commands' })).toBeVisible();
});
