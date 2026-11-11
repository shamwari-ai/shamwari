// @ts-check
// The APP: Shamwari Chat, the light edge chat, served by the `shamwari-app` Worker at https://shamwari.ai/lite/.
// Built from app-src/ (only the chat page) with app-public/ (only the chat's own
// assets), so no marketing page can end up in it. The marketing site is
// astro.config.mjs and the `shamwari-site` Worker on https://www.shamwari.ai.
//
// No React here: the chat is plain TypeScript (see docs/chat-app.md), which is what keeps the first load
// small. Its frame is Mzizi's AppShell (the standard app chrome), so Tailwind compiles that frame's CSS.
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: 'https://shamwari.ai',
  srcDir: './app-src',
  publicDir: './app-public',
  output: 'static',
  // Tailwind compiles to one static stylesheet at build time (nothing runs on the phone). It is here because
  // Mzizi's AppShell and its parts are Tailwind-classed; the chat's own code stays plain TypeScript.
  // Nothing is inlined into the page: the page's content-security policy allows scripts and styles only from
  // its own origin, and Mzizi's AppShell carries a small script that Astro would otherwise inline.
  build: { format: 'directory', inlineStylesheets: 'never' },
  vite: { plugins: [tailwindcss()], build: { assetsInlineLimit: 0 } },
});
