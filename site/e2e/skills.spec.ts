import { expect, test, type Page, type Request } from '@playwright/test';
import { ask, newChat, openChat, openSection, underTheFloor } from './helpers';

// The Skills tab: Agent Skills (agentskills.io) written in a builder, imported and exported as SKILL.md, kept on this
// device, and turned on chat by chat. Rule 1 (AGENTS.md): a personal-scope skill never leaves the device, and a question
// asked with one on goes as `own_information: true` with no skill text, so the gateway answers it from sources only.

const SKILL_MD = (name: string) => `---\nname: ${name}\ndescription: Keep answers short for a small screen. Use for every answer.\n---\n\n# Short\n\nAnswer in three sentences or fewer.\n`;

async function openSkills(page: Page) {
  await openSection(page, 'Plugins');
  await expect(page.getByRole('tab', { name: 'Skills' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#skill-new')).toBeVisible();
}

/** Every chat request the page makes, with its body. */
function chatRequests(page: Page) {
  const seen: Record<string, unknown>[] = [];
  page.on('request', (r: Request) => {
    if (r.url().includes('/v1/chat/completions') && r.method() === 'POST') seen.push(r.postDataJSON() as Record<string, unknown>);
  });
  return seen;
}

async function build(page: Page, name: string, description: string, instructions: string) {
  await page.locator('#skill-new').click();
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel('Description', { exact: true }).fill(description);
  await page.getByLabel('Instructions', { exact: true }).fill(instructions);
  await page.getByRole('button', { name: 'Save skill' }).click();
}

async function importFile(page: Page, text: string, scope?: 'platform') {
  await page.locator('#skill-file').setInputFiles({ name: 'SKILL.md', mimeType: 'text/markdown', buffer: Buffer.from(text) });
  if (scope === 'platform') await page.locator('#skill-scope-platform').check();
}

test('the builder checks the fields live against the spec, and saves a valid skill on this device', async ({ page }) => {
  await openChat(page);
  await openSkills(page);
  await page.locator('#skill-new').click();
  await expect(page.locator('#skill-new')).toHaveAttribute('aria-expanded', 'true');
  const name = page.getByLabel('Name', { exact: true });
  await expect(name).toBeFocused();
  // Nothing is shouted at an empty form; a field says what is wrong once it has been typed in.
  await expect(page.locator('#skill-name-err')).toBeHidden();
  await name.fill('Bad Name');
  await expect(page.locator('#skill-name-err')).toHaveText(/Use lowercase letters\..*Use only letters, numbers and hyphens\./);
  await expect(name).toHaveAttribute('aria-invalid', 'true');
  await expect(name).toHaveAttribute('aria-describedby', 'skill-name-hint skill-name-err');
  await name.fill('a'.repeat(65));
  await expect(page.locator('#skill-name-err')).toHaveText('65 characters. The most is 64.');
  await name.fill('-x');
  await expect(page.locator('#skill-name-err')).toHaveText('Do not start or end with a hyphen, or put two together.');
  await name.fill('short-answers');
  await expect(page.locator('#skill-name-err')).toBeHidden();
  await expect(name).not.toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#skill-description-count')).toHaveText('0 / 1024');

  // Save with the description missing: focus goes to it and it says why; nothing is saved.
  await page.getByRole('button', { name: 'Save skill' }).click();
  await expect(page.getByLabel('Description', { exact: true })).toBeFocused();
  await expect(page.locator('#skill-description-err')).toHaveText('This is needed.');
  await page.getByLabel('Description', { exact: true }).fill('Keep answers short. Use for every answer.');
  await page.getByLabel('Instructions', { exact: true }).fill('Answer in three sentences or fewer.');
  await page.getByRole('button', { name: 'Save skill' }).click();
  await expect(page.locator('#toast')).toHaveText('Skill saved on this device.');
  const item = page.locator('.skill-item', { hasText: 'short-answers' });
  await expect(item).toBeVisible();
  await expect(item.locator('.side-chip')).toHaveText('Personal');
  await expect(item.getByRole('switch', { name: 'On in this chat: short-answers' })).toBeFocused();

  // Same name again: refused.
  await page.locator('#skill-new').click();
  await page.getByLabel('Name', { exact: true }).fill('short-answers');
  await expect(page.locator('#skill-name-err')).toHaveText('You already have a skill with this name.');
  await page.getByRole('button', { name: 'Cancel' }).click();

  // Kept on this device: still there after a reload.
  await page.reload();
  await page.waitForSelector('html[data-ready="true"]');
  await openSkills(page);
  await expect(page.locator('.skill-item', { hasText: 'short-answers' })).toBeVisible();
});

test('RULE 1: with a personal skill on, the question goes as own_information and no skill text leaves the device', async ({ page }) => {
  const sent = chatRequests(page);
  await openChat(page);
  await openSkills(page);
  await build(page, 'my-farm', 'Facts about my farm. Use for farming questions.', 'My farm is 4 hectares near Masvingo. SECRET-FARM-DETAIL');
  await page.getByRole('switch', { name: 'On in this chat: my-farm' }).click();
  await expect(page.getByRole('switch', { name: 'On in this chat: my-farm' })).toHaveAttribute('aria-checked', 'true');
  // The question box says what a personal skill means for the answer.
  await expect(page.locator('#skills-note')).toBeVisible();
  await expect(page.locator('#skills-note')).toContainText('answers come from cited sources only');

  await page.keyboard.press('Escape');
  await ask(page, 'When should I plant maize?');
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0]).toMatchObject({ own_information: true, scope: 'platform' });
  expect(sent[0]).not.toHaveProperty('skills');
  expect(JSON.stringify(sent[0])).not.toContain('SECRET-FARM-DETAIL');
  expect(JSON.stringify(sent[0])).not.toContain('my-farm');

  // Turned off: the next question is an ordinary one, and the personal question is not carried as its context.
  await openSkills(page);
  await page.getByRole('switch', { name: 'On in this chat: my-farm' }).click();
  await expect(page.locator('#skills-note')).toBeHidden();
  await page.keyboard.press('Escape');
  await ask(page, 'What is the news on maize prices?');
  await expect.poll(() => sent.length).toBe(2);
  expect(sent[1]).not.toHaveProperty('own_information');
  const context = JSON.stringify((sent[1] as { messages: unknown[] }).messages);
  expect(context).not.toContain('When should I plant maize?');
});

test('a skill is on per chat: a new chat starts with none on', async ({ page }) => {
  const sent = chatRequests(page);
  await openChat(page);
  await openSkills(page);
  await build(page, 'short-answers', 'Keep answers short. Use for every answer.', 'Three sentences.');
  await page.getByRole('switch', { name: 'On in this chat: short-answers' }).click();
  await page.keyboard.press('Escape');
  await ask(page, 'first question');
  await expect.poll(() => sent.length).toBe(1);
  await newChat(page);
  await expect(page.locator('#skills-note')).toBeHidden();
  await ask(page, 'second question');
  await expect.poll(() => sent.length).toBe(2);
  expect(sent[0]).toMatchObject({ own_information: true });
  expect(sent[1]).not.toHaveProperty('own_information');
});

test('an imported SKILL.md is personal unless the person chooses otherwise; a general one is sent with the question', async ({ page }) => {
  const sent = chatRequests(page);
  await openChat(page);
  await openSkills(page);
  await page.locator('#skill-import').click(); // the button opens the file chooser; the file is set directly below
  await importFile(page, SKILL_MD('short-answers'));
  await expect(page.locator('#skill-form-title')).toHaveText('Import a SKILL.md');
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('short-answers');
  await expect(page.locator('#skill-scope-personal')).toBeChecked(); // the default
  await page.locator('#skill-scope-platform').check();
  await page.getByRole('button', { name: 'Save skill' }).click();
  const item = page.locator('.skill-item', { hasText: 'short-answers' });
  await expect(item.locator('.side-chip')).toHaveText('General');
  await item.getByRole('switch').click();
  await expect(page.locator('#skills-note')).toHaveText('Skills on in this chat: 1.');
  await page.keyboard.press('Escape');
  await ask(page, 'When should I plant maize?');
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0]).not.toHaveProperty('own_information');
  expect(sent[0]).toMatchObject({
    skills: [{ name: 'short-answers', description: 'Keep answers short for a small screen. Use for every answer.', instructions: '# Short\n\nAnswer in three sentences or fewer.' }],
  });
});

