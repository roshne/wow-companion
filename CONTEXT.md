# WoW Companion — verified-facts ledger

The running record of what has actually been confirmed about this repo's **toolchain, testing, and
vendoring** — the non-obvious mechanics a future session would otherwise re-derive. See **Key
gotchas** in [`CLAUDE.md`](CLAUDE.md), which states the headlines and points here for the detail.

Every entry cites the source it was read from. Speculation does not belong here; the ledger is only
useful if everything in it is true. (The _irreversible identifiers_ live in `CLAUDE.md`, not here, to
avoid duplicating them across the two files.)

---

## Sources

- **The shipped code on disk** — authoritative for behaviour; cite `file:line`.
- **Four vendored upstream trees** (committed, never hand-edited — see below): the typed client from
  `roshne/battlenet-api-research`, the Bot Ops module (two halves) and the static-data bundle from
  `nazumods/wow`. Each has a `VENDORED.md` next to it with the refresh steps.

---

## Vendoring

Four trees are vendored copies of upstream code, committed so the build never touches the network.
Fixes start upstream; then re-vendor. Never hand-edit a vendored file.

- **`src/vendor/battlenet-wow-client/`** — the typed Web-API client, pinned to
  `battlenet-api-research` commit `321cc9d` (`VENDORED.md`). Refresh: upstream
  `npm run generate && npm run build`, then `npm run re-vendor` here (copies
  `{auth,client,index}.ts` + `generated/schema.d.ts`, rewrites imports extensionless). `schema.d.ts`
  is generated from the OpenAPI spec; response bodies are typed **only where a live sample was
  captured**, single-sample-inferred (all fields optional) — treat as best-effort.
- **`src/vendor/bot-ops/` + `src-tauri/vendor/bot-ops/`** — the shared Bot Ops module (TS + Rust
  halves), from `nazumods/wow` `apps/bot-ops`. Both halves are vendored by **one** script
  (`npm run vendor:bot-ops`) and must stay in step. The Rust half is a **path** dependency
  (`bot-ops = { path = "vendor/bot-ops" }` in `Cargo.toml`), deliberately not a git dependency, so
  both halves stay atomically in sync and the build stays offline.
- **`src/vendor/wow-static-data/`** — the static-data bundle (`static-data.json`), via
  `npm run vendor:static-data`.

**Drift detection is read-only; writing is a human action.** `npm run check:bot-ops` /
`check:static-data` compare **in memory** and never touch the tree — because this is a shared checkout,
a scheduled vendor-write would dirty the tree and silently stall `wow-companion-build` (which skips any
tick with uncommitted changes). Their exit codes are a shared contract: `0` up-to-date, `1` stale
(re-vendor), `3` fetch/read/validation failed; `check:static-data` also uses `2` for "nothing
published yet" (no analogue for bot-ops, whose module is committed source).

---

## Testing

- **Vitest is three projects** (`vitest.config.ts`), split by path/extension so each runs in the right
  environment:
  - **`lib`** — `environment: node`, `src/**/*.test.ts`. Sets `css: true` so `src/contrast.test.ts`
    can read the real `App.css` via a `?raw` import (Vitest otherwise stubs CSS imports to `""`).
  - **`scripts`** — `environment: node`, `scripts/**/*.test.mjs` (the release/version scripts).
  - **`components`** — `environment: jsdom`, `src/**/*.test.tsx`, `plugins: [react()]`,
    `setupFiles: ./src/test/setup.ts`. It **defines `__BUILD_ID__`** with a fixed fixture
    (`"v0.0.0 (0000000)"`) so components that read the build ID render under test — a root-level
    `define` is _not_ inherited by projects, so it must live on the project.
- Local run this session: **853 tests / 80 files pass**; `tsc --noEmit` and `eslint` clean. The Rust
  lanes (`cargo fmt/clippy/check/test` in `src-tauri`) need the Tauri toolchain and were **not** run
  locally — CI covers them.

## Build ID

