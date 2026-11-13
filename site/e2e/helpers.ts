import { expect, type Page } from '@playwright/test';

export const OK_KEY = 'sk_shamwari_mock_ok';

/** Open the chat with a developer key already saved, as a returning tester would. */
export async function openChat(page: Page, key: string | null = OK_KEY) {
  if (key) await page.addInitScript((k) => localStorage.setItem('shamwari.devkey', k), key);
  await page.goto('/lite/');
  await page.waitForSelector('html[data-ready="true"]');
}

export async function ask(page: Page, text: string) {
  await page.locator('#q').fill(text);
  await page.locator('#send').click();
}

/** Open Settings (language, delete history, sign out): in the drawer's foot, so the drawer opens first. */
export async function openAccount(page: Page) {
  if (await page.locator('#settings-dialog[open]').count()) return;
  const open = await page.locator('#chat-sidebar').evaluate((el) => el.matches(':popover-open'));
  if (!open) await openChats(page);
  await page.locator('#open-settings').click();
  await expect(page.locator('#settings-dialog')).toBeVisible();
}

/** Reveal the new-project form in the drawer and make a project. */
export async function makeProject(page: Page, name: string) {
  await openSection(page, 'Projects');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.locator('#project-name').fill(name);
  await page.getByRole('button', { name: 'Create project' }).click();
}

/** Open one section of the drawer (Chat, Projects, Artifacts) from its row at the top. */
export async function openSection(page: Page, name: 'Chat' | 'Projects' | 'Artifacts') {
  await openChats(page);
  await page.locator('.side-primary').getByRole('button', { name }).click();
}

/** Open the drawer that lists the chats kept on this device. */
export async function openChats(page: Page) {
  const open = await page.locator('#chat-sidebar').evaluate((el) => el.matches(':popover-open'));
  if (!open) await page.getByRole('button', { name: /open chats/i }).click();
  // Wait for the drawer to finish sliding in, so what a test measures or clicks is where it will stay.
  await page.waitForFunction(() => {
    const el = document.querySelector('#chat-sidebar') as HTMLElement | null;
    return !!el && document.documentElement.dataset.drawer === 'open' && Math.round(el.getBoundingClientRect().left) === 0;
  });
}

/** Close the drawer (Escape) and wait for it to leave and the page to become reachable again. */
export async function closeChats(page: Page) {
  const open = await page.locator('#chat-sidebar').evaluate((el) => el.matches(':popover-open'));
  if (open) await page.keyboard.press('Escape');
  await page.waitForFunction(() => {
    const main = document.querySelector('[data-slot="app-main"]') as HTMLElement | null;
    const side = document.querySelector('#chat-sidebar') as HTMLElement | null;
    // Done: the page is reachable, and the drawer has left the screen (display: none once its exit has finished).
    return !!main && !main.inert && !document.documentElement.dataset.drawer && !!side && getComputedStyle(side).display === 'none';
  });
}

/** Start a new chat from the drawer's foot (the top bar has no room for it on a small screen). */
export async function newChat(page: Page) {
  await openChats(page);
  await page.locator('#side-new').click();
}

/**
 * Put a question on the device that an earlier version saved under another scope (a picker used to choose it), then
 * reload so the app reads it, as it would after an update.
 */
export async function seedLegacyQuestion(
  page: Page,
  text: string,
  scope: 'personal' | 'community',
  status: 'queued' | 'sent' = 'queued',
) {
  await page.evaluate(
    async ({ text, scope, status }) => {
      const db = await new Promise<IDBDatabase>((ok, no) => {
        const open = indexedDB.open('shamwari-chat');
        open.onsuccess = () => ok(open.result);
        open.onerror = () => no(open.error);
      });
      const thread = {
        id: 'legacy-thread',
        title: text,
        updatedAt: Date.now() + 1000,
        messages: [{ id: 'legacy-q', role: 'user', text, at: Date.now(), scope, status }],
      };
      await new Promise<void>((ok, no) => {
        const tx = db.transaction('threads', 'readwrite');
        tx.objectStore('threads').put(thread);
        tx.oncomplete = () => ok();
        tx.onerror = () => no(tx.error);
      });
      db.close();
    },
    { text, scope, status },
  );
  await page.reload();
  await page.waitForSelector('html[data-ready="true"]');
}

/** Open the chat's "..." menu beside its title (pin, project, delete). */
export async function openChatMenu(page: Page) {
  if (!(await page.locator('#chat-tools').evaluate((el) => el.matches(':popover-open')))) await page.locator('#chat-menu').click();
}

/**
 * The Bundu floor (Mzizi's non-negotiable minimums), measured on the rendered page: body text 17px, nothing
 * readable under 14px, every interactive control a 49px hit region, and 7px between neighbouring controls.
 * Hit regions may touch but never overlap; text links inside a sentence are exempt from the size, as they are
 * in the floor. Returns what is under the floor, so a failure names it.
 * `minHit` is the smallest hit region allowed: 49 by default, 32 only for the density size drawn with a mouse from 64rem.
 */
export async function underTheFloor(page: Page, opts: { minHit?: number } = {}) {
  const minHit = (opts.minHit ?? 49) - 0.1;
  return page.evaluate((minHit) => {
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
      if (!inSentence && (r.width < minHit || r.height < minHit)) out.push(`hit region ${Math.round(r.width)}x${Math.round(r.height)}: ${label(el)}`);
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
  }, minHit);
}
