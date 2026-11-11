import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { ask, openAccount, openChat, openChats } from './helpers';

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
      await openAccount(page);
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

/**
 * The Bundu floor (Mzizi's non-negotiable minimums), measured on the rendered page: body text 17px, nothing
 * readable under 14px, every interactive control a 49px hit region, and 7px between neighbouring controls.
 * Hit regions may touch but never overlap; text links inside a sentence are exempt from the size, as they are
 * in the floor. Returns what is under the floor, so a failure names it.
 */
async function underTheFloor(page: Page) {
  return page.evaluate(() => {
    const seen = (el: Element) => {
      const s = getComputedStyle(el);
      const b = el.getBoundingClientRect();
      // Not hidden, not zero-sized, and on the screen: the skip link is parked off-screen until it is focused.
      const onScreen = b.right > 0 && b.left < innerWidth && b.bottom > 0;
      return s.visibility !== 'hidden' && s.display !== 'none' && b.width > 0 && b.height > 0 && onScreen;
    };
    const label = (el: Element) => `${el.tagName.toLowerCase()}${(el as HTMLElement).id ? '#' + (el as HTMLElement).id : ''} "${(el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 24)}"`;
    const out: string[] = [];

    const body = parseFloat(getComputedStyle(document.body).fontSize);
    if (body < 17) out.push(`body text is ${body}px, the floor is 17px`);

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement;
      if (!el || !n.textContent?.trim() || !seen(el) || el.closest('script, style, noscript, svg')) continue;
      const size = parseFloat(getComputedStyle(el).fontSize);
      if (size < 14) out.push(`text under 14px (${size}px): ${label(el)}`);
    }

    // Only controls a person can actually reach: one covered by an open menu or drawer is not their neighbour.
    const onTop = (el: Element) => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(Math.min(Math.max(r.left + r.width / 2, 0), innerWidth - 1), Math.min(Math.max(r.top + r.height / 2, 0), innerHeight - 1));
      return !!hit && (hit === el || el.contains(hit) || hit.contains(el));
    };
    const controls = [...document.querySelectorAll<HTMLElement>('a[href], button, select, textarea, summary, input:not([type="hidden"])')].filter(seen).filter(onTop);
    for (const el of controls) {
      const r = el.getBoundingClientRect();
      const inSentence = el.tagName === 'A' && !!el.closest('p, li') && getComputedStyle(el).display === 'inline';
      if (!inSentence && (r.width < 48.9 || r.height < 48.9)) out.push(`hit region ${Math.round(r.width)}x${Math.round(r.height)}: ${label(el)}`);
    }
    for (let i = 0; i < controls.length; i++) {
      for (let j = i + 1; j < controls.length; j++) {
        const a = controls[i]!, b = controls[j]!;
        if (a.contains(b) || b.contains(a)) continue;
        const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
        const dx = Math.max(rb.left - ra.right, ra.left - rb.right);
        const dy = Math.max(rb.top - ra.bottom, ra.top - rb.bottom);
        // Neighbours side by side or one above the other: the gap along the axis where they do not overlap.
        const gap = dx > 0 && dy <= 0 ? dx : dy > 0 && dx <= 0 ? dy : Math.max(dx, dy) > 0 ? Math.max(dx, dy) : -1;
        if (gap >= 0 && gap < 6.9) out.push(`controls ${gap.toFixed(1)}px apart (floor 7px): ${label(a)} and ${label(b)}`);
      }
    }
    return out;
  });
}

test('the home screen meets the Bundu floor: 17px body, 14px text, 49px controls, 7px gaps', async ({ page }) => {
  await openChat(page);
  expect(await underTheFloor(page)).toEqual([]);
});

test('an answer with its citation card meets the Bundu floor', async ({ page }) => {
  await openChat(page);
  await ask(page, 'Is everyone equal under the law?');
  await expect(page.locator('.cite-link').first()).toBeVisible();
  expect(await underTheFloor(page)).toEqual([]);
});

test('the account menu and the chats drawer meet the Bundu floor', async ({ page }) => {
  await openChat(page);
  await ask(page, 'Is everyone equal under the law?');
  await expect(page.locator('.cite-link').first()).toBeVisible();
  await page.locator('#new-chat').click(); // a second chat, so the drawer has something to list
  await openAccount(page);
  expect(await underTheFloor(page), 'account menu open').toEqual([]);
  await page.locator('details.account summary').click();
  await openChats(page);
  await expect(page.locator('#history-list button').first()).toBeVisible();
  expect(await underTheFloor(page), 'drawer open').toEqual([]);
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
