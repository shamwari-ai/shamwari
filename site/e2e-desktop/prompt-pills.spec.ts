import { expect, test } from '@playwright/test';
import { openChat } from '../e2e/helpers';

// With a mouse on a desktop the pills are drawn at the density size (32px), still separated by the 7px floor gap.
test('on a desktop the suggested prompts are drawn at the density size with 7px between them', async ({ page }) => {
  await openChat(page);
  const boxes = await page.getByRole('group', { name: 'Suggested prompts' }).getByRole('button').evaluateAll((els) =>
    els.map((e) => {
      const r = e.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, h: r.height };
    }),
  );
  for (const b of boxes) {
    expect(b.h, 'drawn at the density size, not the 49px touch size').toBeGreaterThanOrEqual(32);
    expect(b.h).toBeLessThan(40);
  }
  for (let i = 1; i < boxes.length; i++) {
    const sameRow = Math.abs(boxes[i].top - boxes[i - 1].top) < 1;
    const gap = sameRow ? boxes[i].left - boxes[i - 1].right : boxes[i].top - boxes[i - 1].bottom;
    expect(gap, 'at least the 7px floor gap').toBeGreaterThanOrEqual(7);
  }
});
