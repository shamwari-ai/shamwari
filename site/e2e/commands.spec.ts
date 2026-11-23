import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type Request } from '@playwright/test';
import { ask, closeChats, openChat, openSection, underTheFloor } from './helpers';

// The command menu (issue #329): Ctrl/Cmd+K opens a palette, "/" at the start of the question box opens the same commands
// above it, and the mode chip in the prompt box opens the skills. Every command is an action the chat already had.

const chatRequests = (page: Page) => {
  const seen: Record<string, unknown>[] = [];
  page.on('request', (r: Request) => {
    if (r.url().includes('/v1/chat/completions') && r.method() === 'POST') seen.push(r.postDataJSON() as Record<string, unknown>);
  });
  return seen;
};

async function personalSkill(page: Page, name: string, instructions: string) {
  await openSection(page, 'Plugins');
  await page.locator('#skill-new').click();
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel('Description', { exact: true }).fill('Facts about my farm. Use for questions about it.');
  await page.getByLabel('Instructions', { exact: true }).fill(instructions);
  await page.getByRole('button', { name: 'Save skill' }).click();
  await expect(page.locator('.skill-item', { hasText: name })).toBeVisible();
  await closeChats(page);
}

test('Ctrl+K opens the palette: it filters as you type, arrows move, Enter runs, Escape closes', async ({ page }) => {
  await openChat(page);
  await page.locator('#q').focus();
  await page.keyboard.press('Control+k');
  const dialog = page.getByRole('dialog', { name: 'Commands' });
  await expect(dialog).toBeVisible();
  const field = page.getByRole('combobox', { name: 'Type a command' });
  await expect(field).toBeFocused();
  await expect(field).toHaveAttribute('aria-controls', 'cmd-list');
  const options = page.locator('#cmd-list [role="option"]');
  expect(await options.count()).toBeGreaterThan(5);
  await expect(options.first()).toHaveAttribute('aria-selected', 'true');
  await field.fill('offline');
  await expect(options).toHaveCount(1);
  await expect(options.first()).toContainText('Offline mode');
  await expect(field).toHaveAttribute('aria-activedescendant', (await options.first().getAttribute('id'))!);
  await page.keyboard.press('Enter');
  await expect(dialog).toBeHidden();
  await expect(page.locator('#offline-mode-note')).toBeVisible(); // the same switch as in Settings
  await page.keyboard.press('Control+k');
  await page.getByRole('combobox', { name: 'Type a command' }).fill('zzzz');
  await expect(page.locator('#cmd-list')).toContainText('No commands match.');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.locator('#q')).toBeFocused(); // focus goes back where it was
});

test('"/" at the start of the question box lists the commands above it; Enter runs one and nothing is sent', async ({ page }) => {
  const sent = chatRequests(page);
  await openChat(page);
  await ask(page, 'Is everyone equal under the law?');
  await expect(page.locator('.cite').first()).toBeVisible();
  await page.locator('#q').fill('/');
  const list = page.getByRole('listbox', { name: 'Commands' });
  await expect(list).toBeVisible();
  await expect(page.locator('#q')).toHaveAttribute('aria-controls', 'slash-list');
  await page.locator('#q').pressSequentially('new');
  await expect(list.getByRole('option').first()).toHaveText('New chat');
  await page.keyboard.press('Enter');
  await expect(list).toBeHidden();
  await expect(page.locator('#q')).toHaveValue('');
  await expect(page.locator('article.msg')).toHaveCount(0); // a new, empty chat
  expect(sent).toHaveLength(1); // only the question asked above
});

test('Escape closes the slash menu and keeps the text; with nothing matching, Enter sends it as a question', async ({ page }) => {
  await openChat(page);
  await page.locator('#q').fill('/');
  await expect(page.locator('#slash-list')).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('#slash-list [role="option"]').nth(1)).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Escape');
  await expect(page.locator('#slash-list')).toBeHidden();
  await expect(page.locator('#q')).toHaveValue('/');
  await page.locator('#q').fill('/24 is half of what?');
  await expect(page.locator('#slash-list')).toContainText('No commands match.');
  await page.keyboard.press('Enter');
  await expect(page.locator('article.msg.user')).toContainText('/24 is half of what?');
});

test('the mode chip says General, turns Personal with a personal skill on from the menu, and Rule 1 holds', async ({ page }) => {
  const sent = chatRequests(page);
  await openChat(page);
  await expect(page.locator('#mode-chip')).toHaveAccessibleName('Kind of question General');
  await personalSkill(page, 'my-farm', 'My farm is 4 hectares near Masvingo; the secret code is LEOPARD.');
  await page.locator('#mode-chip').click();
  const option = page.locator('#cmd-list [role="option"]', { hasText: 'my-farm' });
  await expect(option).toContainText('Personal · Off');
  await option.click();
  await expect(page.locator('#mode-chip')).toHaveAccessibleName('Kind of question Personal');
  await expect(page.locator('#skills-note')).toContainText('A personal skill is on');
  await ask(page, 'How big is my farm?');
  await expect(page.locator('article.msg.user .part')).toContainText('A personal skill is on');
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0]!.own_information).toBe(true);
  expect(sent[0]!.skills).toBeUndefined();
  expect(JSON.stringify(sent[0])).not.toContain('LEOPARD');
  expect(sent[0]!.scope).toBe('platform');
});

test('the theme commands set and clear an explicit theme, kept on this device', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await openChat(page);
  const run = async (name: string) => {
    await page.keyboard.press('Control+k');
    await page.getByRole('combobox', { name: 'Type a command' }).fill(name);
    await page.keyboard.press('Enter');
  };
  await run('Dark theme');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await page.waitForSelector('html[data-ready="true"]');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await run('Theme from this device');
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', /./);
});

test('export writes the open chat to a text file on this device', async ({ page }) => {
  await openChat(page);
  await ask(page, 'Is everyone equal under the law?');
  await expect(page.locator('.cite').first()).toBeVisible();
  await page.keyboard.press('Control+k');
  await page.getByRole('combobox', { name: 'Type a command' }).fill('export');
  const download = page.waitForEvent('download');
  await page.keyboard.press('Enter');
  const file = await download;
  expect(file.suggestedFilename()).toBe('Is-everyone-equal-under-the-law.txt');
  const text = readFileSync(await file.path(), 'utf8');
  expect(text).toContain('You:\nIs everyone equal under the law?');
  expect(text).toContain('Section 56');
});

for (const scheme of ['light', 'dark'] as const) {
  test(`the palette and the slash menu pass axe and the floor (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await openChat(page);
    await page.locator('#q').fill('/');
    await expect(page.locator('#slash-list')).toBeVisible();
    const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];
    expect((await new AxeBuilder({ page }).withTags(tags).analyze()).violations.map((v) => v.id), 'slash menu').toEqual([]);
    expect(await underTheFloor(page), 'slash menu').toEqual([]);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+k');
    await expect(page.locator('dialog.palette')).toBeVisible();
    expect((await new AxeBuilder({ page }).include('dialog.palette').withTags(tags).analyze()).violations.map((v) => v.id), 'palette').toEqual([]);
  });
}
