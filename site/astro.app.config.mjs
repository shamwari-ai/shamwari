// @ts-check
// The APP: Shamwari Chat, served by the `shamwari-app` Worker at https://shamwari.ai/chat/.
// Built from app-src/ (only the chat page) with app-public/ (only the chat's own
// assets), so no marketing page can end up in it. The marketing site is
// astro.config.mjs and the `shamwari-site` Worker on https://www.shamwari.ai.
//
// No React and no Tailwind here: the chat is plain TypeScript and plain CSS
// (see docs/chat-app.md), which is also what keeps the first load small.
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://shamwari.ai',
  srcDir: './app-src',
  publicDir: './app-public',
  output: 'static',
  build: { format: 'directory' },
  vite: { build: { assetsInlineLimit: 4096 } },
});
