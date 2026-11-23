import { expect, test } from '@playwright/test';
import { ask, openChat, underTheFloor } from './helpers';

// The answer view, after a work log: while Shamwari works, a line with Mzizi's sparkle turning in front of what it is doing and
// the seconds so far; once the answer is here, one folded line ("How this was answered") with an icon in front of each step.
// Every step comes from the gateway's own response (render.ts renderSteps), never made up while waiting.

const ANSWER = 'article.msg.bot:not(.pending)';

test('while it works: the sparkle in front of the words, the seconds counting, and the timer kept out of the live region', async ({ page }) => {
  await openChat(page);
  await ask(page, 'slow answer please'); // the mock holds it for 3 s
  const run = page.locator('.pending .run');
  await expect(run).toBeVisible();
  await expect(run.locator('.run-mark svg')).toHaveAttribute('data-icon', 'sparkle');
  await expect(run).toContainText('Shamwari is looking for the answer');
  const [mark, words] = await run.evaluate((el) => [el.querySelector('.run-mark')!, el.querySelector('.run-mark + span')!].map((e) => e.getBoundingClientRect().right));
  expect(mark!, 'the icon is in front').toBeLessThan(words!);
  await expect(run.locator('.run-time')).toHaveText(/^· [1-9]\d*s$/, { timeout: 2500 });
  await expect(run.locator('.run-time')).toHaveAttribute('aria-hidden', 'true');
  await expect(page.locator(`${ANSWER} .cite`).first()).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.pending')).toHaveCount(0);
});

test('once answered: one folded line, and opened it shows the kind of question, the sources found and the model that wrote it', async ({ page }) => {
  await openChat(page);
  await ask(page, 'Is everyone equal under the law?');
  const steps = page.locator(`${ANSWER} .steps`);
  await expect(steps).toBeVisible();
  await expect(steps).not.toHaveAttribute('open', '');
  const summary = steps.locator('summary');
  await expect(summary).toHaveText(/How this was answered/);
  await expect(summary.locator('svg').first()).toHaveAttribute('data-icon', 'list');
  await expect(summary.locator('.chev svg')).toHaveAttribute('data-icon', 'chevron-right');
  // Above the answer's words, as a work log reads.
  const [stepsTop, textTop] = await page.locator(ANSWER).evaluate((el) => [el.querySelector('.steps')!, el.querySelector('.text, .md')!].map((e) => e.getBoundingClientRect().top));
  expect(stepsTop!).toBeLessThan(textTop!);
  // The scope line is a step now, not a line of its own under the answer.
  await expect(page.locator(`${ANSWER} > p.meta`)).toHaveCount(0);

  await summary.click();
  const items = steps.locator('li');
  const cites = await page.locator(`${ANSWER} .cite`).count();
  await expect(items).toHaveText(['Kind of question: General knowledge', `Searched the sources: ${cites} found`, 'Written by workers-ai/mock']);
  await expect(items.locator('svg')).toHaveCount(3);
  expect(await items.locator('svg').evaluateAll((els) => els.map((e) => e.getAttribute('data-icon')))).toEqual(['shield', 'search', 'sparkles']);
  expect(await underTheFloor(page), 'the summary is a full-size target').toEqual([]);
});

test('an answer no model wrote opens its steps by itself and says so', async ({ page }) => {
  await page.route('**/v1/chat/completions', async (r) => {
    const res = await r.fetch();
    const body = await res.json();
    body.shamwari.inference_path = 'extractive';
    delete body.shamwari.model_served;
    await r.fulfill({ response: res, json: body });
  });
  await openChat(page);
  await ask(page, 'Is everyone equal under the law?');
  const steps = page.locator(`${ANSWER} .steps`);
  await expect(steps).toHaveAttribute('open', '');
  await expect(steps.locator('li').last()).toHaveText('Taken from the sources alone. No model wrote it.');
  await expect(steps.locator('li').last().locator('svg')).toHaveAttribute('data-icon', 'book');
  await expect(steps).not.toContainText('Written by');
});
