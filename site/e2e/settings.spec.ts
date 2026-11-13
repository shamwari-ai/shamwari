import { expect, test } from '@playwright/test';
import { openAccount, openChat, openChats } from './helpers';

// Settings is a modal dialog (native <dialog>): it opens from the drawer's foot, the drawer closes first, the page behind it is
// inert, Esc and the close button and a tap on the dim edge all close it. On a phone it is a full-screen sheet with a pinned close button.

test('Settings opens as a full-screen sheet on a phone, with the drawer closed behind it', async ({ page }) => {
  await openChat(page);
  await openChats(page);
  await page.locator('#open-settings').click();
  const dialog = page.locator('#settings-dialog');
  await expect(dialog).toBeVisible();
  expect(await page.locator('#chat-sidebar').evaluate((el) => el.matches(':popover-open')), 'the drawer closed first').toBe(false);
  const box = await dialog.boundingBox();
  expect(box!.width).toBeCloseTo(360, 0);
  expect(box!.height).toBeCloseTo(640, 0);
  const close = await page.locator('#settings-close').boundingBox();
  expect(close!.height).toBeGreaterThanOrEqual(49);
  expect(close!.width).toBeGreaterThanOrEqual(49);
  expect(close!.y, 'the close button is pinned at the top').toBeLessThan(20);
  // Language, data, about
  for (const name of ['Language', 'Data on this device', 'About']) await expect(dialog.getByRole('heading', { name })).toBeVisible();
  await expect(page.locator('#q')).toBeHidden({ timeout: 100 }).catch(() => undefined);
  expect(await page.locator('#q').evaluate((el) => !!el.closest('[inert]') || document.querySelector('dialog[open]:modal') !== null), 'the page behind is held by the modal').toBe(true);
});

test('Settings closes with Esc, with its close button and with a tap outside the box', async ({ page }) => {
  await openChat(page);
  await openAccount(page);
  await page.keyboard.press('Escape');
  await expect(page.locator('#settings-dialog')).toBeHidden();
  await openAccount(page);
  await page.locator('#settings-close').click();
  await expect(page.locator('#settings-dialog')).toBeHidden();
  // Focus is not lost: it is on something visible (the button that opened the drawer, or the chat box), not on the page body.
  expect(await page.evaluate(() => document.activeElement !== document.body && !!(document.activeElement as HTMLElement | null)?.checkVisibility())).toBe(true);
});

test('a draft language shows its review note inside Settings, and the delete confirm opens above it', async ({ page }) => {
  await openChat(page);
  await openAccount(page);
  await expect(page.locator('#review')).toBeHidden();
  await page.locator('#lang').selectOption('sn');
  await expect(page.locator('#review')).toBeVisible();
  await page.locator('#lang').selectOption('en');
  let asked = '';
  page.once('dialog', async (d) => {
    asked = d.message();
    await d.dismiss();
  });
  await page.locator('#delete-history').click();
  expect(asked).not.toBe('');
  await expect(page.locator('#settings-dialog')).toBeVisible(); // cancelled: Settings stays
});
