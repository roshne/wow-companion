import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import prettier from "eslint-config-prettier";

// Flat config. `src/vendor/**` is generated/vendored and is never linted.
export default tseslint.config(
  { ignores: ["dist", "node_modules", "src/vendor", "src-tauri"] },

  js.configs.recommended,
  tseslint.configs.recommended,

  // Application source (browser runtime).
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: globals.browser,
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },

  // Build/config/script files that run under Node (vite.config.ts, this file,
  // scripts/*).
  {
    files: ["*.{js,ts}", "scripts/**/*.{js,mjs,cjs,ts}"],
    languageOptions: { globals: globals.node },
  },

  // Keep ESLint out of Prettier's lane; must stay last.
  prettier,
);
