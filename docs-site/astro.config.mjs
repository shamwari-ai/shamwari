// @ts-check
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';

export default defineConfig({
  site: 'https://docs.shamwari.ai',
  integrations: [mdx()],

  // Static output, served by Workers static assets. No server runtime, so
  // this repo holds no bindings and no secrets — anyone in the org can push
  // a typo fix without touching a repo that can deploy inference.
  output: 'static',
  build: { format: 'directory' },

  // The audience is assumed to be on a slow connection and a small screen.
  // Inlining the stylesheet removes a round trip; there is no client JS to
  // ship, so nothing here needs hydration.
  vite: { build: { assetsInlineLimit: 4096 } },
});
