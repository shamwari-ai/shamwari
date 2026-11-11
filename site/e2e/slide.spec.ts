import { expect, test, type Page } from '@playwright/test';
import { openChat } from './helpers';

// Opening the drawer slides the page aside (away from the drawer, to the right) instead of laying the drawer over it.

const toggle = (page: Page) => page.getByRole('button', { name: /open chats/i });
const pageX = (page: Page) => page.locator('[data-slot="app-main"]').evaluate((el) => el.getBoundingClientRect().x);
const drawerW = (page: Page) => page.locator('#chat-sidebar').evaluate((el) => el.getBoundingClientRect().width);

/** Wait for the slide to finish: the page's x stops changing. */
const settled = async (page: Page) => {
  let last = NaN;
  await expect
    .poll(async () => {
      const x = await pageX(page);
      const same = x === last;
      last = x;
      return same;
    })
    .toBe(true);
};

test('opening slides the page aside by the drawer width, keeps a slice of it visible, and says so', async ({ page }) => {
  await openChat(page);
  await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false');
  expect(await pageX(page)).toBe(0);
  await toggle(page).click();
  await expect(page.locator('html')).toHaveAttribute('data-drawer', 'open');
  await settled(page);
  const w = await drawerW(page);
  expect(w).toBeGreaterThan(200);
  expect(Math.round(await pageX(page))).toBe(Math.round(w)); // moved by the drawer's width, to the right
  expect(w, 'a slice of the page stays visible').toBeLessThan(page.viewportSize()!.width - 40);
  await expect(page.locator('#chat-sidebar')).toBeVisible();
  await expect(page.locator('#chat-sidebar')).toHaveJSProperty('offsetLeft', 0);
  await expect(page.locator('[data-slot="app-main"]')).toHaveJSProperty('inert', true);
  await expect(page.locator('#chat-sidebar button[popovertargetaction="hide"]')).toBeFocused();
});

test('Escape closes it: the page slides back, is no longer inert, and focus returns to the button that opened it', async ({ page }) => {
  await openChat(page);
  await toggle(page).click();
  await settled(page);
  await page.keyboard.press('Escape');
  await expect(page.locator('html')).not.toHaveAttribute('data-drawer', 'open');
  await settled(page);
  expect(await pageX(page)).toBe(0);
  await expect(page.locator('[data-slot="app-main"]')).toHaveJSProperty('inert', false);
  await expect(toggle(page)).toBeFocused();
  await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false');
});

test('the close button in the drawer closes it, and so does a tap on the slice of page that stays visible', async ({ page }) => {
  await openChat(page);
  await toggle(page).click();
  await settled(page);
  await page.locator('#chat-sidebar').getByRole('button', { name: /close chats/i }).click();
  await expect(page.locator('html')).not.toHaveAttribute('data-drawer', 'open');
  await settled(page);

  await toggle(page).click();
  await settled(page);
  const w = await drawerW(page);
  const width = page.viewportSize()!.width;
  await page.mouse.click(w + (width - w) / 2, 300); // the middle of the slice
  await expect(page.locator('html')).not.toHaveAttribute('data-drawer', 'open');
  await expect(page.locator('#chat-sidebar')).toBeHidden();
  await settled(page);
  expect(await pageX(page)).toBe(0);
});

test('while it is open the page behind cannot be reached: nothing in it takes focus', async ({ page }) => {
  await openChat(page);
  await toggle(page).click();
  await settled(page);
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press('Tab');
    const inPage = await page.evaluate(() => !!document.activeElement?.closest('[data-slot="app-main"]'));
    expect(inPage, `Tab ${i + 1} stayed inside the drawer`).toBe(false);
  }
});

test('one variable sets the direction: flipped, the page slides the other way', async ({ page }) => {
  await openChat(page);
  await page.evaluate(() => document.documentElement.style.setProperty('--drawer-shift', '-1'));
  await toggle(page).click();
  await settled(page);
  const w = await drawerW(page);
  expect(Math.round(await pageX(page))).toBe(-Math.round(w));
});

test('only the transform animates, and with reduced motion it is instant', async ({ page }) => {
  await openChat(page);
  const props = () =>
    page.locator('[data-slot="app-main"]').evaluate((el) => {
      const c = getComputedStyle(el);
      return { property: c.transitionProperty, duration: c.transitionDuration };
    });
  const normal = await props();
  expect(normal.property).toBe('transform');
  expect(parseFloat(normal.duration)).toBeGreaterThan(0);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  const reduced = await props();
  expect(parseFloat(reduced.duration)).toBe(0);
  await toggle(page).click();
  await expect(page.locator('html')).toHaveAttribute('data-drawer', 'open');
  // No wait for a slide: the moment the drawer is open the page is already where it ends up.
  expect(Math.round(await pageX(page))).toBe(Math.round(await drawerW(page)));
});
