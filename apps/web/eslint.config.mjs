import js from "@eslint/js";
import svelte from "eslint-plugin-svelte";
import tseslint from "typescript-eslint";
import globals from "globals";

export default [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...svelte.configs["flat/recommended"],
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  },
  {
    files: ["**/*.svelte"],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
      },
    },
    rules: {
      // resolve()-based href is good practice but not required for our
      // marketing routes — most of which point at static known paths.
      "svelte/no-navigation-without-resolve": "off",
      // Many of our {#each} blocks iterate over fixed config arrays where
      // a key would be redundant; turn from error into warn.
      "svelte/require-each-key": "warn",
    },
  },
  {
    ignores: [".svelte-kit/", "build/", "node_modules/", ".vercel/"],
  },
];
