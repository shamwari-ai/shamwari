import type { Page } from '@playwright/test';

export const OK_KEY = 'sk_shamwari_mock_ok';

/** Open the chat with a developer key already saved, as a returning tester would. */
export async function openChat(page: Page, key: string | null = OK_KEY) {
  if (key) await page.addInitScript((k) => localStorage.setItem('shamwari.devkey', k), key);
  await page.goto('/chat/');
  await page.waitForSelector('html[data-ready="true"]');
}

export async function ask(page: Page, text: string) {
  await page.locator('#q').fill(text);
  await page.locator('#send').click();
}
