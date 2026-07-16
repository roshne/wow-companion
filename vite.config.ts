import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// Build-time version stamp, e.g. "v0.1.0-20260716-14:25:22". The version comes from package.json —
// npm exposes it as `npm_package_version` for every `npm run` script, which is how Tauri invokes both
// dev and build (see tauri.conf.json). The timestamp resolves once, when Vite loads this config (build
// time), and is baked into the bundle via `define` below, so the running app reports when it was built.
// Uses local build-machine time; switch the getters to `getUTC*` for UTC.
// @ts-expect-error process is a nodejs global
const version = process.env.npm_package_version || "0.0.0";

function buildStamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const date = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
  const time = `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  return `${date}-${time}`;
}

const buildId = `v${version}-${buildStamp()}`;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

  // Compile-time constant; declared in src/vite-env.d.ts, mirrored in vitest.config.ts for tests.
  define: {
    __BUILD_ID__: JSON.stringify(buildId),
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
