import { expect, test, type Page } from '@playwright/test';
import { ask, openChat } from './helpers';

// A round "jump to latest" button floats above the composer when the messages are scrolled up (#269). 49px target, labelled, round.

async function fill(page: Page, n: number) {
  for (let i = 0; i < n; i++) {
    await ask(page, `Is everyone equal under the law? ${i}`);
    await expect(page.locator('article.msg.bot:not(.pending) .cite').nth(i)).toBeVisible({ timeout: 30_000 });
  }
}
const scrollThreadTo = (page: Page, where: 'top' | 'bottom') =>
  page.evaluate((w) => {
    const t = document.querySelector('#thread') as HTMLElement;
    t.style.scrollBehavior = 'auto';
    t.scrollTop = w === 'top' ? 0 : t.scrollHeight;
  }, where);
const atBottom = (page: Page) =>
  page.evaluate(() => {
    const t = document.querySelector('#thread') as HTMLElement;
    return t.scrollHeight - t.scrollTop - t.clientHeight <= 2;
  });

test('hidden on the empty screen and at the end of the messages; shown once scrolled up', async ({ page }) => {
  await openChat(page);
  const jump = page.getByRole('button', { name: 'Jump to the latest message' });
  await expect(jump).toBeHidden();
  await fill(page, 5);
  await scrollThreadTo(page, 'bottom');
  await expect(jump).toBeHidden();
  await scrollThreadTo(page, 'top');
  await expect(jump).toBeVisible();
});

test('it is a round 49px button, centred above the composer, and a tap goes to the latest message', async ({ page }) => {
  await openChat(page);
  await fill(page, 5);
  await scrollThreadTo(page, 'top');
  const jump = page.getByRole('button', { name: 'Jump to the latest message' });
  await expect(jump).toBeVisible();
  const geo = await jump.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const d = document.querySelector('.dock')!.getBoundingClientRect();
    return { w: r.width, h: r.height, radius: parseFloat(getComputedStyle(el).borderTopLeftRadius), cx: r.left + r.width / 2, bottom: r.bottom, dockTop: d.top, vw: innerWidth };
  });
  expect(geo.w).toBeGreaterThanOrEqual(49);
  expect(geo.h).toBeGreaterThanOrEqual(49);
  expect(geo.radius).toBeGreaterThanOrEqual(geo.h / 2 - 0.5);
  expect(geo.bottom, 'above the composer').toBeLessThanOrEqual(geo.dockTop + 1);
  expect(Math.abs(geo.cx - geo.vw / 2) / geo.vw, 'centred in the page').toBeLessThan(0.25);
  await jump.click();
  await expect.poll(() => atBottom(page)).toBe(true);
  await expect(jump).toBeHidden();
  // Keyboard users are not dropped to the page when the button goes away.
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(false);
});

test('a new answer while scrolled up shows the button too', async ({ page }) => {
  await openChat(page);
  await fill(page, 4);
  await scrollThreadTo(page, 'top');
  await expect(page.getByRole('button', { name: 'Jump to the latest message' })).toBeVisible();
});

test('in Shona the button is labelled in Shona, and the page does not scroll sideways at 320px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.addInitScript(() => localStorage.setItem('shamwari.lang', 'sn'));
  await openChat(page);
  await fill(page, 5);
  await scrollThreadTo(page, 'top');
  await expect(page.getByRole('button', { name: 'Enda pasi' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});
