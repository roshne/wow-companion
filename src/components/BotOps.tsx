import { useCallback, useEffect, useState } from "react";
import {
  botEnvGet,
  botEnvSet,
  botLogs,
  botRestart,
  botStatus,
  OPS_FIELDS,
  type BotStatus,
  type OpsTargetInfo,
} from "../lib/botops";

// Operator-only panel: manages a warbandeer-discord bot on the box via the Rust `botops` commands
// (which shell out to ops/bot-ops.sh over SSH). App renders it only when ops mode is configured,
// passing the list of targets (debug/prod); a selector switches between them. Edits non-secret env
// only; secrets stay on the box.
export function BotOps({ targets }: { targets: OpsTargetInfo[] }) {
  const [selected, setSelected] = useState(0);
  const [status, setStatus] = useState<BotStatus | null>(null);
  const [env, setEnv] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [logs, setLogs] = useState("");
  const [logLines, setLogLines] = useState(200);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<null | "restart" | "apply">(null);

  const loadState = useCallback(async () => {
    setError(null);
    try {
      const [st, ev] = await Promise.all([botStatus(selected), botEnvGet(selected)]);
      setStatus(st);
      setEnv(ev);
      setDraft({ ...ev });
    } catch (e) {
      setError(String(e));
    }
  }, [selected]);

  // Runs on mount and whenever the selected target changes (loadState depends on `selected`).
  useEffect(() => {
    void loadState();
  }, [loadState]);

  function switchTarget(i: number) {
    setSelected(i);
    setLogs("");
    setNotice(null);
    setError(null);
    setConfirming(null);
    // env/status reload via the loadState effect above.
  }

  const changed = OPS_FIELDS.filter((f) => (draft[f.key] ?? "") !== (env[f.key] ?? ""));

  async function fetchLogs() {
    setBusy(true);
    setError(null);
    try {
      setLogs(await botLogs(selected, logLines));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function doRestart() {
    setConfirming(null);
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await botRestart(selected);
      setNotice("Bot restarted.");
      await loadState();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function doApply() {
    setConfirming(null);
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await botEnvSet(
        selected,
        changed.map((f) => ({ key: f.key, value: draft[f.key] ?? "" })),
      );
      setNotice(
        res.recreated
          ? `Applied ${res.changed.join(", ")} — bot recreated.${res.backup ? ` Backup: ${res.backup}` : ""}`
          : (res.note ?? "No changes."),
      );
      await loadState();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <div className="bot-statusbar">
        {targets.length > 1 && (
          <label className="bot-target">
            Bot{" "}
            <select
              aria-label="Bot"
              value={selected}
              onChange={(e) => switchTarget(Number(e.currentTarget.value))}
            >
              {targets.map((t, i) => (
                <option key={t.name} value={i}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <span
          className={`bot-dot${status?.running ? " on" : status && !status.running ? " off" : ""}`}
        />
        <span>{status ? status.status || (status.running ? "running" : "stopped") : "…"}</span>
        {status?.realmStatus && (
          <span className={`bot-realm${status.realmStatus === "DOWN" ? " down" : ""}`}>
            realm {status.realmStatus}
          </span>
        )}
        <span className="bot-host">{targets[selected]?.ssh}</span>
        <span className="bot-spacer" />
        <button className="ghost" onClick={() => void loadState()} disabled={busy} title="Reload">
          ⟳
        </button>
        <button onClick={() => setConfirming("restart")} disabled={busy}>
          Restart
        </button>
      </div>

      {error && <div className="bot-banner err">{error}</div>}
      {notice && <div className="bot-banner ok">{notice}</div>}

      {confirming === "restart" && (
        <div className="bot-confirm">
          Restart the bot now? (process restart, no env change)
          <button onClick={() => void doRestart()} disabled={busy}>
            Confirm
          </button>
          <button className="ghost" onClick={() => setConfirming(null)}>
            Cancel
          </button>
        </div>
      )}

      <div className="bot-h">Environment</div>
      <div className="bot-fields">
        {OPS_FIELDS.map((f) => {
          const dirty = (draft[f.key] ?? "") !== (env[f.key] ?? "");
          return (
            <div key={f.key} className={`bot-field${dirty ? " dirty" : ""}`}>
              <span className="bot-fl">{f.label}</span>
              <input
                aria-label={f.label}
                value={draft[f.key] ?? ""}
                placeholder={f.hint}
                spellCheck={false}
                onChange={(e) => {
                  const v = e.currentTarget.value;
                  setDraft((d) => ({ ...d, [f.key]: v }));
                }}
              />
              <span className="bot-fh">{f.hint}</span>
            </div>
          );
        })}
      </div>

      <div className="bot-applybar">
        <span className="bot-cnt">{changed.length} changed</span>
        <button
          className="bot-primary"
          onClick={() => setConfirming("apply")}
          disabled={busy || changed.length === 0}
        >
          Apply &amp; recreate
        </button>
      </div>

      {confirming === "apply" && (
        <div className="bot-confirm">
          Apply {changed.length} change{changed.length === 1 ? "" : "s"} (
          {changed.map((f) => f.key).join(", ")}) and recreate the bot to load them?
          <button className="bot-primary" onClick={() => void doApply()} disabled={busy}>
            Confirm
          </button>
          <button className="ghost" onClick={() => setConfirming(null)}>
            Cancel
          </button>
        </div>
      )}

      <div className="bot-logs-head">
        <span className="bot-h" style={{ margin: 0 }}>
          Logs
        </span>
        <input
          className="bot-lines"
          type="number"
          min={1}
          max={5000}
          aria-label="Log lines"
          value={logLines}
          onChange={(e) => setLogLines(Number(e.currentTarget.value) || 200)}
        />
        <button onClick={() => void fetchLogs()} disabled={busy}>
          Fetch
        </button>
      </div>
      {logs && <pre className="bot-logs">{logs}</pre>}
    </section>
  );
}
