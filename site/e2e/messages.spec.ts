import { expect, test } from '@playwright/test';
import { ask, openChat } from './helpers';

// Messages: plain text with no markdown marks, no chat bubbles, small text, small "thinking", and text (not icon) actions.

test('an answer written in markdown is shown as plain words, with none of its marks', async ({ page }) => {
  await openChat(page);
  await ask(page, 'Show markdown please');
  const text = page.locator('article.msg.bot:not(.pending) p.text');
  await expect(text).toContainText('Your rights');
  const shown = (await text.textContent()) ?? '';
  for (const mark of ['##', '**', '`', '](', '_personal', '> ']) expect(shown, `no "${mark}"`).not.toContain(mark);
  expect(shown).toContain('Section 49 says you have the right to personal liberty. See section 50 and the Constitution (https://www.parlzim.gov.zw/).');
  expect(shown).toContain('(https://www.parlzim.gov.zw/).\n\n- You may ask why you are held');
  expect(shown).toContain('Keep calm.');
});

test('the person\'s own message is a soft rounded bubble at the right; the answer stays plain text with no bubble', async ({ page }) => {
  await openChat(page);
  await ask(page, 'Is everyone equal under the law?');
  await expect(page.locator('article.msg.bot:not(.pending) .cite').first()).toBeVisible();
  const read = (sel: string) =>
    page.locator(sel).evaluate((el) => {
      const c = getComputedStyle(el);
      const t = getComputedStyle(el.querySelector('p.text')!);
      const r = el.getBoundingClientRect();
      const log = document.querySelector('#log')!.getBoundingClientRect();
      return { bg: c.backgroundColor, radius: parseFloat(c.borderTopLeftRadius), border: c.borderTopWidth, pad: c.paddingTop, size: t.fontSize, weight: Number(t.fontWeight), left: r.left - log.left, right: log.right - r.right, width: r.width, logWidth: log.width };
    });
  const user = await read('article.msg.user');
  expect(user.bg, 'a soft tint, not transparent').not.toBe('rgba(0, 0, 0, 0)');
  expect(user.radius, 'rounded').toBeGreaterThanOrEqual(8);
  expect(user.border, 'no border').toBe('0px');
  expect(parseFloat(user.pad), 'the Bundu 14px inset').toBeGreaterThanOrEqual(14);
  expect(user.right, 'right-aligned').toBeLessThanOrEqual(1);
  expect(user.width, 'a short question hugs its words').toBeLessThan(user.logWidth);
  expect(user.weight, 'ordinary weight: the bubble sets it apart, not boldness').toBe(400);
  expect(user.size).toBe('14px');
  const bot = await read('article.msg.bot:not(.pending)');
  expect(bot.bg, 'the answer has no fill').toBe('rgba(0, 0, 0, 0)');
  expect(bot.radius, 'the answer is not rounded').toBe(0);
  expect(bot.border).toBe('0px');
  expect(bot.pad, 'the answer has no padding').toBe('0px');
  expect(bot.size).toBe('14px');
  expect(bot.left, 'the answer starts at the left edge').toBeLessThanOrEqual(1);
});

for (const scheme of ['light', 'dark'] as const) {
  test(`the bubble text reads at 7:1 on its tint (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await openChat(page);
    await ask(page, 'hello');
    const ratio = await page.locator('article.msg.user').evaluate((el) => {
      const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
      const rgb = (css: string) => {
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillStyle = '#000';
        ctx.fillStyle = css;
        ctx.fillRect(0, 0, 1, 1);
        const d = ctx.getImageData(0, 0, 1, 1).data;
        return [d[0], d[1], d[2], d[3] / 255];
      };
      const over = (top: number[], under: number[]) => top.slice(0, 3).map((v, i) => v * top[3] + under[i] * (1 - top[3]));
      let page = [255, 255, 255, 1];
      for (let e: Element | null = el.parentElement; e; e = e.parentElement) {
        const c = rgb(getComputedStyle(e).backgroundColor);
        if (c[3] > 0.5) { page = c; break; }
      }
      const bg = over(rgb(getComputedStyle(el).backgroundColor), page);
      const fg = over(rgb(getComputedStyle(el.querySelector('p.text')!).color), bg);
      const lum = (c: number[]) => {
        const f = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
        return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
      };
      const [hi, lo] = [lum(fg), lum(bg)].sort((x, y) => y - x);
      return (hi + 0.05) / (lo + 0.05);
    });
    expect(ratio).toBeGreaterThanOrEqual(7);
  });
}

test('the thinking text is as small as the floor allows, and muted', async ({ page }) => {
  await openChat(page);
  await ask(page, 'slow answer please'); // held for 3 s
  const thinking = page.locator('article.pending p.text');
  await expect(thinking).toBeVisible();
  const st = await thinking.evaluate((el) => ({ size: getComputedStyle(el).fontSize, colour: getComputedStyle(el).color }));
  expect(st.size).toBe('14px');
  const body = await page.locator('article.msg.user p.text').evaluate((el) => getComputedStyle(el).color);
  expect(st.colour, 'quieter than the messages').not.toBe(body);
});

test('Copy, Share and Save are text buttons, never icons; Share only where the browser can share, and it sends plain words', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.addInitScript(() => {
    (window as unknown as { shared: unknown[] }).shared = [];
    navigator.share = async (d?: ShareData) => void (window as unknown as { shared: unknown[] }).shared.push(d);
  });
  await openChat(page);
  await ask(page, 'Show markdown please');
  const row = page.locator('article.msg.bot:not(.pending) .msg-actions');
  await expect(row.getByRole('button')).toHaveText(['Copy answer', 'Share answer', 'Save answer']);
  await expect(row.locator('svg, img')).toHaveCount(0);
  await row.getByRole('button', { name: 'Share answer' }).click();
  const shared = (await page.evaluate(() => (window as unknown as { shared: { text: string }[] }).shared))[0]!;
  expect(shared.text).toContain('Section 49 says you have the right to personal liberty.');
  expect(shared.text).toContain('Section 49 — Right to personal liberty, Constitution of Zimbabwe Amendment (No. 20) Act 2013');
  expect(shared.text).not.toMatch(/\*\*|##|`/);
  // Copy puts the same plain words on the clipboard.
  await row.getByRole('button', { name: 'Copy answer' }).click();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).not.toMatch(/\*\*|##|`/);
});

test('without a share sheet in the browser, Share is not shown', async ({ page }) => {
  await page.addInitScript(() => {
    // @ts-expect-error removing a browser API for this test
    delete navigator.share;
  });
  await openChat(page);
  await ask(page, 'Is everyone equal under the law?');
  await expect(page.locator('article.msg.bot:not(.pending) .msg-actions .save-answer')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Share answer' })).toHaveCount(0);
});
