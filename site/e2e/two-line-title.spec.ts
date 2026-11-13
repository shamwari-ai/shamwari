import { expect, test, type Page } from '@playwright/test';
import { ask, makeProject, openChat } from './helpers';

// The top bar shows the chat as two lines (#269): the title, then a quiet subtitle (its project, else when it was last used).
// The title block is the ONE tappable target (49px) and opens the chat menu; the subtitle is plain text. On a phone the wordmark gives way
// to it while a chat is open (it stays on the empty screen). The bar does not grow.

const barHeight = (page: Page) => page.evaluate(() => document.querySelector('[data-slot="app-topbar"]')!.getBoundingClientRect().height);
const brandShown = (page: Page) =>
  page.evaluate(() => {
    const b = document.querySelector('[data-slot="app-topbar"] .brand') as HTMLElement | null;
    return !!b && getComputedStyle(b).display !== 'none' && b.getBoundingClientRect().width > 0;
  });

for (const width of [320, 360, 1280]) {
  test(`once there is a chat the top bar has a title, a subtitle and one 49px tappable block, at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 700 });
    await openChat(page);
    const emptyBar = await barHeight(page);
    await ask(page, 'Is everyone equal under the law?');
    await expect(page.locator('article.msg.bot:not(.pending)').first()).toBeVisible();
    const title = page.locator('h1#chat-title');
    const sub = page.locator('#chat-sub');
    await expect(title).toBeVisible();
    await expect(title).toHaveText('Is everyone equal under the law?');
    await expect(sub).toBeVisible();
    expect(((await sub.textContent()) ?? '').trim().length, 'a subtitle').toBeGreaterThan(0);
    const [t, s, bar] = await Promise.all([title.boundingBox(), sub.boundingBox(), page.locator('[data-slot="app-topbar"]').boundingBox()]);
    expect(s!.y, 'the subtitle is the second line').toBeGreaterThanOrEqual(t!.y + t!.height - 1);
    expect(s!.y + s!.height).toBeLessThanOrEqual(bar!.y + bar!.height + 1);
    expect(await barHeight(page), 'the bar did not grow').toBeLessThanOrEqual(emptyBar + 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    // One tappable target: the title block. The subtitle is not a button or a link.
    const hit = page.locator('#chat-title-hit');
    expect((await hit.boundingBox())!.height, 'a 49px hit region').toBeGreaterThanOrEqual(49);
    expect(await sub.evaluate((el) => !!el.closest('button, a') || !!el.querySelector('button, a'))).toBe(false);
    await hit.click();
    await expect(page.locator('#chat-tools')).toBeVisible();
    expect(await page.locator('#chat-tools').evaluate((el) => el.matches(':popover-open'))).toBe(true);
  });
}

test('the subtitle is the project name when the chat is in a project', async ({ page }) => {
  await openChat(page);
  await makeProject(page, 'Maize 2026');
  await page.keyboard.press('Escape');
  await ask(page, 'Is everyone equal under the law?');
  await expect(page.locator('article.msg.bot:not(.pending)').first()).toBeVisible();
  await page.locator('#chat-menu').click();
  await page.locator('#chat-project').selectOption({ label: 'Maize 2026' });
  await expect(page.locator('#chat-sub')).toContainText('Maize 2026');
});

test('on a phone the wordmark gives way to the title while a chat is open, and is back on the empty screen', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 700 });
  await openChat(page);
  expect(await brandShown(page), 'the empty screen keeps the wordmark').toBe(true);
  await ask(page, 'Is everyone equal under the law?');
  await expect(page.locator('article.msg.bot:not(.pending)').first()).toBeVisible();
  expect(await brandShown(page), 'a chat is open: the title takes its place').toBe(false);
});

test('a very long title is cut with an ellipsis inside the bar at 320px, never wrapping it or scrolling the page', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await openChat(page);
  const emptyBar = await barHeight(page);
  await ask(page, `Is everyone equal under the law? ${'a very long question '.repeat(20)}`);
  await expect(page.locator('article.msg.bot:not(.pending)').first()).toBeVisible();
  expect(await barHeight(page)).toBeLessThanOrEqual(emptyBar + 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});
