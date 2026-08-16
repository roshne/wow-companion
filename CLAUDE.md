# WoW Companion — Claude Instructions

A **desktop app** (Tauri v2 + React/TypeScript, Windows-first) for the Battle.net → World of
Warcraft **Web REST API**. It is the downstream **consumer** of
[`battlenet-api-research`](https://github.com/roshne/battlenet-api-research) — that repo is the
reusable foundation (docs + OpenAPI spec + typed client); **this repo is the application**, and it
_vendors_ the foundation's client rather than owning it.

My personal `~/.claude/CLAUDE.md` governs _how I work_ — the review gate, escalation, git & shipping,
commit mechanics, search-tool routing, shell choice, and the **Code style** baseline. It is **not
restated here**; this file covers only what is specific to this repo. Where a rule below overrides a
personal one, it says so explicitly.

This is a **shared checkout** — concurrent sessions on this tree are common (the `wow-companion-build`
routine and other sessions run here; a `.claude/worktrees/` checkout may be present). That is the
repo-specific fact personal's git rules ask the repo file to register; apply those rules (staging
scope, worktree-when-active) accordingly — the default shipping shape (a branch + `/pr`) is unchanged.

**Commit convention (as used in this repo's history):** Conventional Commits, `type(scope): subject`,
with a trailing `(#NN)` PR number. Recent scoped doc commits use `doc(...)` (singular), e.g.
`doc(readme):`; older history also has unscoped `docs:`. Real scopes from `git log`: `warband`, `currency`, `auth`, `account`, `guild`, `ui`, `a11y`,
`vendor`, `release`, `realm-status`, `botops`, `discord`, `readme`. Match what the log already shows.

The human-facing overview (features, prerequisites, how to run, how to get a Battle.net client) is in
[`README.md`](README.md); the paid-for-once toolchain, testing, and gotcha detail is in
[`CONTEXT.md`](CONTEXT.md). This file is the authoring/working rules; it points to those rather than
duplicating them.

---

## Ground truth: where facts come from

The shipped code on disk is the source of truth for behaviour — cite it by `file:line`. Mark each
claim's tier as you make it: **verified** (read this session; name the file), **inferred** (say so),
or **unknown** (say so, or write the probe). Don't let an inference harden into a fact by repetition.

Four surfaces are **vendored snapshots of upstream code**, not authored here — how to change one is in
**Generated vs authored** below. Treat the vendored copy as current and cite the on-disk code for
behaviour.

---

## Generated vs authored

Never hand-edit anything in the table below; change the upstream source and re-run its vendor script.
The vendored trees are **committed** (not gitignored) on purpose — so the build never touches the
network and a shipped build never depends on an upstream repo staying reachable. Each carries a
`VENDORED.md` with the exact refresh steps and, for Bot Ops, an exit-code contract.

| File / dir                                          | Produced by                                        | Upstream                                    |
| --------------------------------------------------- | -------------------------------------------------- | ------------------------------------------- |
| `src/vendor/battlenet-wow-client/`                  | `npm run re-vendor`                                | `roshne/battlenet-api-research` (`client/`) |
| `src/vendor/bot-ops/` + `src-tauri/vendor/bot-ops/` | `npm run vendor:bot-ops` (both halves, one script) | `nazumods/wow` (`apps/bot-ops`)             |
| `src/vendor/wow-static-data/`                       | `npm run vendor:static-data`                       | `nazumods/wow` static-data bundle           |
| `src-tauri/gen/`, `dist/`                           | Tauri / `vite build`                               | — (generated locally, not committed)        |

`__BUILD_ID__` (the footer's `v<version> (<sha>)`) is not a file — it's a compile-time constant baked
in by Vite at build time. The app **version** lives across several files that must agree, kept in step
by `npm run bump` and guarded by `npm run check:versions`. See [`CONTEXT.md`](CONTEXT.md) for the
mechanics of both.

---

## Irreversible: what installs and consumers resolve by

These are this repo's instance of personal's _shipped identifier / live data path_ rule. Changing one
breaks already-installed apps or users' registered clients **invisibly to every check here** — if a
task appears to require it, **stop and raise it** (personal's **Escalation**).

- **App identifier `com.roshne.wowcompanion`** (`src-tauri/tauri.conf.json`) — resolves the config dir
  `%APPDATA%\com.roshne.wowcompanion\` where `ops.json` lives. Renaming orphans user config.
- **Updater endpoint** (`plugins.updater.endpoints`, `tauri.conf.json`) → the repo's
  `releases/latest/download/latest.json`. Renaming the repo or the URL breaks auto-update for
  installed apps.
- **Updater `pubkey`** (`tauri.conf.json`) — installed apps verify each update's signature against it.
  Rotating the signing key makes every installed app reject updates. See [`docs/updater.md`](docs/updater.md).
- **OAuth redirect `http://localhost:48757/callback`** (`src-tauri/src/account_auth.rs:33`) — must
  match the URL the user registered on their Battle.net client **exactly**; the port is a compile-time
  constant, not runtime-configurable.

---

## Testing & checks

Run **before staging** (and again after a rebase). They do not substitute for the **review gate** in
personal. Frontend lanes are quick and runnable anywhere with `node_modules`; the Rust lanes need the
Tauri toolchain and the real target OS, so CI is usually where they run.

**Frontend** (repo root):

- `npm run lint` — ESLint, `--max-warnings 0` (a warning fails).
- `npm run format:check` — Prettier. **Local caveat:** can fail on files _outside_ the app source
  (a `.claude/worktrees/` nested checkout; historically CRLF). CI's clean checkout is the real gate —
  see [`CONTEXT.md`](CONTEXT.md).
- `npx tsc --noEmit` — typecheck.
- `npm run test` — Vitest (three projects; see [`CONTEXT.md`](CONTEXT.md)).
- `npx vite build` — production frontend build.

**Rust** (`cd src-tauri`): `cargo fmt --check`, `cargo clippy -- -D warnings`, `cargo check`,
`cargo test`.

**CI** ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs all of the above on GitHub-hosted
runners — see [`CONTEXT.md`](CONTEXT.md) for the job topology and a stale "self-hosted" comment to
ignore.

**A green local check is not proof it works in the app.** The live data views need real Battle.net
credentials + WebView2 + an actual run; the Warband parser needs a real `Warbandeer_Characters.lua`;
Bot Ops needs working SSH. Report what you ran and name what still needs the real run (personal's
**Done means**).

---

## Code style

Follows personal's **Code style** baseline. This repo's individuality:

- **TypeScript `strict`**, plus `noUnusedLocals` / `noUnusedParameters` / `noFallthroughCasesInSwitch`
  (`tsconfig.json`).
- **ESLint flat config** (`eslint.config.js`): `@eslint/js` + `typescript-eslint` recommended +
  `react-hooks`, `eslint-config-prettier` last. `src/**` lints as browser runtime, `scripts/**` and
  root config as Node; `src/vendor` and `src-tauri` are never linted.
- **Prettier** with `printWidth: 100` and otherwise defaults; the formatter is on and gates in CI.
- **Not stdlib-only** — it takes dependencies (React 19, TanStack Query/Virtual, Tauri plugins,
  `openapi-fetch`; Rust: `tauri`, `reqwest`, `mlua`, `keyring`).

---

## Key gotchas

One-liners; the mechanics and citations are in [`CONTEXT.md`](CONTEXT.md).

- **Re-vendoring is a human action on a clean tree, never scheduled** — the `check:*` scripts only
  _detect_ drift; they never write.
- **`format:check` can fail locally on non-source files** (a `.claude/worktrees/` checkout) — CI's
  clean checkout is the real gate.
