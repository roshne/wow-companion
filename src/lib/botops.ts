// Bot Ops: thin typed wrappers over the Rust `botops` commands, which shell out to the box's
// ops/bot-ops.sh over SSH. All operator-only; `opsConfig()` returns null when ops mode isn't
// configured (no ops.json), which is how the Bot Ops tab stays hidden in normal use.

import { invoke } from "@tauri-apps/api/core";

// Shapes returned by the Rust commands (serde camelCase).
// One managed bot, as surfaced to the target switch (compose internals stay in Rust).
export interface OpsTargetInfo {
  name: string; // switch label, e.g. "debug" / "prod"
  ssh: string; // SSH destination, for display
}

export interface BotStatus {
  running: boolean;
  status: string; // docker status line, e.g. "Up 3 days"
  image: string;
  realmStatus: string; // last-observed realm status ("UP"/"DOWN"/"")
}

export interface EnvChange {
  key: string;
  value: string;
}

export interface EnvSetResult {
  ok: boolean;
  changed: string[]; // keys that actually changed
  recreated: boolean; // whether the container was force-recreated to apply
  backup?: string | null; // path of the .env backup taken before applying
  note?: string | null; // e.g. "no changes"
  log?: string | null; // docker compose output
}

export interface OpsField {
  key: string;
  label: string;
  hint: string;
}

// The non-secret keys the panel edits, in display order. Mirrors the whitelist in the box's
// ops/bot-ops.sh (the authority); secrets are intentionally absent and can't be set here.
export const OPS_FIELDS: OpsField[] = [
  {
    key: "ANNOUNCE_CHANNEL_ID",
    label: "Announce channel",
    hint: "Channel ID: server up/down, reset, DMF",
  },
  {
    key: "RELEASE_ANNOUNCE_CHANNEL_ID",
    label: "Release channel",
    hint: "Channel ID for release posts (blank = same as announce)",
  },
  {
    key: "WATCHED_REPOS",
    label: "Watched repos",
    hint: "owner/repo,owner/repo — release announcements",
  },
  { key: "WOW_REALM", label: "Realm slug", hint: "Realm watched for up/down, e.g. eitrigg" },
  { key: "WOW_REGION", label: "Region", hint: "us or eu" },
  { key: "GUILD_ID", label: "Guild ID", hint: "Server for guild-scoped slash commands" },
  { key: "COMMAND_PREFIX", label: "Command prefix", hint: "Slash-command prefix, e.g. r -> /rdmf" },
  {
    key: "ADMIN_USER_IDS",
    label: "Admin user IDs",
    hint: "Comma-separated user IDs allowed to /update",
  },
  { key: "REPORT_ROLE_ID", label: "Report role ID", hint: "Role allowed to use /report" },
  { key: "DMF_TIMEZONE", label: "DMF timezone", hint: "e.g. America/Los_Angeles" },
  { key: "BOT_BRANCH", label: "Bot branch", hint: "Branch self-update measures against" },
  { key: "AUTO_UPDATE", label: "Auto-update", hint: "true or false" },
];

// `opsConfig` returns the list of targets (or null when ops mode is off); every other command
// takes the selected target's index, so the panel can switch bots without re-reading config.

export function opsConfig(): Promise<OpsTargetInfo[] | null> {
  return invoke<OpsTargetInfo[] | null>("ops_config");
}

export function botStatus(target: number): Promise<BotStatus> {
  return invoke<BotStatus>("bot_status", { target });
}

/** Tail the container log (default 200, capped at 5000 by the backend). */
export function botLogs(target: number, lines: number): Promise<string> {
  return invoke<string>("bot_logs", { target, lines });
}

/** Restart the bot process in place (no env reload). Returns the compose output. */
export function botRestart(target: number): Promise<string> {
  return invoke<string>("bot_restart", { target });
}

/** Current values of the non-secret, editable env keys. */
export function botEnvGet(target: number): Promise<Record<string, string>> {
  return invoke<Record<string, string>>("bot_env_get", { target });
}

/** Apply env changes and (if anything really changed) recreate the container to load them. */
export function botEnvSet(target: number, changes: EnvChange[]): Promise<EnvSetResult> {
  return invoke<EnvSetResult>("bot_env_set", { target, changes });
}
