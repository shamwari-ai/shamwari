import { expect, test } from '@playwright/test';
import { ask, openChat } from './helpers';

// First run: one line on the empty screen, "English / ChiShona / isiNdebele", shown once and remembered (#244 row 1). Settings keeps the
// radio group. A language already chosen (or a first question already asked) means it never shows again.

const row = (page: import('@playwright/test').Page) => page.locator('#empty').getByRole('group', { name: 'Language' });

test('a first visit offers the three languages on the empty screen, each a 49px button, with no sideways scroll at 320px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await openChat(page);
  await expect(row(page)).toBeVisible();
  const buttons = row(page).getByRole('button');
  await expect(buttons).toHaveText(['English', 'ChiShona', 'isiNdebele']);
  for (const b of await buttons.all()) {
    const box = await b.boundingBox();
    expect(box!.height, 'a 49px hit region on touch').toBeGreaterThanOrEqual(49);
    expect(box!.x + box!.width).toBeLessThanOrEqual(320);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});

test('tapping a language switches the whole screen, is remembered, and the line does not come back', async ({ page }) => {
  await openChat(page);
  await row(page).getByRole('button', { name: 'ChiShona' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'sn');
  await expect(page.locator('#send')).toHaveText('Tumira');
  await expect(row(page)).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem('shamwari.lang'))).toBe('sn');
  await page.reload();
  await page.waitForSelector('html[data-ready="true"]');
  await expect(page.locator('html')).toHaveAttribute('lang', 'sn');
  await expect(page.locator('#empty .first-lang')).toBeHidden();
  // Settings still has the radio group, with the choice in it.
  await expect(page.locator('#lang input[value="sn"]')).toBeChecked();
});

test('choosing English is a choice too: it is remembered and the line goes', async ({ page }) => {
  await openChat(page);
  await row(page).getByRole('button', { name: 'English' }).click();
  await expect(row(page)).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem('shamwari.lang'))).toBe('en');
});

test('a person who already chose a language in Settings never sees the line', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('shamwari.lang', 'nd'));
  await openChat(page);
  await expect(page.locator('#empty .first-lang')).toBeHidden();
  await expect(page.locator('html')).toHaveAttribute('lang', 'nd');
});

test('asking a first question without choosing counts as an answer: the line is gone next time', async ({ page }) => {
  await openChat(page);
  await expect(row(page)).toBeVisible();
  await ask(page, 'hello');
  await expect(page.locator('article.msg.bot').first()).toBeVisible();
  await page.reload();
  await page.waitForSelector('html[data-ready="true"]');
  await expect(page.locator('#empty .first-lang')).toBeHidden();
});

// The service worker would answer from its cache and hide the failure, so this one runs without it.
test.describe('words that cannot load', () => {
  test.use({ serviceWorkers: 'block' });
test('if the words of a language cannot be loaded, the line stays so the person can try again', async ({ page }) => {
  await openChat(page, undefined, { settle: false }); // service workers are blocked here: none will control the page
  await page.route('**/strings-sn*', (r) => r.abort());
  await row(page).getByRole('button', { name: 'ChiShona' }).click();
  await expect(page.locator('#toast')).toContainText('could not be loaded');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(row(page)).toBeVisible();
});
});

for (const scheme of ['light', 'dark'] as const) {
  test(`the line sits clear of the greeting and the prompts (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await openChat(page);
    const rects = await page.evaluate(() => {
      const r = (s: string) => document.querySelector(s)!.getBoundingClientRect();
      return { lead: r('#empty .lead'), line: r('#empty .first-lang'), try: r('#empty .try') };
    });
    expect(rects.line.top).toBeGreaterThanOrEqual(rects.lead.bottom);
    expect(rects.try.top).toBeGreaterThanOrEqual(rects.line.bottom);
  });
}
