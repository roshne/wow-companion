import { useEffect, useState } from "react";
import { checkForUpdate, type AvailableUpdate } from "../lib/updater";

/**
 * Checks for an update once on mount and, when one is available, shows a slim top bar offering to
 * install it and relaunch. Renders nothing when the app is current (the usual case) — offline, no
 * published release, or running outside Tauri are all treated as "no update" by `checkForUpdate`,
 * so this stays quiet. Mounted app-wide from `main.tsx`, alongside the toast host.
 */
export function UpdateBanner() {
  const [update, setUpdate] = useState<AvailableUpdate | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void checkForUpdate().then((u) => {
      if (!cancelled) setUpdate(u);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!update) return null;

  function install() {
    if (busy) return;
    setBusy(true);
    // On success the app relaunches into the new version (so `busy` needn't reset); on failure,
    // re-enable the button so the user can retry.
    void update!.install().catch(() => setBusy(false));
  }

  return (
    <div className="update-banner" role="status">
      <span>
        Update to <strong>v{update.version}</strong> is ready.
      </span>
      <button type="button" onClick={install} disabled={busy}>
        {busy ? "Installing…" : "Install & restart"}
      </button>
    </div>
  );
}
