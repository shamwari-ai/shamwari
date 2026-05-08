import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://localhost:3001",
    trace: "on-first-retry",
  },
  webServer: {
    command: "npm run preview",
    port: 3001,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      WORKOS_CLIENT_ID: "client_test_e2e",
      WORKOS_API_KEY: "REPLACE_AT_RUNTIME",
      WORKOS_REDIRECT_URI: "http://localhost:3001/callback",
      WORKOS_COOKIE_PASSWORD: "e2e-cookie-password-must-be-at-least-32-characters",
    },
  },
});
