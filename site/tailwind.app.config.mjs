// Tailwind for the APP build only (astro.app.config.mjs). It scans the chat's own sources and just the
// @bundu/ui parts the chat frame uses, not the whole library, so the stylesheet stays small for a 2G
// first load (check.mjs holds it to a budget).
import preset from '@bundu/ui/tailwind-preset';

/** @type {import('tailwindcss').Config} */
export default {
  presets: [preset],
  content: [
    './app-src/**/*.{astro,html,ts}',
    './src/chat/**/*.ts',
    './node_modules/@bundu/ui/src/app/{AppShell,TopBarAction,AccountMenu}.astro',
    './node_modules/@bundu/ui/src/Icon.astro',
  ],
};
