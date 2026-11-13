import { expect, test } from '@playwright/test';
import { openAccount, openChat } from './helpers';

// A quiet line on the empty screen: "Answers can be wrong · Privacy". One tap reaches the disclaimer and privacy page (it used to be two
// taps deep, in Settings). It is not a legal-advice line: Shamwari is a general-purpose assistant (#267, #244 row 4).

test('the empty screen says answers can be wrong and Privacy is one tap from the disclaimer and privacy page', async ({ page }) => {
  await openChat(page);
  const line = page.locator('#empty .trust');
  await expect(line).toBeVisible();
  await expect(line).toContainText('Answers can be wrong');
  await expect(line).not.toContainText(/legal/i);
  const link = line.getByRole('link', { name: 'Privacy' });
  await expect(link).toHaveText('Privacy');
  const box = await link.boundingBox();
  expect(box!.height, 'a 49px hit region on touch').toBeGreaterThanOrEqual(49);
  await link.click();
  await expect(page).toHaveURL(/\/lite\/disclaimer\/$/);
});

test('the line goes once a conversation starts, and Settings still holds the same link', async ({ page }) => {
  await openChat(page);
  await page.locator('#q').fill('hello');
  await page.locator('#q').press('Enter');
  await expect(page.locator('article.msg.bot').first()).toBeVisible();
  await expect(page.locator('#empty .trust')).toBeHidden();
  await openAccount(page);
  await expect(page.getByRole('link', { name: 'Disclaimer and privacy' })).toBeVisible();
});

test('in Shona the line is Shona', async ({ page }) => {
  await openChat(page);
  await openAccount(page);
  await page.getByRole('radio', { name: 'ChiShona' }).check();
  await page.keyboard.press('Escape');
  await expect(page.locator('#empty .trust')).toContainText('Mhinduro dzinogona kukanganisa');
});

for (const scheme of ['light', 'dark'] as const) {
  test(`the line reaches 7:1 and does not crowd the prompts, at 320px (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width: 320, height: 640 });
    await openChat(page);
    const ratio = await page.evaluate(() => {
      const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
      const rgb = (css: string) => {
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillStyle = '#000';
        ctx.fillStyle = css;
        ctx.fillRect(0, 0, 1, 1);
        const d = ctx.getImageData(0, 0, 1, 1).data;
        return [d[0], d[1], d[2], d[3] / 255];
      };
      const bgOf = (el: Element | null): number[] => {
        while (el) {
          const c = rgb(getComputedStyle(el).backgroundColor);
          if (c[3] > 0.5) return c;
          el = el.parentElement;
        }
        return [255, 255, 255, 1];
      };
      const lum = (c: number[]) => {
        const f = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
        return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
      };
      const el = document.querySelector('#empty .trust')!;
      const a = lum(rgb(getComputedStyle(el).color));
      const b = lum(bgOf(el));
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    });
    expect(ratio).toBeGreaterThanOrEqual(7);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
    const font = await page.locator('#empty .trust').evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(font, 'the Bundu floor: 14px minimum text').toBeGreaterThanOrEqual(14);
  });
}
