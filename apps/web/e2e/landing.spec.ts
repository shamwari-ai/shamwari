/**
 * shamwari.ai landing smoke — hero, FAQ, footer cross-links.
 */

import { expect, test } from "@playwright/test";

test("hero renders with primary CTA", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /open-source AI built for Africa/i }),
  ).toBeVisible();
  await expect(
    page.getByRole("banner").getByRole("link", { name: /Try Shamwari/i }),
  ).toBeVisible();
});

test("docs index lists quickstart link", async ({ page }) => {
  await page.goto("/docs");
  await expect(page.getByRole("heading", { name: /Quickstart/i })).toBeVisible();
});

test("robots.txt allows AI crawlers", async ({ request }) => {
  const r = await request.get("/robots.txt");
  expect(r.status()).toBe(200);
  const text = await r.text();
  expect(text).toContain("User-agent: GPTBot");
  expect(text).toContain("User-agent: ClaudeBot");
});
