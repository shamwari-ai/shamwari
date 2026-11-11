import { expect, test } from '@playwright/test';
import { makeProject, openChat, openChats, openSection } from './helpers';

// The drawer's sections, at the top: Chat, Projects, Factory (coming soon), Artifacts, Plugins.

const nav = (page: import('@playwright/test').Page) => page.locator('.side-primary');

test('the sections are in the specified order, Factory is plain text with a chip, and Chat is the open one', async ({ page }) => {
  await openChat(page);
  await openChats(page);
  const rows = nav(page).locator('li');
  await expect(rows).toHaveText([/^Chat$/, /^Projects$/, /^Factory\s*Coming soon$/, /^Artifacts$/, /^Plugins$/]);
  await expect(nav(page)).toHaveAttribute('aria-label', 'Sections');
  // Every row has one decorative icon from the Mzizi set.
  for (const li of await rows.all()) {
    const svg = li.locator('svg').first();
    await expect(svg).toHaveAttribute('aria-hidden', 'true');
    await expect(svg).toHaveAttribute('data-icon', /.+/);
  }
  await expect(nav(page).getByRole('button', { name: 'Chat' })).toHaveAttribute('aria-current', 'page');
  // Factory is not a link or a button, is not focusable, and says so.
  const factory = rows.nth(2).locator('.side-row');
  await expect(factory).toHaveAttribute('aria-disabled', 'true');
  expect(await factory.evaluate((el) => el.tagName.toLowerCase())).toBe('span');
  expect(await factory.evaluate((el) => el.tabIndex)).toBe(-1);
  await expect(nav(page).getByRole('link', { name: /Factory/ })).toHaveCount(0);
  await expect(nav(page).getByRole('button', { name: /Factory/ })).toHaveCount(0);
});

test('each section opens its own list, aria-current follows, and the other lists are hidden', async ({ page }) => {
  await openChat(page);
  await makeProject(page, 'Harvest'); // opens Projects
  await expect(page.locator('[data-panel="projects"]')).toBeVisible();
  await expect(page.locator('[data-panel="chat"]')).toBeHidden();
  await expect(nav(page).getByRole('button', { name: 'Projects' })).toHaveAttribute('aria-current', 'page');
  await expect(nav(page).getByRole('button', { name: 'Chat' })).not.toHaveAttribute('aria-current', 'page');
  await expect(page.getByText('Harvest (0)')).toBeVisible(); // the existing projects, reused

  await openSection(page, 'Artifacts');
  await expect(page.locator('[data-panel="artifacts"]')).toBeVisible();
  await expect(page.getByText('Answers you save appear here.')).toBeVisible(); // honest empty state

  await openSection(page, 'Chat');
  await expect(page.locator('[data-panel="chat"]')).toBeVisible();
  await expect(page.locator('[data-panel]:visible')).toHaveCount(1);
});

test('Plugins is an honest shell: three tabs, nothing behind them, and the third-party note; its script loads only then', async ({ page }) => {
  const scripts: string[] = [];
  page.on('request', (r) => {
    if (r.url().endsWith('.js')) scripts.push(r.url());
  });
  await openChat(page);
  expect(scripts.some((u) => /\/plugins\./.test(u)), 'not loaded with the chat').toBe(false);
  await openSection(page, 'Plugins');
  await expect.poll(() => scripts.some((u) => /\/plugins\./.test(u))).toBe(true);
  const tabs = page.getByRole('tab');
  await expect(tabs).toHaveText(['Plugins', 'Skills', 'MCP']);
  await expect(page.getByText('No plugins yet.')).toBeVisible();
  await expect(page.getByText('A plugin or an MCP server would be run by someone else')).toBeVisible();
  // Arrow keys move between tabs (one tab in the tab order), and each says honestly there is nothing.
  await tabs.first().focus();
  await page.keyboard.press('ArrowRight');
  await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('No skills yet.')).toBeVisible();
  await page.keyboard.press('End');
  await expect(tabs.nth(2)).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('No MCP servers are connected.')).toBeVisible();
  // No network request is made by opening any of it.
  const requests: string[] = [];
  page.on('request', (r) => requests.push(r.url()));
  await tabs.first().click();
  await tabs.nth(2).click();
  expect(requests).toEqual([]);
});

test('the rows meet the 49px floor and are keyboard reachable in order', async ({ page }) => {
  await openChat(page);
  await openChats(page);
  for (const name of ['Chat', 'Projects', 'Artifacts', 'Plugins']) {
    const b = nav(page).getByRole('button', { name });
    expect((await b.boundingBox())!.height, name).toBeGreaterThanOrEqual(49);
  }
  await nav(page).getByRole('button', { name: 'Chat' }).focus();
  await page.keyboard.press('Tab');
  await expect(nav(page).getByRole('button', { name: 'Projects' })).toBeFocused();
  await page.keyboard.press('Tab'); // Factory is skipped
  await expect(nav(page).getByRole('button', { name: 'Artifacts' })).toBeFocused();
});
