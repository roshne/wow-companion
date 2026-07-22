import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Three projects so app-owned lib helpers run lean under Node while React components run under jsdom
// with Testing Library, and the release/version scripts run under Node against real files. Standalone
// from vite.config.ts (which is Tauri-tuned) so the test run doesn't pull in the dev-server/plugin
// setup. Globs are disjoint by extension/path: `src/**/*.test.ts` → lib, `src/**/*.test.tsx` →
// components, `scripts/**/*.test.mjs` → scripts.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "lib",
          environment: "node",
          // Vitest replaces CSS imports with empty strings by default, including `?raw` ones. The
          // theme-contrast guard (src/contrast.test.ts) reads the real App.css text, so let this
          // project resolve stylesheets. No component here imports CSS for its styling.
          css: true,
          include: ["src/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "scripts",
          environment: "node",
          include: ["scripts/**/*.test.mjs"],
        },
      },
      {
        plugins: [react()],
        // Mirror vite.config.ts's build-time constant with a fixed value so components that read it
        // render under test (the real stamp is injected only by the Tauri/Vite build). Must live on
        // the project — a root-level `define` isn't inherited by `test.projects`.
        define: {
          __BUILD_ID__: JSON.stringify("v0.0.0-test"),
        },
        test: {
          name: "components",
          environment: "jsdom",
          include: ["src/**/*.test.tsx"],
          setupFiles: ["./src/test/setup.ts"],
        },
      },
    ],
  },
});
