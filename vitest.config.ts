import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      exclude: ["**/*.config.*", "**/*.d.ts", "**/coverage/**", "**/dist/**", "**/node_modules/**"],
      provider: "v8",
      reporter: ["text", "json-summary", "html"],
      reportsDirectory: "coverage",
    },
    environment: "node",
    globals: false,
    passWithNoTests: true,
    projects: [
      {
        extends: true,
        test: {
          include: ["src/**/*.test.ts"],
          name: "@cosystem/angular",
          root: "./packages/angular",
        },
      },
      {
        extends: true,
        test: {
          include: ["src/**/*.test.ts"],
          name: "@cosystem/core",
          root: "./packages/core",
        },
      },
      {
        extends: true,
        test: {
          include: ["src/**/*.test.ts"],
          name: "@cosystem/devtools",
          root: "./packages/devtools",
        },
      },
      {
        extends: true,
        test: {
          include: ["src/**/*.test.ts"],
          name: "@cosystem/react",
          root: "./packages/react",
        },
      },
      {
        extends: true,
        test: {
          include: ["src/**/*.test.ts"],
          name: "@cosystem/router",
          root: "./packages/router",
        },
      },
      {
        extends: true,
        test: {
          include: ["src/**/*.test.ts"],
          name: "@cosystem/solid",
          root: "./packages/solid",
        },
      },
      {
        extends: true,
        test: {
          include: ["src/**/*.test.ts"],
          name: "@cosystem/storage",
          root: "./packages/storage",
        },
      },
      {
        extends: true,
        test: {
          include: ["src/**/*.test.ts"],
          name: "@cosystem/svelte",
          root: "./packages/svelte",
        },
      },
      {
        extends: true,
        test: {
          include: ["src/**/*.test.ts"],
          name: "@cosystem/testing",
          root: "./packages/testing",
        },
      },
      {
        extends: true,
        test: {
          include: ["src/**/*.test.ts"],
          name: "@cosystem/vue",
          root: "./packages/vue",
        },
      },
    ],
  },
});
