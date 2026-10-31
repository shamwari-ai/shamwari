import { defineConfig, devices } from '@playwright/test';

// The e2e build points the app at the gateway mock (chat-mock/server.mjs). The
// API origin is fixed at build time on purpose, so this is a separate build
// from the production one in dist/.
const MOCK = 'http://127.0.0.1:8788';
const SITE = 'http://127.0.0.1:4322';

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  // PW_CHROMIUM lets a machine that already has a Chromium (a cloud sandbox
  // whose preinstalled browser predates this Playwright) use it. CI leaves it
  // unset and runs `npx playwright install chromium`.
  use: {
    baseURL: SITE,
    trace: 'retain-on-failure',
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
  },
  projects: [
    // A low-end Android on a small screen is the device this is built for.
    { name: 'small-android', use: { ...devices['Pixel 5'], viewport: { width: 360, height: 640 } } },
  ],
  webServer: [
    { command: 'node chat-mock/server.mjs 8788', url: `${MOCK}/health`, reuseExistingServer: !process.env.CI },
    {
      command: `export PUBLIC_SHAMWARI_API=${MOCK} && npx astro build --outDir dist-e2e && node scripts/post-build.mjs dist-e2e && node e2e/serve.mjs 4322`,
      url: `${SITE}/chat/`,
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