test('a file that is not a SKILL.md is refused with the reason; one with fixable problems opens in the form', async ({ page }) => {
  await openChat(page);
  await openSkills(page);
  await importFile(page, '# Just some notes\n');
  await expect(page.locator('#skill-file-error')).toHaveText(/needs a header between two --- lines/);
  await expect(page.locator('#skill-form')).toBeHidden();
  // An uppercase name and an unknown field: shown in the form, and saving leaves the unknown field out.
  await importFile(page, '---\nname: Short-Answers\ndescription: Keep it short.\nversion: 2\n---\nThree sentences.\n');
  await expect(page.locator('#skill-form-error')).toHaveText(/field the standard does not allow: version/);
  await expect(page.locator('#skill-name-err')).toHaveText('Use lowercase letters.');
  await page.getByLabel('Name', { exact: true }).fill('short-answers');
  await page.getByRole('button', { name: 'Save skill' }).click();
  await expect(page.locator('.skill-item', { hasText: 'short-answers' })).toBeVisible();
});

test('edit, export as SKILL.md, and delete', async ({ page }) => {
  await openChat(page);
  await openSkills(page);
  await build(page, 'short-answers', 'Keep answers short.', 'Three sentences.');
  const item = page.locator('.skill-item', { hasText: 'short-answers' });
  await item.getByRole('button', { name: 'Edit: short-answers' }).click();
  await expect(page.locator('#skill-form-title')).toHaveText('Edit');
  await expect(page.locator('#skill-scope')).toBeHidden(); // a personal skill is personal; scope is chosen only at import
  await page.getByLabel('Description', { exact: true }).fill('Keep answers short. Use for every answer.');
  await page.getByRole('button', { name: 'Save skill' }).click();
  await expect(item).toContainText('Keep answers short. Use for every answer.');

  const download = page.waitForEvent('download');
  await item.getByRole('button', { name: 'Export: short-answers' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('SKILL.md');
  const text = await (await import('node:fs/promises')).readFile((await file.path())!, 'utf8');
  expect(text).toBe('---\nname: short-answers\ndescription: "Keep answers short. Use for every answer."\n---\n\nThree sentences.\n');

  page.once('dialog', (d) => void d.accept());
  await item.getByRole('button', { name: 'Delete: short-answers' }).click();
  await expect(item).toHaveCount(0);
  await expect(page.getByText('No skills yet. Write one, or import a SKILL.md file.')).toBeVisible();
});

test('the Skills tab meets the Bundu floor: the list, and the builder open with an error showing', async ({ page }) => {
  await openChat(page);
  await openSkills(page);
  await build(page, 'short-answers', 'Keep answers short.', 'Three sentences.');
  expect(await underTheFloor(page), 'skills: list').toEqual([]);
  await page.locator('#skill-import').click();
  await importFile(page, SKILL_MD('Bad'));
  await expect(page.locator('#skill-name-err')).toBeVisible();
  expect(await underTheFloor(page), 'skills: import form with an error').toEqual([]);
});
