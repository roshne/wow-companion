import { defineConfig } from "vitest/config";

// Unit tests for the pure, app-owned lib helpers. Standalone from vite.config.ts
// (which is Tauri-tuned) so the test run doesn't pull in the dev-server/plugin setup.
// Node environment — these helpers touch no DOM, so we skip jsdom to keep it lean.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
