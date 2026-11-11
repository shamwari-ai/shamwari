import type { Page } from '@playwright/test';

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
  const open = await page.locator('#chat-sidebar').evaluate((el) => el.matches(':popover-open'));
  if (!open) await openChats(page);
  const menu = page.locator('details.account');
  if ((await menu.getAttribute('open')) === null) await menu.locator('summary').click();
}

/** Reveal the new-project form in the drawer and make a project. */
export async function makeProject(page: Page, name: string) {
  await page.getByRole('button', { name: 'New project' }).click();
  await page.locator('#project-name').fill(name);
  await page.getByRole('button', { name: 'Create project' }).click();
}

/** Open the drawer that lists the chats kept on this device. */
export async function openChats(page: Page) {
  const open = await page.locator('#chat-sidebar').evaluate((el) => el.matches(':popover-open'));
  if (!open) await page.getByRole('button', { name: /open chats/i }).click();
}

/** Start a new chat from the drawer's foot (the top bar has no room for it on a small screen). */
export async function newChat(page: Page) {
  await openChats(page);
  await page.locator('#side-new').click();
}