- **`__BUILD_ID__`** is a compile-time constant (`v<version> (<sha>)`), declared in
  `src/vite-env.d.ts` and injected by `vite.config.ts` at build time: the version from
  `npm_package_version`, the commit from `scripts/git-ref.mjs`, composed by `buildId()` in
  `src/lib/buildId.ts` (the format is a tested contract). `-dirty` marks a build with uncommitted
  changes; a bare `v<version>` means no git checkout. It resolves **only at build time**, which is why
  tests supply the fixed fixture above rather than seeing a real sha.

## `format:check` — local vs CI

- `.prettierignore` excludes `src/vendor`, `src-tauri/vendor`, `src-tauri/gen`, `src-tauri/target`,
  `dist`, `node_modules`, `package-lock.json` — but **not** `.claude/`. A `.claude/worktrees/<name>/`
  nested checkout therefore leaks its (vendored) files into Prettier's walk and fails `format:check`
  **locally only**. CI does a clean checkout with no `.claude/worktrees`, so **CI's `format:check` is
  the real gate**. (`.gitattributes` `* text=auto eol=lf` fixed the older CRLF cause; the remaining
  local failures are the nested-checkout kind.)

## Version consistency

- **Five** files carry the version and **must agree** — `package.json`, `src-tauri/tauri.conf.json`,
  `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, and `package-lock.json` (which holds it at **two**
  sites). The authoritative set is `VERSION_FILES` in `scripts/versions.mjs`; read that, not the file's
  own header comment, which still says "four" and predates the `package-lock.json` entry `#171` added.
  `npm run bump` rewrites them together; `npm run check:versions` (`check-versions.mjs` → `versions.mjs`)
  asserts consistency and, with `--tag`, that they match the release tag. The **release** workflow runs
  `check-versions.mjs --tag <tag>` before building, so a tag that disagrees fails before anything ships.

---

## Environment — where secrets & state live

- **Client secret** — the OS keychain via the `keyring` crate (Windows Credential Manager); set and
  read only in Rust (`src-tauri/src/lib.rs`), never in the webview. `Cargo.toml` selects the keyring
  backend per target (Windows-native; Linux Secret Service over D-Bus needing `libdbus-1`).
- **Updater signing key** — the repo secrets `TAURI_SIGNING_PRIVATE_KEY` /
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (used by the release workflow); setup in
  [`docs/updater.md`](docs/updater.md).
- **`ops.json`** (Bot Ops config) — `%APPDATA%\com.roshne.wowcompanion\ops.json`, or a path in
  `WOW_COMPANION_OPS_CONFIG` (set at `src-tauri/src/lib.rs:233`; the default resolution lives in the
  vendored bot-ops crate). Absent config ⇒ the Bot Ops tab stays hidden.
- **Warband data source** — the newest
  `…\_retail_\WTF\Account\<ACCOUNT>\SavedVariables\Warbandeer_Characters.lua`, located by
  `candidate_roots()` across fixed WoW install paths on drives `C:`–`F:` (`src-tauri/src/warband.rs`).

---

## CI shape

- `ci.yml` runs on **GitHub-hosted** runners, three jobs: `frontend` (lint · format:check · tsc ·
  test · build) and `rust-linux` on `ubuntu-latest`, plus `rust` on `windows-latest`. The Windows job
  gates the real target (WebView2 + Windows-native keyring); the Linux job exists chiefly to exercise
  the Linux-only Secret Service keyring backend.
- **Stale-comment note:** one comment in `src-tauri/Cargo.toml` (near line 58, on the macOS keyring
  feature) still says CI is "self-hosted Windows + Linux only." That is out of date — `ci.yml` is
  GitHub-hosted. Believe `ci.yml`.

---

## Open questions

- **macOS keyring backend** — `Cargo.toml` declares an `apple-native` keyring feature, but macOS is
  not a build/release target and no CI job compiles or runs it; it's validated at dependency-resolution
  time only. Probe: add a macOS CI job if macOS ever becomes a target.
