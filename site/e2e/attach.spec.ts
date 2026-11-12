import { expect, test, type Page } from '@playwright/test';
import { openChat } from './helpers';

// Attachments, phase 1: a file or a voice note is kept ON THIS DEVICE and goes nowhere. Adding one makes no network request, and
// what is sent with the question is its text and nothing about the attachment.

const MOCK = 'http://127.0.0.1:8788';

/** Every request the page makes from now on. */
const watch = (page: Page) => {
  const seen: { method: string; url: string; body: string }[] = [];
  // The app's own script files (the attachments code loads on first use, from the service worker's cache) are not "requests about the
  // attachment": everything else is.
  page.on('request', (r) => !new URL(r.url()).pathname.startsWith('/lite/_astro/') && seen.push({ method: r.method(), url: r.url(), body: r.postData() ?? '' }));
  return seen;
};

/** The attachments code loads on the first tap of "+" or the microphone. */
const load = async (page: Page) => {
  await page.locator('#plus').click();
  await expect(page.locator('#plus-menu')).toBeVisible();
  await page.locator('#plus-menu').press('Escape');
  await expect(page.locator('#plus-menu')).toBeHidden();
};

const file = (name: string, text: string) => ({ name, mimeType: 'text/plain', buffer: Buffer.from(text) });

test('"+" opens a menu with Upload a file (no skills entry yet); a chosen file waits as a chip that says it is not sent', async ({ page }) => {
  await openChat(page);
  await load(page);
  const seen = watch(page);
  await page.locator('#plus').click();
  await expect(page.locator('#plus-menu')).toBeVisible();
  await expect(page.locator('#plus-menu button')).toHaveText(['Upload a file']); // Skills has nothing in it, so no entry
  await page.locator('#plus-menu').press('Escape');
  await page.locator('#file-input').setInputFiles(file('notes-for-my-case.txt', 'SECRET-FILE-CONTENT'));
  const chip = page.locator('#attach-list .attach-chip');
  await expect(chip).toContainText('notes-for-my-case.txt');
  await expect(chip).toContainText('Kept on this device. Not sent.');
  await chip.getByRole('button', { name: /Remove/ }).click();
  await expect(page.locator('#attach-list')).toBeHidden();
  expect(seen, 'adding and removing a file makes no request').toEqual([]);
});

test('a question sent with a file keeps the file on the device and sends only its text', async ({ page }) => {
  await openChat(page);
  await load(page);
  const seen = watch(page);
  await page.locator('#file-input').setInputFiles(file('notes-for-my-case.txt', 'SECRET-FILE-CONTENT'));
  await page.locator('#q').fill('Is it legal to be searched?');
  await page.locator('#send').click();
  await expect(page.locator('article.msg.bot:not(.pending) .cite').first()).toBeVisible();
  const posts = seen.filter((r) => r.method === 'POST');
  expect(posts.length).toBeGreaterThan(0);
  for (const r of posts) {
    expect(r.url.startsWith(MOCK)).toBe(true);
    expect(r.body).not.toContain('notes-for-my-case');
    expect(r.body).not.toContain('SECRET-FILE-CONTENT');
  }
  expect(seen.filter((r) => !r.url.startsWith(MOCK) && !r.url.startsWith('http://127.0.0.1')), 'nothing left the origin and the API').toEqual([]);
  // The sent question shows it, and the pending list is empty again.
  const kept = page.locator('article.msg.user .attach-chip');
  await expect(kept).toContainText('notes-for-my-case.txt');
  await expect(kept).toContainText('Kept on this device. Not sent.');
  await expect(page.locator('#attach-list')).toBeHidden();
  // It is in IndexedDB, and survives a reload.
  const stored = await page.evaluate(
    () =>
      new Promise<{ name: string; size: number; text: string }[]>((ok, no) => {
        const open = indexedDB.open('shamwari-chat');
        open.onerror = () => no(open.error);
        open.onsuccess = () => {
          const all = open.result.transaction('files').objectStore('files').getAll();
          all.onsuccess = async () => ok(await Promise.all((all.result as { name: string; size: number; blob: Blob }[]).map(async (f) => ({ name: f.name, size: f.size, text: await f.blob.text() }))));
        };
      }),
  );
  expect(stored).toEqual([{ name: 'notes-for-my-case.txt', size: 19, text: 'SECRET-FILE-CONTENT' }]);
  await page.reload();
  await page.waitForSelector('html[data-ready="true"]');
  await expect(page.locator('article.msg.user .attach-chip')).toContainText('notes-for-my-case.txt');
  // A copy can be saved from the device.
  const download = page.waitForEvent('download');
  await page.locator('article.msg.user').getByRole('button', { name: /Save a copy/ }).click();
  expect((await download).suggestedFilename()).toBe('notes-for-my-case.txt');
});

