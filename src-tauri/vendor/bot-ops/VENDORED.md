# Vendored: bot-ops (Rust crate)

`Cargo.toml` and `src/lib.rs` are a **vendored copy** of the shared Bot Ops crate maintained in
[`nazumods/wow`](https://github.com/nazumods/wow) at `apps/bot-ops/rust`. Do not hand-edit them —
the next `npm run vendor:bot-ops` overwrites them. **Changes start upstream.**

The frontend half is vendored at
[`src/vendor/bot-ops`](../../../src/vendor/bot-ops/VENDORED.md), which carries the full rationale,
the update commands and the exit-code contract. The two halves are vendored by one script and must
stay in step — a crate whose command signatures no longer match the TS wrappers fails at runtime,
not at build time.

## Why a vendored path dependency and not a git dependency

Cargo *can* depend on a git repo, but that would make the Rust build reach the network and pin a
moving rev — and the TS half could not follow, since npm cannot depend on a git subdirectory. One
mechanism for both halves keeps them atomically in sync and the build offline.

`src-tauri/Cargo.toml` therefore carries:

```toml
bot-ops = { path = "vendor/bot-ops" }
```

## What this crate does

It drives the `warbandeer-discord` bot on the box over SSH by invoking the versioned
`ops/bot-ops.sh` helper — the only privileged surface. It never runs docker and never edits the
bot's `.env` itself, so bot secrets never traverse the wire.

Registration in [`src/lib.rs`](../../src/lib.rs) goes through `bot_ops::commands::*`, not
`bot_ops::*`. That nesting is load-bearing: `#[tauri::command]` `#[macro_export]`s a `__cmd__<name>`
macro to the crate root, which collides with the same name at the root of the defining module.

`bot_ops::set_config_env_var("WOW_COMPANION_OPS_CONFIG")` runs before the builder so this app's
pre-existing override keeps working; the crate also honours a shared `BOT_OPS_CONFIG`, and falls
back to `ops.json` in the app config dir. With no config, `ops_config` returns `None` and the Bot
Ops tab stays hidden — which is how shipped builds stay dormant for end users.

## Tests

The crate's own tests live upstream and run there (`cd apps/bot-ops/rust && cargo test`); this copy
is source-only. `cargo check` in `src-tauri` is what verifies the vendored copy still compiles
against this app.
