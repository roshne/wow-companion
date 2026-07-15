import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Two projects so app-owned lib helpers run lean under Node while React components run under jsdom
// with Testing Library. Standalone from vite.config.ts (which is Tauri-tuned) so the test run doesn't
// pull in the dev-server/plugin setup. Globs are disjoint by extension: `.test.ts` → lib, `.test.tsx`
// → components.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "lib",
          environment: "node",
          include: ["src/**/*.test.ts"],
        },
      },
      {
        plugins: [react()],
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
