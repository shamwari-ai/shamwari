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

/** Open one section of the drawer (Chat, Projects, Artifacts, Plugins) from its row at the top. */
export async function openSection(page: Page, name: 'Chat' | 'Projects' | 'Artifacts' | 'Plugins') {
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
