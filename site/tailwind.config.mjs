// No @ts-check here: @bundu/ui/tailwind-preset has no type declarations for
// that subpath export, and `astro check` (tsconfig includes "**/*") would
// otherwise fail the build on an untyped import from a file we don't
// control.
import preset from '@bundu/ui/tailwind-preset';

/** @type {import('tailwindcss').Config} */
export default {
  presets: [preset],
  content: [
    './src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}',
    // @bundu/ui ships source .astro/.tsx, not pre-built CSS — Tailwind has
    // to scan the library's own source for the utility classes its
    // components use (e.g. Button's arrow glyph, h-4 w-4), or it never
    // generates them and they silently fall back to unstyled defaults.
    './node_modules/@bundu/ui/src/**/*.{astro,tsx,ts}',
  ],
};
