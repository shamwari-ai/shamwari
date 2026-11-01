import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { ask, openChat } from './helpers';

const scan = async (page: Page) =>
  (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']).analyze()).violations;

const summary = (v: Awaited<ReturnType<typeof scan>>) => v.map((x) => `${x.id}: ${x.nodes.map((n) => n.target.join(' ')).join(' | ')}`);

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`axe, ${scheme}`, () => {
    test.use({ colorScheme: scheme });

    test('empty state has no violations', async ({ page }) => {
      await openChat(page);
      expect(summary(await scan(page))).toEqual([]);
    });

    test('answer with citation cards has no violations', async ({ page }) => {
      await openChat(page);
      await ask(page, 'Is everyone equal under the law?');
      await expect(page.locator('.cite').first()).toBeVisible();
      expect(summary(await scan(page))).toEqual([]);
    });

    test('personal-scope explanation and an error have no violations', async ({ page }) => {
      await openChat(page);
      await page.getByLabel('Asking about').selectOption('personal');
      await ask(page, 'How much do I earn?');
      await expect(page.locator('article.refusal')).toBeVisible();
      expect(summary(await scan(page))).toEqual([]);
    });

    test('sign-in panel has no violations', async ({ page }) => {
      await openChat(page, null);
      await expect(page.locator('#auth')).toBeVisible();
      expect(summary(await scan(page))).toEqual([]);
    });

    test('Shona (draft) with its review note has no violations', async ({ page }) => {
      await openChat(page);
      await page.locator('#lang').selectOption('sn');
      await expect(page.locator('#review')).toBeVisible();
      expect(summary(await scan(page))).toEqual([]);
    });
  });
}

test('an error is announced as an alert, an answer in the polite log, an offline queue as a status', async ({ page, context }) => {
  await openChat(page, 'sk_shamwari_mock_402');
  await ask(page, 'hello');
  await expect(page.locator('article.error [role="alert"]')).toBeVisible();

  await openChat(page);
  await context.setOffline(true);
  await ask(page, 'queued');
  await expect(page.locator('article.queued [role="status"]')).toBeVisible();
});

test('every control is at least 48 px, by 48 px', async ({ page }) => {
  await openChat(page);
  await ask(page, 'Is everyone equal under the law?');
  await expect(page.locator('.cite-link').first()).toBeVisible();
  await page.getByText('Settings').click();
  const small = await page.evaluate(() => {
    const out: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>('button, select, summary, textarea, .cite-link, input:not([type="hidden"])')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue; // hidden
      if (r.height < 47.5 || r.width < 47.5) out.push(`${el.tagName.toLowerCase()}#${el.id || el.textContent?.trim().slice(0, 20)} ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    return out;
  });
  expect(small).toEqual([]);
});

test('works with the keyboard alone and keeps a visible focus ring', async ({ page }) => {
  await openChat(page);
  await page.keyboard.press('Tab'); // skip link
  await expect(page.getByRole('link', { name: 'Skip to the question box' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#q')).toBeFocused();
  const outline = await page.locator('#q').evaluate((el) => getComputedStyle(el).outlineStyle + ' ' + getComputedStyle(el).outlineWidth);
  expect(outline).toMatch(/solid 2px/);
});

test('reduced motion: nothing animates while waiting for an answer', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openChat(page);
  await ask(page, 'slow answer please');
  const dots = page.locator('.pending .dots');
  await expect(dots).toBeVisible();
  expect(await dots.evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
});

test('weak network: the answer still arrives and the slow hint appears', async ({ page }) => {
  await openChat(page);
  await ask(page, 'slow answer please'); // the mock holds it for 3 s
  await expect(page.locator('.pending')).toBeVisible();
  await expect(page.locator('article.msg.bot .cite').first()).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.pending')).toHaveCount(0);
});
