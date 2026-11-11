import { expect, test, type Page } from '@playwright/test';
import { ask, openChat, openChats } from './helpers';

// The shell never scrolls. Exactly two regions do: the messages (#thread) and the drawer's column (.chats: sections,
// list and foot together). The top bar, the composer with its divider, and the drawer's head stay where they are.

const rect = (page: Page, sel: string) =>
  page.evaluate((s) => {
    const r = document.querySelector(s)!.getBoundingClientRect();
    return { top: Math.round(r.top), bottom: Math.round(r.bottom) };
  }, sel);

const scrollTops = (page: Page) =>
  page.evaluate(() => ({
    doc: document.scrollingElement!.scrollTop,
    main: (document.querySelector('[data-slot="app-main"]') as HTMLElement).scrollTop,
    thread: (document.querySelector('#thread') as HTMLElement).scrollTop,
    side: (document.querySelector('.chats') as HTMLElement | null)?.scrollTop ?? 0,
  }));

/** The page scrolls smoothly: wait until the given scroller has stopped. */
const settled = (page: Page, sel: string) =>
  page.evaluate(
    (s) =>
      new Promise<void>((resolve) => {
        const el = document.querySelector(s) as HTMLElement;
        let last = -1;
        let still = 0;
        const tick = () => {
          still = el.scrollTop === last ? still + 1 : 0;
          last = el.scrollTop;
          if (still >= 10) resolve();
          else requestAnimationFrame(tick);
        };
        tick();
      }),
    sel,
  );

async function fillThread(page: Page, n = 3, long = false) {
  for (let i = 0; i < n; i++) {
    await ask(page, long ? `Is everyone equal under the law? ${'a very long question '.repeat(120)}${i}` : `Is everyone equal under the law? ${i}`);
    await expect(page.locator('article.msg.bot:not(.pending) .cite').nth(i)).toBeVisible({ timeout: 30_000 });
  }
}

test('the shell never scrolls: the document, the app area, the top bar and the composer stay put when the shell is wheeled', async ({ page }) => {
  await openChat(page);
  await fillThread(page);
  const bar = await rect(page, '[data-slot="app-topbar"]');
  const dock = await rect(page, '.dock');
  // Wheel over the top bar, over the composer, and over the middle of the page.
  for (const sel of ['[data-slot="app-topbar"]', '.dock', '#thread']) {
    const box = (await page.locator(sel).first().boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, 4000);
  }
  await page.waitForTimeout(300);
  const tops = await scrollTops(page);
  expect(tops.doc).toBe(0);
  expect(tops.main).toBe(0);
  expect(await rect(page, '[data-slot="app-topbar"]')).toEqual(bar);
  expect(await rect(page, '.dock')).toEqual(dock);
});

test('the messages scroll, and the end of the list does not chain to the page', async ({ page }) => {
  await openChat(page);
  await fillThread(page, 4);
  const thread = (await page.locator('#thread').boundingBox())!;
  await page.mouse.move(thread.x + thread.width / 2, thread.y + thread.height / 2);
  await page.mouse.wheel(0, 100000);
  await settled(page, '#thread');
  const tops = await scrollTops(page);
  expect(tops.thread).toBeGreaterThan(0);
  // Wheel again at the very end: nothing leaks to the document or the app area.
  await page.mouse.wheel(0, 3000);
  await page.waitForTimeout(300);
  const after = await scrollTops(page);
  expect(after.doc).toBe(0);
  expect(after.main).toBe(0);
  expect(await rect(page, '[data-slot="app-topbar"]')).toMatchObject({ top: 0 });
});

test('a new answer and the thinking bubble land inside the messages, between the bars', async ({ page }) => {
  const cdp = await page.context().newCDPSession(page); // a slow phone: the layout must hold when the main thread is busy
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await openChat(page);
  await fillThread(page, 3);
  await settled(page, '#thread');
  const thread = await rect(page, '#thread');
  const bar = await rect(page, '[data-slot="app-topbar"]');
  const dock = await rect(page, '.dock');
  const answer = await rect(page, '#log article.msg.bot:last-of-type');
  // Inside the messages, below the top bar, and not flush against either edge (the Bundu floor is 7px).
  expect(answer.top).toBeGreaterThanOrEqual(thread.top + 6);
  expect(answer.top).toBeGreaterThanOrEqual(bar.bottom - 1);
  // What the app does for the thinking bubble: scroll the end of the last message into view.
  await page.evaluate(() => document.querySelector('#log article:last-of-type')!.scrollIntoView({ block: 'end' }));
  await settled(page, '#thread');
  const last = await rect(page, '#log article:last-of-type');
  expect(last.bottom).toBeLessThanOrEqual(thread.bottom + 1);
  expect(last.bottom).toBeLessThanOrEqual(dock.top + 1);
});

