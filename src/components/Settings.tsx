import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Region } from "../vendor/battlenet-wow-client";
import { ThemeToggle } from "./ThemeToggle";

const REGIONS: Region[] = ["us", "eu", "kr", "tw"];

/**
 * The settings dialog: region, theme, and Battle.net credential management in one place (previously
 * scattered across the header). A modal — a dimming backdrop + a centered card; focus moves into the
 * dialog on open and returns to the opener on close; Escape or a backdrop click dismisses it.
 * Credentials can be replaced in place (rotate the Client ID / Secret without dropping to the connect
 * gate) or cleared (Disconnect).
 */
export function Settings({
  region,
  onRegionChange,
  onDisconnect,
  onClose,
}: {
  region: Region;
  onRegionChange: (region: Region) => void;
  onDisconnect: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [status, setStatus] = useState("");

  // Move focus into the dialog on open; restore it to the opener (the Settings button) on close.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    return () => opener?.focus?.();
  }, []);

  // Dismiss on Escape.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  async function replaceCreds(e: FormEvent) {
    e.preventDefault();
    setStatus("Saving…");
    try {
      await invoke("save_credentials", { clientId, clientSecret });
      setClientId("");
      setClientSecret("");
      setStatus("Saved.");
    } catch (err) {
      setStatus(`Error: ${String(err)}`);
    }
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        className="modal-card settings"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="settings-head">
          <h2 id={titleId} style={{ margin: 0 }}>
            Settings
          </h2>
          <button
            type="button"
            className="ghost settings-close"
            aria-label="Close"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <div className="settings-section">
          <div className="settings-row">
            <label className="muted">
              Region{" "}
              <select
                value={region}
                onChange={(e) => onRegionChange(e.currentTarget.value as Region)}
              >
                {REGIONS.map((r) => (
                  <option key={r} value={r}>
                    {r.toUpperCase()}
                  </option>
                ))}
              </select>
            </label>
            <ThemeToggle />
          </div>
        </div>

        <div className="settings-section">
          <h3 style={{ margin: "0 0 0.35rem" }}>Battle.net credentials</h3>
          <form onSubmit={replaceCreds}>
            <p className="muted" style={{ margin: "0 0 0.35rem" }}>
              Replace your Client ID / Secret. The secret is stored in your OS keychain — never in
              the app.
            </p>
            <input
              placeholder="Client ID"
              value={clientId}
              onChange={(e) => setClientId(e.currentTarget.value)}
            />
            <input
              type="password"
              placeholder="Client Secret"
              value={clientSecret}
              onChange={(e) => setClientSecret(e.currentTarget.value)}
            />
            <button type="submit">Save to keychain</button>
            {status && <p className="muted">{status}</p>}
          </form>
          <button type="button" className="ghost settings-disconnect" onClick={onDisconnect}>
            Disconnect
          </button>
        </div>
      </div>
    </div>
  );
}
