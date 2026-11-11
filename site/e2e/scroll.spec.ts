import { expect, test } from '@playwright/test';
import { ask, openChat } from './helpers';

// The top bar and the dock are pinned over the page. Whatever the page scrolls to (a new answer, the
// "thinking" bubble, a focused control) must land between them, never underneath either one.

const box = (page: import('@playwright/test').Page, sel: string) =>
  page.evaluate((s) => {
    const r = document.querySelector(s)!.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom };
  }, sel);

/** The page scrolls smoothly: wait until it has stopped, so what is measured is where it landed. */
const settled = (page: import('@playwright/test').Page) =>
  page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        let last = -1;
        let still = 0;
        const tick = () => {
          still = scrollY === last ? still + 1 : 0;
          last = scrollY;
          if (still >= 10) resolve();
          else requestAnimationFrame(tick);
        };
        tick();
      }),
  );

test('a new answer is scrolled to below the top bar, not under it', async ({ page }) => {
  // A slow phone: the layout must hold when the main thread is busy.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await openChat(page);
  for (let i = 0; i < 3; i++) {
    await ask(page, `Is everyone equal under the law? ${i}`);
    await expect(page.locator('article.msg.bot:not(.pending) .cite').nth(i)).toBeVisible({ timeout: 30_000 });
  }
  await settled(page);
  const answer = await box(page, '#log article.msg.bot:last-of-type');
  const bar = await box(page, '[data-slot="app-topbar"]');
  expect(answer.top).toBeGreaterThanOrEqual(bar.bottom - 1);
});

test('scrolling to the end of the thread stops above the dock, not under it', async ({ page }) => {
  await openChat(page);
  for (let i = 0; i < 2; i++) {
    await ask(page, `Is everyone equal under the law? ${i}`);
    await expect(page.locator('article.msg.bot:not(.pending) .cite').nth(i)).toBeVisible({ timeout: 15_000 });
  }
  // What the app does for the "thinking" bubble: scroll its end into view.
  await page.evaluate(() => document.querySelector('#log article:last-of-type')!.scrollIntoView({ block: 'end' }));
  await settled(page);
  const last = await box(page, '#log article:last-of-type');
  expect(last.bottom).toBeLessThanOrEqual((await box(page, '.dock')).top + 1);
});
