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

test('no chat bubbles: the question and the answer are plain text at the small size; the question is set apart by weight', async ({ page }) => {
  await openChat(page);
  await ask(page, 'Is everyone equal under the law?');
  await expect(page.locator('article.msg.bot:not(.pending) .cite').first()).toBeVisible();
  for (const sel of ['article.msg.user', 'article.msg.bot:not(.pending)']) {
    const st = await page.locator(sel).evaluate((el) => {
      const c = getComputedStyle(el);
      const t = getComputedStyle(el.querySelector('p.text')!);
      return { bg: c.backgroundColor, radius: c.borderTopLeftRadius, border: c.borderTopWidth, pad: c.paddingTop, size: t.fontSize };
    });
    expect(st.bg, `${sel} has no fill`).toBe('rgba(0, 0, 0, 0)');
    expect(st.radius, `${sel} is not rounded`).toBe('0px');
    expect(st.border, `${sel} has no box`).toBe('0px');
    expect(st.pad, `${sel} has no padding`).toBe('0px');
    expect(st.size, `${sel} text is the small size`).toBe('14px');
  }
  const weight = (sel: string) => page.locator(sel).evaluate((el) => Number(getComputedStyle(el.querySelector('p.text')!).fontWeight));
  expect(await weight('article.msg.user')).toBeGreaterThan(await weight('article.msg.bot:not(.pending)'));
});

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
