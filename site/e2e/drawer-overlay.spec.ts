import { expect, test, type Page } from '@playwright/test';
import { openChat } from './helpers';

// Below 64rem the drawer is laid OVER the whole page with a dim backdrop. The page does not move, is not reachable while the
// drawer is open, and nothing of it is cut off by the drawer's edge (it is covered and dimmed, not shown half).

const toggle = (page: Page) => page.getByRole('button', { name: /open chats/i });
const pageX = (page: Page) => page.locator('[data-slot="app-main"]').evaluate((el) => el.getBoundingClientRect().x);
const drawerLeft = (page: Page) => page.locator('#chat-sidebar').evaluate((el) => Math.round(el.getBoundingClientRect().left));

/** Wait for the drawer to finish sliding in. */
const slidIn = (page: Page) => expect.poll(() => drawerLeft(page)).toBe(0);

for (const width of [320, 390, 768]) {
  test(`at ${width}px the drawer overlays the page: the page stays put, is dimmed and cannot be reached`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await openChat(page);
    await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false');
    await toggle(page).click();
    await expect(page.locator('html')).toHaveAttribute('data-drawer', 'open');
    await slidIn(page);
    expect(await pageX(page), 'the page does not move').toBe(0);
    const w = await page.locator('#chat-sidebar').evaluate((el) => el.getBoundingClientRect().width);
    expect(w).toBeLessThanOrEqual(Math.round(width * 0.86) + 1);
    await expect(page.locator('[data-slot="app-main"]')).toHaveJSProperty('inert', true);
    await expect(page.locator('#chat-sidebar button[popovertargetaction="hide"]')).toBeFocused();
    // The backdrop dims the page: the colour is a translucent black.
    await expect
      .poll(() => page.locator('#chat-sidebar').evaluate((el) => getComputedStyle(el, '::backdrop').backgroundColor))
      .toMatch(/ 0\.[1-9]\d*\)$/); // Mzizi's dim: the foreground colour, translucent
    // Nothing of the page is under the drawer's edge as a cut-off control: every point right of the drawer hits the backdrop, not the page.
    const hit = await page.evaluate((x) => document.elementFromPoint(x, 300)?.closest('[data-slot="app-main"]') !== null, w + 10);
    expect(hit, 'a tap beside the drawer does not land on the page').toBe(false);
  });
}

test('Escape closes it: the page is reachable again, and focus returns to the button that opened it', async ({ page }) => {
  await openChat(page);
  await toggle(page).click();
  await slidIn(page);
  await page.keyboard.press('Escape');
  await expect(page.locator('html')).not.toHaveAttribute('data-drawer', 'open');
  await expect(page.locator('[data-slot="app-main"]')).toHaveJSProperty('inert', false);
  await expect(toggle(page)).toBeFocused();
  await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false');
});

test('the close button closes it, and so does a tap on the dim part of the page', async ({ page }) => {
  await openChat(page);
  await toggle(page).click();
  await slidIn(page);
  await page.locator('#chat-sidebar').getByRole('button', { name: /close chats/i }).click();
  await expect(page.locator('html')).not.toHaveAttribute('data-drawer', 'open');

  await toggle(page).click();
  await slidIn(page);
  const w = await page.locator('#chat-sidebar').evaluate((el) => el.getBoundingClientRect().width);
  const width = page.viewportSize()!.width;
  await page.mouse.click(w + (width - w) / 2, 300); // the dim part beside the drawer
  await expect(page.locator('html')).not.toHaveAttribute('data-drawer', 'open');
  await expect(page.locator('#chat-sidebar')).toBeHidden();
  expect(await pageX(page)).toBe(0);
});

test('while it is open the page behind cannot be reached: nothing in it takes focus', async ({ page }) => {
  await openChat(page);
  await toggle(page).click();
  await slidIn(page);
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press('Tab');
    const inPage = await page.evaluate(() => !!document.activeElement?.closest('[data-slot="app-main"]'));
    expect(inPage, `Tab ${i + 1} stayed inside the drawer`).toBe(false);
  }
});

test('with reduced motion the drawer and its backdrop appear at once', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openChat(page);
  await toggle(page).click();
  await expect(page.locator('html')).toHaveAttribute('data-drawer', 'open');
  expect(await drawerLeft(page)).toBe(0); // no wait for a slide
  expect(await pageX(page)).toBe(0);
});

test('turning the screen wide while the drawer is open does not leave the page inert', async ({ page }) => {
  await openChat(page);
  await toggle(page).click();
  await slidIn(page);
  await page.setViewportSize({ width: 1100, height: 700 });
  await expect(page.locator('html')).not.toHaveAttribute('data-drawer', 'open');
  await expect(page.locator('[data-slot="app-main"]')).toHaveJSProperty('inert', false);
  await page.locator('#q').fill('still reachable');
  await expect(page.locator('#q')).toHaveValue('still reachable');
});
