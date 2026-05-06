import adapter from "@sveltejs/adapter-vercel";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter(),
    alias: {
      "@shamwari/ui": "../../packages/ui/src",
      "@shamwari/ui/*": "../../packages/ui/src/*",
    },
  },
};

export default config;
