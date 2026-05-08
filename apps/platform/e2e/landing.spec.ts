/**
 * Landing-page smoke. Verifies the unauthenticated marketing surface
 * renders end-to-end through the Vercel adapter preview.
 */

import { expect, test } from "@playwright/test";

test("landing renders and shows sign-in CTAs", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /Build with Shamwari AI/i }),
  ).toBeVisible();
  // Both the header and hero CTA expose "Sign in"; scope to header.
  await expect(
    page.getByRole("banner").getByRole("link", { name: /^Sign in$/i }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Create an account/i }),
  ).toBeVisible();
});

test("dashboard requires sign-in", async ({ page }) => {
  const response = await page.goto("/dashboard");
  // We expect a redirect chain ending at /sign-in (which itself 302s
  // to AuthKit; without real env we stop at the redirect step).
  expect(response?.status()).toBeLessThan(500);
  expect(page.url()).not.toContain("/dashboard");
});
