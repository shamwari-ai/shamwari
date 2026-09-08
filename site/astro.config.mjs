// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: 'https://shamwari.ai',
  integrations: [react()],

  // Static output, served by Workers static assets — same reasoning as
  // docs.shamwari.ai: no server runtime, so this repo holds no bindings and
  // no secrets, and the page loads fast on the connections most of the
  // audience actually has. @bundu/ui's React primitives (Button, Card, ...)
  // render to static HTML here — no client:* directive is used anywhere,
  // so none of them ship a byte of client JS.
  output: 'static',
  build: { format: 'directory' },

  vite: {
    plugins: [tailwindcss()],
    build: { assetsInlineLimit: 4096 },
  },
});
