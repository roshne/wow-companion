// Bot Ops: re-export of the shared module vendored at src/vendor/bot-ops.
//
// The wire types, the editable-key whitelist and the typed wrappers over the Rust `bot_ops`
// commands are maintained in nazumods/wow (apps/bot-ops) and vendored here by
// `npm run vendor:bot-ops` — warbandeer-desktop runs the same code. Only the React panel in
// src/components/BotOps.tsx is this app's own.
//
// This file exists so app code keeps importing from `../lib/botops` rather than reaching into
// src/vendor directly, which is how the other vendored modules are consumed too.

export {
  OPS_FIELDS,
  botEnvGet,
  botEnvSet,
  botLogs,
  botRestart,
  botStatus,
  changedFields,
  opsConfig,
} from "../vendor/bot-ops";

export type {
  BotStatus,
  EnvChange,
  EnvSetResult,
  OpsField,
  OpsTargetInfo,
} from "../vendor/bot-ops";
