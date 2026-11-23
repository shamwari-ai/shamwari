import { expect, test } from '@playwright/test';
import { openAccount, openChat } from './helpers';

// The person can tell which version they run and ask for the latest: Settings shows the release with this build's
// fingerprint (so two builds never read the same), and "Check for updates" says whether there is a newer one.

test('Settings shows this build\'s version and "Check for updates" says it is the latest', async ({ page }) => {
  await openChat(page);
  await openAccount(page);
  // "v0.4.0 · 1a2b3c4d" for a released build, "v0.4.0+ · 1a2b3c4d" for one newer than the last release, or the fingerprint
  // alone where no release could be found (scripts/release-version.mjs). Never a made-up number.
  await expect(page.locator('[data-current-version]')).toHaveText(/^(v\d+\.\d+\.\d+\+? · )?[0-9a-f]{8}$/);
  const check = page.locator('#check-update');
  await expect(check).toBeVisible();
  await check.click();
  await expect(page.locator('[data-update-status="latest"]')).toBeVisible();
  await expect(page.locator('[data-update-status="latest"]')).toHaveText('You have the latest version.');
  await expect(page.locator('[data-update-status="failed"]')).toBeHidden();
});

test('when a new release takes over, a popup says so with Update now and Later, and nothing reloads under the person', async ({ page }) => {
  await openChat(page);
  const toast = page.locator('#update-note');
  await expect(toast).toBeHidden();
  // What the browser does when a new release's worker takes over this page (sw.js: skipWaiting + clients.claim).
  await page.evaluate(() => {
    (window as unknown as { stay: boolean }).stay = true;
    navigator.serviceWorker.dispatchEvent(new Event('controllerchange'));
  });
  await expect(toast).toBeVisible();
  await expect(toast).toContainText('A new version of Shamwari is available.');
  await expect(toast.getByRole('button', { name: 'Update now' })).toBeVisible();
  // In view, it waits for the person: the page has not reloaded.
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => (window as unknown as { stay?: boolean }).stay)).toBe(true);
  await toast.getByRole('button', { name: 'Later' }).click();
  await expect(toast).toBeHidden();
});

test('"Update now" reloads the page', async ({ page }) => {
  await openChat(page);
  await page.evaluate(() => {
    (window as unknown as { stay: boolean }).stay = true;
    navigator.serviceWorker.dispatchEvent(new Event('controllerchange'));
  });
  await page.locator('#update-now').click();
  await page.waitForSelector('html[data-ready="true"]');
  expect(await page.evaluate(() => (window as unknown as { stay?: boolean }).stay)).toBeUndefined();
});
