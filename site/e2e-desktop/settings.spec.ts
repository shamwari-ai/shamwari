import { expect, test } from '@playwright/test';
import { openChat } from '../e2e/helpers';

// On a wide screen Settings is a centred box, no wider than 32rem.
for (const scheme of ['light', 'dark'] as const) {
  test(`Settings is a centred box of at most 32rem on a desktop (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await openChat(page);
    await page.locator('#open-settings').click(); // the sidebar is a column here: no drawer to open first
    const box = (await page.locator('#settings-dialog').boundingBox())!;
    expect(box.width).toBeLessThanOrEqual(512 + 1);
    expect(box.width).toBeGreaterThan(300);
    expect(Math.abs(box.x + box.width / 2 - 640), 'centred across').toBeLessThan(4);
    expect(box.height).toBeLessThan(800);
    await page.keyboard.press('Escape');
    await expect(page.locator('#settings-dialog')).toBeHidden();
  });
}

test('a tap on the dim edge closes Settings, but a drag that began inside and ended outside does not', async ({ page }) => {
  await openChat(page);
  await page.locator('#open-settings').click();
  const box = (await page.locator('#settings-dialog').boundingBox())!;
  await page.mouse.move(box.x + 40, box.y + 40);
  await page.mouse.down();
  await page.mouse.move(4, 4);
  await page.mouse.up();
  await expect(page.locator('#settings-dialog')).toBeVisible();
  await page.mouse.click(4, 4);
  await expect(page.locator('#settings-dialog')).toBeHidden();
});
