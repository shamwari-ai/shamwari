// @ts-check
// The APP: Shamwari Chat, the light edge chat, served by the `shamwari-app` Worker at https://shamwari.ai/lite/.
// Built from app-src/ (only the chat page) with app-public/ (only the chat's own
// assets), so no marketing page can end up in it. The marketing site is
// astro.config.mjs and the `shamwari-site` Worker on https://www.shamwari.ai.
//
// No React here: the chat is plain TypeScript (see docs/chat-app.md), which is what keeps the first load
// small. Its frame is plain HTML and plain CSS on Mzizi's tokens (src/chat/tokens.css): no Tailwind (issue #329).
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://shamwari.ai',
  srcDir: './app-src',
  publicDir: './app-public',
  output: 'static',
  // Nothing is inlined into the page: the page's content-security policy allows scripts and styles only from
  // its own origin.
  // The build output goes under /lite/_astro/, not /_astro/: the session cookie is scoped to /lite/ (worker/session.ts), so
  // a script anywhere else would be gated but never sent the cookie, and the page would load with no JavaScript.
  build: { format: 'directory', inlineStylesheets: 'never', assets: 'lite/_astro' },
  vite: { build: { assetsInlineLimit: 0 } },
});
