import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

const eslintConfig = defineConfig([
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
  },
]);

export default eslintConfig;
