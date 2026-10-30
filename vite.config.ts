import { defineConfig } from "vitest/config";

export default defineConfig({
  base: "./",
  build: {
    target: "es2022",
    sourcemap: false,
    modulePreload: { polyfill: false },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    coverage: {
      provider: "v8",
      include: ["src/core/**", "src/storage/**"],
      reporter: ["text"],
      thresholds: { lines: 90, functions: 90, branches: 85, statements: 90 },
    },
  },
});