test('a file over 10 MB, or a fifth file, is refused with a plain message', async ({ page }) => {
  await openChat(page);
  await load(page);
  await page.locator('#file-input').setInputFiles({ name: 'big.bin', mimeType: 'application/octet-stream', buffer: Buffer.alloc(10 * 1024 * 1024 + 1) });
  await expect(page.locator('#toast')).toHaveText('That file is over 10 MB. Choose a smaller one.');
  await expect(page.locator('#attach-list')).toBeHidden();
  await page.locator('#file-input').setInputFiles([1, 2, 3, 4, 5].map((n) => file(`f${n}.txt`, `x${n}`)));
  await expect(page.locator('#attach-list .attach-chip')).toHaveCount(4);
  await expect(page.locator('#toast')).toHaveText('You can add up to 4 files to a question.');
});

test('the microphone records a voice note that is kept here, with no request and no transcription', async ({ page, context }) => {
  await context.grantPermissions(['microphone']);
  await page.addInitScript(() => {
    // A silent stream, so a recording works without a real microphone.
    navigator.mediaDevices.getUserMedia = async () => new AudioContext().createMediaStreamDestination().stream;
  });
  await openChat(page);
  const seen = watch(page);
  await expect(page.locator('#mic')).toBeVisible();
  await page.locator('#mic').click();
  await expect(page.locator('#mic')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#mic')).toHaveAccessibleName('Stop recording');
  await expect(page.locator('#attach-list [role="status"]')).toHaveText('Recording…');
  await page.waitForTimeout(600);
  await page.locator('#mic').click();
  await expect(page.locator('#attach-list .attach-chip')).toContainText('Voice note');
  await expect(page.locator('#attach-list .attach-chip')).toContainText('Kept on this device. Not sent.');
  expect(seen, 'recording makes no request').toEqual([]);
  await page.locator('#q').fill('Is it legal to be searched?');
  await page.locator('#send').click();
  await expect(page.locator('article.msg.bot:not(.pending) .cite').first()).toBeVisible();
  for (const r of seen.filter((x) => x.method === 'POST')) expect(r.body).not.toContain('Voice note');
  await expect(page.locator('article.msg.user').getByRole('button', { name: /Play/ })).toBeVisible();
});

test('without a recorder in the browser the microphone button is not shown', async ({ page }) => {
  await page.addInitScript(() => {
    // @ts-expect-error removing a browser API for this test
    delete window.MediaRecorder;
  });
  await openChat(page);
  await expect(page.locator('#mic')).toBeHidden();
  await expect(page.locator('#plus')).toBeVisible();
});

test('what was being added belongs to its chat: starting another chat leaves it behind', async ({ page }) => {
  await openChat(page);
  await load(page);
  await page.locator('#file-input').setInputFiles(file('draft.txt', 'x'));
  await expect(page.locator('#attach-list .attach-chip')).toHaveCount(1);
  await page.evaluate(() => document.querySelector<HTMLButtonElement>('#new-chat button')!.click());
  await expect(page.locator('#attach-list')).toBeHidden();
  await page.locator('#q').fill('Is it legal to be searched?');
  await page.locator('#send').click();
  await expect(page.locator('article.msg.user')).toHaveCount(1);
  await expect(page.locator('article.msg.user .attach-chip')).toHaveCount(0);
});

test('a second tap on the microphone while the permission is pending does not start a second recording', async ({ page, context }) => {
  await context.grantPermissions(['microphone']);
  await page.addInitScript(() => {
    (window as unknown as { calls: number }).calls = 0;
    navigator.mediaDevices.getUserMedia = async () => {
      (window as unknown as { calls: number }).calls += 1;
      await new Promise((r) => setTimeout(r, 400));
      return new AudioContext().createMediaStreamDestination().stream;
    };
  });
  await openChat(page);
  await page.locator('#mic').dblclick();
  await expect(page.locator('#mic')).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => (window as unknown as { calls: number }).calls)).toBe(1);
});
