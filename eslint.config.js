import js from "@eslint/js"
import prettier from "eslint-config-prettier"
import reactHooks from "eslint-plugin-react-hooks"
import reactRefresh from "eslint-plugin-react-refresh"
import globals from "globals"
import tseslint from "typescript-eslint"

// One configuration for the workspace; each package's `lint` script runs ESLint over its own files.
export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/coverage/**",
      "packages/contract/vendor/**",
      "**/generated/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Destructuring a field away to keep the rest is how an object loses a field here.
    rules: { "@typescript-eslint/no-unused-vars": ["error", { ignoreRestSiblings: true }] },
  },
  {
    files: ["apps/web/src/**/*.{ts,tsx}"],
    languageOptions: { ecmaVersion: 2023, globals: globals.browser },
    plugins: { "react-hooks": reactHooks, "react-refresh": reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
    },
  },
  {
    // Plain browser scripts served as files (the pre-paint theme script).
    files: ["apps/web/public/**/*.js"],
    languageOptions: { sourceType: "script", globals: globals.browser },
  },
  {
    // Node tooling: scripts, tests of scripts, and configuration files.
    files: ["**/scripts/**/*.{js,mjs,ts}", "**/test/**/*.ts", "**/*.config.{js,ts}"],
    languageOptions: { globals: globals.node },
  },
  prettier,
)
