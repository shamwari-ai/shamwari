import { expect, test } from '@playwright/test';
import { openAccount, openChat } from './helpers';

// The person can tell which version they run and ask for the latest: Settings shows the release with this build's
// fingerprint (so two builds never read the same), and "Check for updates" says whether there is a newer one.

test('Settings shows this build\'s version and "Check for updates" says it is the latest', async ({ page }) => {
  await openChat(page);
  await openAccount(page);
  await expect(page.locator('[data-current-version]')).toHaveText(/^v\d+\.\d+\.\d+ · [0-9a-f]{8}$/);
  const check = page.locator('#check-update');
  await expect(check).toBeVisible();
  await check.click();
  await expect(page.locator('[data-update-status="latest"]')).toBeVisible();
  await expect(page.locator('[data-update-status="latest"]')).toHaveText('You have the latest version.');
  await expect(page.locator('[data-update-status="failed"]')).toBeHidden();
});

test('the "new version is ready" note is hidden until a new release takes over', async ({ page }) => {
  await openChat(page);
  await expect(page.locator('#update-note')).toBeHidden();
});
