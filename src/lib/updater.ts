// In-app update check. Thin wrappers over the Tauri updater/process plugins, kept small and
// side-effect-light so the UI (and tests) don't touch the plugins directly.
//
// The updater fetches a signed manifest from the endpoint configured in `tauri.conf.json`
// (`plugins.updater`) — that fetch happens in Rust, not the webview, so it isn't gated by the CSP.
// A working end-to-end update needs published releases (issue #45); until those exist, `check()`
// 404s and we treat it as "no update".

import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

/** An update that's available to install. `install` downloads it and relaunches into it. */
export interface AvailableUpdate {
  version: string;
  install: () => Promise<void>;
}

/** True only when running inside the Tauri shell (not `npm run dev` in a plain browser, not jsdom). */
function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/**
 * Check the configured endpoint for a newer version. Returns the available update, or `null` when
 * the app is current. Every failure mode — offline, no release published yet (404), not running
 * under Tauri — is swallowed and reported as `null`, so a dev run or a fresh repo with zero releases
 * stays quiet rather than surfacing a scary error.
 */
export async function checkForUpdate(): Promise<AvailableUpdate | null> {
  if (!inTauri()) return null;
  try {
    const update = await check();
    if (!update) return null;
    return {
      version: update.version,
      async install() {
        await update.downloadAndInstall();
        await relaunch();
      },
    };
  } catch {
    return null;
  }
}
