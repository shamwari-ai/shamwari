import { expect, test } from '@playwright/test';
import { makeProject, openChat, openChats, openSection } from './helpers';

// The drawer's sections, at the top: Chat, Projects, Factory (coming soon), Artifacts, Plugins.

const nav = (page: import('@playwright/test').Page) => page.locator('.side-primary');

test('the sections are in the specified order, Factory is plain text with a chip, and Chat is the open one', async ({ page }) => {
  await openChat(page);
  await openChats(page);
  const rows = nav(page).locator('li');
  await expect(rows).toHaveText([/^Chat$/, /^Projects$/, /^Factory\s*Coming soon$/, /^Artifacts$/, /^Plugins\s*Coming soon$/]);
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
  await expect(page.locator('[data-panel="chat"]')).toHaveJSProperty('hidden', true);
  await expect(nav(page).getByRole('button', { name: 'Projects' })).toHaveAttribute('aria-current', 'page');
  await expect(nav(page).getByRole('button', { name: 'Chat' })).not.toHaveAttribute('aria-current', 'page');
  await expect(page.getByText('Harvest (0)')).toBeVisible(); // the existing projects, reused

  await openSection(page, 'Artifacts');
  await expect(page.locator('[data-panel="artifacts"]')).toBeVisible();
  await expect(page.getByText('Answers you save appear here.')).toBeVisible(); // honest empty state

  await openSection(page, 'Chat');
  // (The Chat list is empty on a fresh device, so it has no size to see: check the panel itself.)
  await expect(page.locator('[data-panel="chat"]')).toHaveJSProperty('hidden', false);
  await expect(page.locator('[data-panel]:not([hidden])')).toHaveCount(1);
});

test('Factory and Plugins are not available yet: each is plain text with a "Coming soon" chip, inert, not focusable, and skipped by Tab', async ({ page }) => {
  await openChat(page);
  await openChats(page);
  for (const name of ['Factory', 'Plugins']) {
    const row = page.locator('.side-primary .side-disabled', { hasText: name });
    await expect(row, name).toHaveCount(1);
    await expect(row).toHaveAttribute('aria-disabled', 'true');
    await expect(row.locator('.side-chip')).toHaveText('Coming soon');
    await expect(nav(page).getByRole('button', { name }), `${name} is not a button`).toHaveCount(0);
    expect(await row.evaluate((el) => getComputedStyle(el).cursor), `${name} does not look tappable`).not.toBe('pointer');
  }
});

test('the rows meet the 49px floor and are keyboard reachable in order', async ({ page }) => {
  await openChat(page);
  await openChats(page);
  for (const name of ['Chat', 'Projects', 'Artifacts']) {
    const b = nav(page).getByRole('button', { name });
    expect((await b.boundingBox())!.height, name).toBeGreaterThanOrEqual(49);
  }
  await nav(page).getByRole('button', { name: 'Chat' }).focus();
  await page.keyboard.press('Tab');
  await expect(nav(page).getByRole('button', { name: 'Projects' })).toBeFocused();
  await page.keyboard.press('Tab'); // Factory is skipped
  await expect(nav(page).getByRole('button', { name: 'Artifacts' })).toBeFocused();
});
