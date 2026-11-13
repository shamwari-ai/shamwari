import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { openChatMenu, ask, makeProject, newChat, openAccount, openChat, openChats, seedLegacyQuestion, openSection, closeChats } from './helpers';

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
      await page.getByRole('radio', { name: 'ChiShona' }).check();
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
      // An inert subtree (the page behind an open drawer) cannot be reached, so it is nobody's neighbour.
      return s.visibility !== 'hidden' && s.display !== 'none' && b.width > 0 && b.height > 0 && onScreen && !el.closest('[inert]');
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
    // Every probe point (the centre and the four corners, inset 2px) must land on the control itself: one that an
    // open menu or drawer covers even in part is not a neighbour of what is on top of it.
    const onTop = (el: Element) => {
      const r = el.getBoundingClientRect();
      const clamp = (v: number, max: number) => Math.min(Math.max(v, 0), max - 1);
      const points: [number, number][] = [
        [r.left + r.width / 2, r.top + r.height / 2],
        [r.left + 2, r.top + 2],
        [r.right - 2, r.top + 2],
        [r.left + 2, r.bottom - 2],
        [r.right - 2, r.bottom - 2],
      ];
      return points.every(([x, y]) => {
        const hit = document.elementFromPoint(clamp(x, innerWidth), clamp(y, innerHeight));
        return !!hit && (hit === el || el.contains(hit) || hit.contains(el));
      });
    };
    const controls = [...document.querySelectorAll<HTMLElement>('a[href], button, select, textarea, summary, input:not([type="hidden"])')].filter(seen).filter(onTop);
    for (const el of controls) {
      const r = el.getBoundingClientRect();
      const inSentence = el.tagName === 'A' && !!el.closest('p, li') && getComputedStyle(el).display === 'inline';
      if (!inSentence && (r.width < 48.9 || r.height < 48.9)) out.push(`hit region ${Math.round(r.width)}x${Math.round(r.height)}: ${label(el)}`);
    }
    // A control scrolled partly out of its column is only there where the column shows it: its neighbours are measured
    // from that visible part, not from the part hidden under the drawer's head. (Without this, a row scrolled so its
    // rectangle sits 6px under the head, mostly hidden, was reported as 6px from the head.)
    const shown = (el: Element) => {
      let r = el.getBoundingClientRect();
      let left = r.left, top = r.top, right = r.right, bottom = r.bottom;
      for (let p = el.parentElement; p; p = p.parentElement) {
        const s = getComputedStyle(p);
        if (s.overflowX === 'visible' && s.overflowY === 'visible') continue;
        const c = p.getBoundingClientRect();
        left = Math.max(left, c.left); top = Math.max(top, c.top); right = Math.min(right, c.right); bottom = Math.min(bottom, c.bottom);
      }
      return { left, top, right, bottom };
    };
    for (let i = 0; i < controls.length; i++) {
      for (let j = i + 1; j < controls.length; j++) {
        const a = controls[i]!, b = controls[j]!;
        if (a.contains(b) || b.contains(a)) continue;
        const ra = shown(a), rb = shown(b);
        if (ra.right <= ra.left || ra.bottom <= ra.top || rb.right <= rb.left || rb.bottom <= rb.top) continue; // scrolled out entirely
        const dx = Math.max(rb.left - ra.right, ra.left - rb.right);
        const dy = Math.max(rb.top - ra.bottom, ra.top - rb.bottom);
        if (dx < 0 && dy < 0) {
          // The rectangles share area: the floor allows hit regions to touch, never to overlap.
          out.push(`controls overlap: ${label(a)} and ${label(b)}`);
          continue;
        }
        // Neighbours side by side or one above the other: the gap along the axis where they do not overlap.
        const gap = Math.max(dx, dy);
        if (gap >= 0 && gap < 6.9) out.push(`controls ${gap.toFixed(1)}px apart (floor 7px): ${label(a)} and ${label(b)}`);
      }
    }

    // ---- the page layout: no overflow, 14px from the edges, 7px between neighbouring blocks -------------------------
    const slack = 0.6;
    if (document.documentElement.scrollWidth > innerWidth + slack) {
      out.push(`the page scrolls sideways: ${document.documentElement.scrollWidth}px wide in a ${innerWidth}px screen`);
    }
    // Text is measured where it is drawn (its line boxes), controls by their hit region. Parked, clipped and
    // screen-reader-only things are not on the page for anyone's eyes.
    const hiddenAway = (el: Element) => !!el.closest('[hidden], .sr-only, .skip, [aria-hidden="true"], svg, script, style, noscript');
    const insetFloor = 14;
    const edge = (what: string, el: Element, left: number, right: number) => {
      if (left < -slack || right > innerWidth + slack) out.push(`overflows the screen (${Math.round(left)}..${Math.round(right)} of ${innerWidth}px): ${what} ${label(el)}`);
      else if (left < insetFloor - slack || right > innerWidth - insetFloor + slack) out.push(`closer than 14px to the edge (${Math.round(left)}..${Math.round(right)} of ${innerWidth}px): ${what} ${label(el)}`);
    };
    for (const el of controls) {
      const r = el.getBoundingClientRect();
      // The menu button and the drawer's close button sit in the top bar's own inset: Mzizi's AppShell draws that.
      edge('control', el, r.left, r.right);
    }
    const walker2 = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker2.nextNode(); n; n = walker2.nextNode()) {
      const el = n.parentElement;
      if (!el || !n.textContent?.trim() || !seen(el) || hiddenAway(el) || !onTop(el)) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      for (const r of range.getClientRects()) {
        if (r.width === 0) continue;
        // Text cut by its own box or a scrolling ancestor (a long chat title with an ellipsis) is measured where it is
        // drawn, not where the cut-off part would be.
        let left = r.left, right = r.right;
        for (let p: Element | null = el; p; p = p.parentElement) {
          const st = getComputedStyle(p);
          if (st.overflowX === 'visible') continue;
          const c = p.getBoundingClientRect();
          left = Math.max(left, c.left);
          right = Math.min(right, c.right);
        }
        if (right <= left) continue;
        edge('text', el, left, right);
        break; // one report per text node is enough to name it
      }
    }
    // Blocks that follow each other in the page: 7px between them, never touching or overlapping by accident.
    const flow = (el: Element) => {
      const s = getComputedStyle(el);
      return seen(el) && !hiddenAway(el) && !['fixed', 'absolute'].includes(s.position) && s.display !== 'contents' && s.display !== 'inline';
    };
    for (const a of document.querySelectorAll<HTMLElement>('main *, [data-slot="app-sidebar"] *, body > *')) {
      const b = a.nextElementSibling as HTMLElement | null;
      if (!b || !flow(a) || !flow(b) || !onTop(a) || !onTop(b)) continue;
      const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      const across = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
      // Padding on a plain block (no fill, no border) is space between its content and the next block's.
      const bare = (el: Element) => {
        const c = getComputedStyle(el);
        const transparent = c.backgroundColor === 'rgba(0, 0, 0, 0)' || c.backgroundColor === 'transparent';
        return transparent && ['Top', 'Right', 'Bottom', 'Left'].every((side) => parseFloat(c.getPropertyValue(`border-${side.toLowerCase()}-width`)) === 0);
      };
      const gap = rb.top - ra.bottom + (bare(a) ? parseFloat(getComputedStyle(a).paddingBottom) : 0) + (bare(b) ? parseFloat(getComputedStyle(b).paddingTop) : 0);
      if (across > 1 && gap > -0.5 && gap < 6.9) out.push(`blocks ${gap.toFixed(1)}px apart (floor 7px): ${label(a)} and ${label(b)}`);
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
