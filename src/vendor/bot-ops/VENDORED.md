# Vendored: bot-ops (frontend half)

`index.ts` is a **vendored copy** of the shared Bot Ops module maintained in
[`nazumods/wow`](https://github.com/nazumods/wow) at `apps/bot-ops/ts/index.ts`. Do not hand-edit
it — the next `npm run vendor:bot-ops` overwrites it, and `npm run check:bot-ops` reports the drift
in the meantime. **Changes start upstream.**

The Rust half is vendored beside the backend, at
[`src-tauri/vendor/bot-ops`](../../../src-tauri/vendor/bot-ops/VENDORED.md); the two are vendored
together by one script and must stay in step.

## Why this exists

The operator-only Bot Ops panel ships in two Tauri apps — this one and `warbandeer-desktop` in
`nazumods/wow` — and both drive the *same* bot through the *same* `ops/bot-ops.sh` helper on the
box. Each app used to carry its own near-identical copy of the backend, the wire types, and the
editable-key whitelist, so every change to the bot's env contract had to be made twice.

What is shared is everything below the view: the Tauri commands, the SSH plumbing, the config gate
and the field list. The **panel itself is not** — that app renders Svelte, this one React — so
[`src/components/BotOps.tsx`](../../components/BotOps.tsx) stays local and is the only Bot Ops code
this repo owns.

## Updating

```sh
npm run vendor:bot-ops     # fetch the newest module, write if changed
npm run check:bot-ops      # report only — never writes
```

Both read GitHub at the source repo's default branch. To vendor from a local checkout instead —
useful when the module change isn't pushed yet — pass it explicitly:

```sh
npm run vendor:bot-ops -- --from R:/repos/wow
```

`check:bot-ops` compares entirely in memory; it never touches the working tree. That matters
because this repo is a shared checkout — a routine that vendored on a schedule would leave the tree
dirty and silently stall `wow-companion-build`, which skips any tick with uncommitted changes.
Detection can be automated; **writing is always a human action on a clean tree.**

Its exit codes are a contract, deliberately matching `fetch-static-data.mjs`:

| Code | Meaning | Actionable |
|---:|---|---|
| 0 | Up to date | no |
| 1 | The vendored copy is stale | **yes** — run `vendor:bot-ops` |
| 3 | Fetch, read or validation failed | **yes** — something is broken |

Code 2 (`fetch-static-data`'s "nothing published yet") has no analogue here: the module is
committed source, not a release artifact, so its absence is a genuine breakage.

Fetching happens at **development time** and the result is committed — the same contract as the
`battlenet-wow-client` and `wow-static-data` vendoring beside it. The build never touches the
network, and the shipped app never depends on the source repo staying reachable.

After a re-vendor, run `npm run lint && npm test && npm run build` — a change to the module's
exports shows up here as a type error in `src/lib/botops.ts` or `src/components/BotOps.tsx`.

## Consuming it

App code imports through [`src/lib/botops.ts`](../../lib/botops.ts), never from this directory
directly. That keeps the vendored path an implementation detail, and is why a re-vendor normally
touches no app code at all.

## Source contract

| | |
|---|---|
| Source repo | `nazumods/wow` (public — no auth needed) |
| Path | `apps/bot-ops/ts/index.ts` |
| Ref | the repo's default branch |

The module's own `package.json`, `tsconfig.json` and docs are **not** vendored — they exist so it
can be developed and typechecked standalone. See `apps/bot-ops/CONTEXT.md` upstream for the design
constraints, including why the Tauri commands live in `bot_ops::commands` rather than at the crate
root.
