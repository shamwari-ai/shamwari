import { defineConfig, devices } from '@playwright/test';

// The e2e build points the app at the gateway mock (chat-mock/server.mjs). The
// API origin is fixed at build time on purpose, so this is a separate build
// from the production one in dist/.
const MOCK = 'http://127.0.0.1:8788';
const SITE = 'http://127.0.0.1:4322';
// The same app built with the Mukoko sign-in flag ON (PUBLIC_CHAT_AUTH=mukoko), served with a stand-in for the session Worker.
const SITE_MUKOKO = 'http://127.0.0.1:4323';
// Its own mock gateway, so the credentials it records are only this project's.
const MOCK_MUKOKO = 'http://127.0.0.1:8789';

export default defineConfig({
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
    { name: 'small-android', testDir: 'e2e', use: { ...devices['Pixel 5'], viewport: { width: 360, height: 640 } } },
    {
      name: 'mukoko-auth',
      testDir: 'e2e-auth',
      fullyParallel: false, // one stub session, one mock log: these tests take turns
      use: { ...devices['Pixel 5'], viewport: { width: 360, height: 640 }, baseURL: SITE_MUKOKO },
    },
  ],
  webServer: [
    { command: 'node chat-mock/server.mjs 8788', url: `${MOCK}/health`, reuseExistingServer: !process.env.CI },
    { command: 'node chat-mock/server.mjs 8789', env: { MOCK_RECORD: '1' }, url: `${MOCK_MUKOKO}/health`, reuseExistingServer: !process.env.CI },
    {
      // Both builds happen one after the other (they share Astro's cache), then both servers start.
      command:
        `export PUBLIC_SHAMWARI_API=${MOCK} && ` +
        'npx astro build --outDir dist-e2e && node scripts/post-build.mjs dist-e2e && ' +
        `PUBLIC_SHAMWARI_API=${MOCK_MUKOKO} PUBLIC_CHAT_AUTH=mukoko npx astro build --outDir dist-e2e-mukoko && PUBLIC_SHAMWARI_API=${MOCK_MUKOKO} node scripts/post-build.mjs dist-e2e-mukoko && ` +
        '(node e2e/serve.mjs 4323 dist-e2e-mukoko --stub-auth & node e2e/serve.mjs 4322 dist-e2e & wait)',
      url: `${SITE}/chat/`,
      timeout: 180_000,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
