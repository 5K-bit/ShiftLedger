import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/", "coverage/", "node_modules/", "test-results/", "playwright-report/"] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    rules: {
      "no-console": "error",
      "no-restricted-properties": [
        "error",
        { object: "document", property: "write", message: "Build DOM nodes instead." },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "AssignmentExpression[left.property.name=/^(innerHTML|outerHTML)$/]",
          message: "Never assign HTML strings; use textContent or createElement.",
        },
        {
          selector: "CallExpression[callee.property.name='insertAdjacentHTML']",
          message: "Never insert HTML strings; use createElement.",
        },
      ],
    },
  },
  {
    files: ["scripts/**/*.mjs", "e2e/**", "playwright.config.ts", "tests/**", "vite.config.ts"],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["scripts/**/*.mjs", "e2e/**", "playwright.config.ts"],
    rules: { "no-console": "off" },
  },
);
