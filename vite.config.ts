import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { buildId } from "./src/lib/buildId";
import { gitRef } from "./scripts/git-ref.mjs";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// Build-time build ID, e.g. "v1.0.0 (9502198)" — see `src/lib/buildId.ts` for the format and
// `scripts/git-ref.mjs` for how the commit is read. The version comes from package.json — npm exposes
// it as `npm_package_version` for every `npm run` script, which is how Tauri invokes both dev and build
// (see tauri.conf.json). Both halves resolve once, when Vite loads this config (build time), and are
// baked into the bundle via `define` below, so the running app reports the exact source it was built
// from rather than just its version.
// @ts-expect-error process is a nodejs global
const version = process.env.npm_package_version || "0.0.0";
const stamp = buildId(version, gitRef());

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

  // Compile-time constant; declared in src/vite-env.d.ts, mirrored in vitest.config.ts for tests.
  define: {
    __BUILD_ID__: JSON.stringify(stamp),
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