test('a very long message scrolls inside the messages and moves nothing else', async ({ page }) => {
  await openChat(page);
  await fillThread(page, 1, true);
  const tops = await scrollTops(page);
  expect(tops.doc).toBe(0);
  expect(tops.main).toBe(0);
  const dock = await rect(page, '.dock');
  expect(dock.bottom).toBeLessThanOrEqual(page.viewportSize()!.height);
});

test('in landscape the shell still does not scroll', async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 360 });
  await openChat(page);
  await fillThread(page, 2);
  await page.mouse.move(320, 150);
  await page.mouse.wheel(0, 4000);
  await page.waitForTimeout(300);
  const tops = await scrollTops(page);
  expect(tops.doc).toBe(0);
  expect(tops.main).toBe(0);
  const dock = await rect(page, '.dock');
  expect(dock.bottom).toBeLessThanOrEqual(360);
  // The messages are not squeezed away by what is around them.
  const thread = await rect(page, '#thread');
  expect(thread.bottom - thread.top).toBeGreaterThanOrEqual(96);
});

test('focusing a control never scrolls the shell off its place', async ({ page }) => {
  await openChat(page);
  await fillThread(page, 2);
  const bar = await rect(page, '[data-slot="app-topbar"]');
  // Every focusable thing in the page, one after the other: none of them may move the app area or the document.
  for (const sel of ['#q', '#send', '#new-chat button', '#thread', 'a.skip']) {
    await page.locator(sel).first().focus();
    const tops = await scrollTops(page);
    expect(tops.doc, sel).toBe(0);
    expect(tops.main, sel).toBe(0);
  }
  expect(await rect(page, '[data-slot="app-topbar"]')).toEqual(bar);
  // A script cannot move it either (the regions that must not scroll are clipped, not merely hidden).
  const moved = await page.evaluate(() => {
    const main = document.querySelector('[data-slot="app-main"]') as HTMLElement;
    main.scrollTop = 500;
    return main.scrollTop;
  });
  expect(moved).toBe(0);
});

test('the drawer: its column scrolls (sections, list and foot together), the foot is reachable at the end, and the end does not scroll the page behind', async ({ page }) => {
  await openChat(page);
  await openChats(page);
  // Forty chats, written straight into the list: this is a layout test, not a storage test.
  await page.evaluate(() => {
    const list = document.querySelector('#history-list')!;
    for (let i = 0; i < 40; i++) {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.className = 'btn link';
      b.textContent = `Earlier chat number ${i}`;
      li.append(b);
      list.append(li);
    }
    (document.querySelector('#side-chats') as HTMLElement).hidden = false;
  });
  const head = await rect(page, '[data-slot="sidebar-head"]');
  const scroller = (await page.locator('.chats').boundingBox())!;
  await page.mouse.move(scroller.x + scroller.width / 2, scroller.y + scroller.height / 2);
  await page.mouse.wheel(0, 100000);
  await settled(page, '.chats');
  const tops = await scrollTops(page);
  expect(tops.side).toBeGreaterThan(0);
  expect(await rect(page, '[data-slot="sidebar-head"]'), 'the drawer\'s head stays where it is').toEqual(head);
  // At the end of the column the last foot row is inside the drawer: Settings can always be reached.
  const reach = await page.evaluate(() => {
    const col = document.querySelector('.chats')!.getBoundingClientRect();
    const last = document.querySelector('.side-foot')!.getBoundingClientRect();
    return { colBottom: col.bottom, footBottom: last.bottom };
  });
  expect(reach.footBottom).toBeLessThanOrEqual(reach.colBottom + 1);
  // At the end of the list, more wheel does not reach the page behind the drawer.
  await page.mouse.wheel(0, 4000);
  await page.waitForTimeout(300);
  const after = await scrollTops(page);
  expect(after.doc).toBe(0);
  expect(after.main).toBe(0);
  expect(after.thread).toBe(0);
});
