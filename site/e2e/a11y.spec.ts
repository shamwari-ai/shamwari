import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { openChatMenu, ask, makeProject, newChat, openAccount, openChat, openChats, seedLegacyQuestion, openSection, closeChats, underTheFloor } from './helpers';

// PW_CPU_THROTTLE=4 runs every test here on a CPU four times slower, to flush out timing races (animations, async renders)
// that a quick machine hides. Off by default.
test.beforeEach(async ({ page }) => {
  const rate = Number(process.env.PW_CPU_THROTTLE ?? 0);
  if (rate > 1) await (await page.context().newCDPSession(page)).send('Emulation.setCPUThrottlingRate', { rate });
});

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
      await seedLegacyQuestion(page, 'How much do I earn?', 'personal');
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
      await closeChats(page); // the page behind an open drawer is inert; the draft note is read with the drawer closed
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

test('Settings and the chats drawer meet the Bundu floor', async ({ page }) => {
  await openChat(page);
  await ask(page, 'Is everyone equal under the law?');
  await expect(page.locator('.cite-link').first()).toBeVisible();
  await newChat(page); // a second chat, so the drawer has something to list
  await openAccount(page);
  expect(await underTheFloor(page), 'settings open').toEqual([]);
  await page.keyboard.press('Escape'); // Settings is a modal: Esc closes it (and the drawer it came from is already closed)
  await openChats(page);
  await expect(page.locator('#history-list button.chat-row').first()).toBeVisible();
  expect(await underTheFloor(page), 'drawer open').toEqual([]);
});

test('the drawer with a project, a pinned chat and a saved answer meets the Bundu floor', async ({ page }) => {
  await openChat(page);
  await ask(page, 'Is everyone equal under the law?');
  await expect(page.locator('.cite-link').first()).toBeVisible();
  await page.getByRole('button', { name: 'Save answer' }).click();
  await openChats(page);
  await makeProject(page, 'Know my rights');
  await page.keyboard.press('Escape');
  await openChatMenu(page);
  await page.locator('#chat-project').selectOption({ label: 'Know my rights' });
  await openChatMenu(page);
  await page.locator('#pin-chat').click();
  await expect(page.locator('#chat-tools')).toBeVisible();
  expect(await underTheFloor(page), 'chat tools').toEqual([]);
  await openSection(page, 'Projects');
  await page.locator('#project-list summary').click();
  expect(await underTheFloor(page), 'drawer with a project open').toEqual([]);
  // Every other section of the drawer is held to the same floor.
  for (const name of ['Chat', 'Artifacts'] as const) {
    await openSection(page, name);
    expect(await underTheFloor(page), `drawer: ${name}`).toEqual([]);
  }
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

// The same floor on the other screens people have: a very small phone, a large phone, a tablet and a desktop
// (where the drawer is a permanent column). A long unbroken word must wrap, not widen the page.
for (const [name, width, height] of [['320px phone', 320, 568], ['390px phone', 390, 844], ['768px tablet', 768, 1024], ['1280px desktop', 1280, 800]] as const) {
  test(`the page layout holds at ${name}: no overflow, 14px edges, 7px between blocks, text wraps`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await openChat(page);
    expect(await underTheFloor(page), `${name}: home`).toEqual([]);
    await ask(page, 'x'.repeat(140));
    await expect(page.locator('.cite-link').first()).toBeVisible();
    expect(await underTheFloor(page), `${name}: a long word and its answer`).toEqual([]);
    if (width < 1024) {
      // Every section of the drawer is held to the floor, not just the one it opens on.
      for (const section of ['Chat', 'Projects', 'Artifacts'] as const) {
        await openSection(page, section);
        expect(await underTheFloor(page), `${name}: drawer, ${section}`).toEqual([]);
      }
      // ... and with Settings open, which scrolls the column: the head and the first row must still be 7px apart.
      await openSection(page, 'Chat');
      await openAccount(page);
      expect(await underTheFloor(page), `${name}: drawer, settings open`).toEqual([]);
    }
  });
}

// Text at 200% (the largest a person can ask a browser for): nothing may overflow the screen or the drawer, and the
// drawer's rows stay reachable, on the narrowest phone and on the one we test with.
test.describe('200% text', () => {
  // The page's policy refuses an injected stylesheet, so this group (and only this group) runs with the policy bypassed
  // to apply the larger text; nothing else about the page changes.
  test.use({ bypassCSP: true });
for (const [name, width, height] of [['320px phone', 320, 568], ['360px phone', 360, 640]] as const) {
  test(`at 200% text on a ${name} the drawer and the home screen still meet the floor`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.addInitScript(() => {
      const style = document.createElement('style');
      style.textContent = 'html { font-size: 200% !important; }';
      document.addEventListener('DOMContentLoaded', () => document.head.append(style));
    });
    await openChat(page);
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize), 'the 200% really applies').toBe('32px');
    expect(await underTheFloor(page), `${name} at 200%: home`).toEqual([]);
    for (const section of ['Chat', 'Projects', 'Artifacts'] as const) {
      await openSection(page, section);
      expect(await underTheFloor(page), `${name} at 200%: drawer, ${section}`).toEqual([]);
    }
    await openSection(page, 'Chat');
    await openAccount(page);
    expect(await underTheFloor(page), `${name} at 200%: drawer, settings open`).toEqual([]);
  });
}
});

test('a drawer row scrolled up under the head is measured where it is visible, at any scroll position', async ({ page }) => {
  await openChat(page);
  await newChat(page);
  await openAccount(page); // Settings open makes the column tall enough to scroll that far
  // Park the column so the Projects row's rectangle starts 6px under the drawer head, whatever the scroll position was.
  await page.evaluate(() => {
    const chats = document.querySelector('.chats') as HTMLElement;
    const head = document.querySelector('[data-slot="app-sidebar"] button')!.getBoundingClientRect().bottom;
    const row = [...chats.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Projects')!;
    chats.style.scrollBehavior = 'auto';
    chats.scrollTop += row.getBoundingClientRect().top - (head + 6);
  });
  expect(await underTheFloor(page), 'a row 6px under the head').toEqual([]);
});

// The same floors in dark. Dark used to be a no-op (the page stayed light), so none of this was ever measured in it.
test('the floor holds in dark: the home screen, every drawer section and Settings', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await openChat(page);
  expect(await underTheFloor(page), 'dark: home').toEqual([]);
  for (const section of ['Chat', 'Projects', 'Artifacts'] as const) {
    await openSection(page, section);
    expect(await underTheFloor(page), `dark: drawer, ${section}`).toEqual([]);
  }
  await openSection(page, 'Chat');
  await openAccount(page);
  expect(await underTheFloor(page), 'dark: drawer, settings open').toEqual([]);
});
