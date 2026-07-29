# WoW Companion

A small **desktop app** (Tauri v2 + React/TypeScript) for the Battle.net → World of Warcraft
**Web REST API**. It's the downstream _consumer_ of
[`battlenet-api-research`](https://github.com/roshne/battlenet-api-research) — that repo is the
reusable foundation (docs + OpenAPI spec + typed client); this repo is the actual application.

> Not affiliated with Blizzard Entertainment.

## Architecture — the secret never touches the webview

OAuth **client-credentials** requires a client secret, which must not ship in frontend JS. So:

```
React webview  ──invoke("get_access_token")──►  Rust (Tauri)
     │                                             │  secret in OS keychain (keyring)
     │  typed client (vendored)                    │  POST oauth.battle.net/token (reqwest)
     │  requests via @tauri-apps/plugin-http ──────┘  returns short-lived bearer token
     ▼
{region}.api.blizzard.com   (calls go through Rust → no webview CORS)
```

- **Client secret** lives only in Rust, stored in the **OS keychain** (`keyring`). See
  [`src-tauri/src/lib.rs`](src-tauri/src/lib.rs).
- **Token exchange** happens in Rust (`get_access_token`); the frontend only ever sees a short-lived
  bearer token.
- **Data calls** are made through the **Tauri HTTP plugin** (from Rust), so they aren't blocked by
  webview CORS to the Blizzard API. Allowed hosts are scoped in
  [`src-tauri/capabilities/default.json`](src-tauri/capabilities/default.json).
- **Types**: [`src/vendor/battlenet-wow-client/`](src/vendor/battlenet-wow-client/) is a vendored copy
  of the foundation's typed client (see its `VENDORED.md` for how to refresh it).
- **Bot Ops** is a vendored shared module, not this repo's code — see
  [Bot Ops tab](#bot-ops-tab--operator-only) below.

## Features

- **WoW Token** — the current token price, with an in-app price history.
- **Realm Status** — every connected realm's status (UP/DOWN), population, and login queue, with a filter.
- **Character** — look up a character by realm + name, into a sub-tabbed detail sheet:
  - **Overview** — profile summary (level, race/class/spec, faction, guild, item level, achievements) + avatar.
  - **Gear** — a **paper doll** (per-slot items, quality borders, item levels, sockets/enchants in a
    popover) with a **gear check** (empty sockets, missing enchants, a missing off-hand, item-level
    outliers) surfaced as slot badges, a summary, and a prioritized **"fix these"** panel.
  - **Spec** (active spec + talent loadout), **M+**, **PvP**, **Professions**, **Reputations**
    (standing / renown), **Collections** (mounts / pets / toys), **Raids** (per-difficulty boss
    progress), and **Achievements** (a virtualized, filterable browser).
- **Guild** — look up a guild by realm + name: a summary card (faction, member count, achievement
  points) and a sub-tabbed detail — a sortable **roster** (name/class colour, rank, level, race,
  class, realm), guild **achievements**, and recent **activity**.
- **Auctions** — a connected realm's auction house (or the region-wide commodities), aggregated by
  item and sortable over a virtualized list.
- **Warband** — everything the [Warbandeer](https://github.com/nazumods/wow) addon records about your
  alts, read locally with no API call, across six views:
  - **Roster** — name, class colour, level, item level, spec and professions for every alt.
  - **Gear board** — a characters × slots item-level matrix that streams in row by row, sorts/filters
    by item level / issues / class / role, and shows a warband-wide **"needs attention"** gear-fix
    roll-up.
  - **Great Vault** — each max-level character's three reward tracks as pips, plus this week's raid
    lockouts. Characters not played since the weekly reset are marked as such rather than shown with
    an empty vault.
  - **Keys & locks** — held Mythic+ keystones (dungeon names resolved from the API), the week's M+
    count, and instance lockouts.
  - **Currencies** — every currency and crest across the warband, with names, icons and cap progress.
  - **Titles** — every player title, who has earned it and what remains, with filters and search.

  Above them all, a wealth line: total warband gold and what it converts to in **WoW Tokens**.

  Most of this has no Web API equivalent at all — Blizzard exposes no endpoint for gold, currencies,
  the Great Vault, lockouts or a title catalogue — so the addon is the only source.

- **Bot Ops** _(operator-only, hidden by default)_ — manage the self-hosted
  [`warbandeer-discord`](https://github.com/nazumods/wow/tree/main/apps/warbandeer-discord) bot on the
  box over SSH: status, log tail, restart, and edits to its **non-secret** settings. Appears only when
  an `ops.json` is present (see below).

Every data tab except Warband and Bot Ops is typed by the vendored Web API client (Warband is local
addon data; Bot Ops drives the bot over SSH), and the region (US/EU/KR/TW) is switchable in the header.

### Warband tab — local addon data

The Warband tab reads the `Warbandeer_Characters` addon's SavedVariables
(`…\_retail_\WTF\Account\<ACCOUNT>\SavedVariables\Warbandeer_Characters.lua`) — a Lua table the addon
rewrites each login. The Rust backend locates the newest such file across installed accounts and
parses it in a sandboxed embedded Lua VM (`mlua`). No Battle.net credentials are involved — see
[Requirements](#2-the-warbandeer-addon--for-the-warband-tab) for which addon to install and why the
file's age matters.

### Bot Ops tab — operator-only

A hidden, operator-only tab for managing the self-hosted `warbandeer-discord` bot(s) — check status,
tail logs, restart, and edit **non-secret** settings (announce channels, watched realm/repos, etc.),
with a **debug/prod switch** when you configure more than one bot. It's **hidden unless you opt in**
with an `ops.json`, and — unlike the data tabs — it's **reachable without connecting Battle.net
credentials** (it has nothing to do with the API).

It drives the bot through a versioned helper on the box (`bot-ops.sh`, shipped in the
[`nazumods/wow`](https://github.com/nazumods/wow/tree/main/apps/warbandeer-discord/ops) repo) invoked
over SSH: the Rust side only shells `ssh` with fixed subcommands, so **bot secrets never cross the
wire** and the editable-key whitelist is enforced on the box. Secrets (tokens) are never read or
written from here.

**Everything under the panel is vendored, not written here.** `nazumods/wow`'s own desktop app ships
the same tab, so the backend, the wire types and the editable-key whitelist live once in that repo's
[`apps/bot-ops`](https://github.com/nazumods/wow/tree/main/apps/bot-ops) module and are vendored in:

```bash
npm run vendor:bot-ops
```

```bash
npm run check:bot-ops
```

Only [`src/components/BotOps.tsx`](src/components/BotOps.tsx) — the React view — is this repo's, and
the two vendored halves ([`src/vendor/bot-ops`](src/vendor/bot-ops/VENDORED.md) and
[`src-tauri/vendor/bot-ops`](src-tauri/vendor/bot-ops/VENDORED.md)) must never be hand-edited: the
next vendor run overwrites them. Fixes start upstream.

To enable it, create `%APPDATA%\com.roshne.wowcompanion\ops.json` (or point `WOW_COMPANION_OPS_CONFIG`
at a file) listing the bot(s) to manage:

```json
{
  "targets": [
    {
      "name": "debug",
      "ssh": "roshne@192.168.7.48",
      "remoteDir": "~/repos/wow-debug/apps/warbandeer-discord",
      "project": "warbandeer-discord-debug",
      "container": "warbandeer-discord"
    },
    {
      "name": "prod",
      "ssh": "nazu@prod-host",
      "remoteDir": "~/path/to/apps/warbandeer-discord",
      "project": "warbandeer-discord",
      "container": "warbandeer-discord"
    }
  ]
}
```

`project`/`container` are optional (default to debug's). The old single-bot shape
(`{ "ssh": "...", "remoteDir": "..." }`) still works as one `debug` target. Key-based SSH to each
host must work (the app reuses your key), and that host must have the helper at
`<remoteDir>/ops/bot-ops.sh`. The `prod` entry above is a placeholder — see the helper's
[README](https://github.com/nazumods/wow/tree/main/apps/warbandeer-discord/ops) for the full format
and prod setup breadcrumbs.

## Requirements

Two prerequisites, independent of each other: a **Battle.net developer client** for anything that
calls the Web API, and the **Warbandeer addon** for the Warband tab. Plus **WebView2** to render the
app at all — it ships with Windows 11, so on a current install you already have it.

Which tab needs which:

| Tab                                                     | Calls the Blizzard API?       | Also needs                 |
| ------------------------------------------------------- | ----------------------------- | -------------------------- |
| WoW Token, Realm Status, Character, Guild, Auctions     | yes                           | —                          |
| Warband — **gear board**                                | yes (each alt's equipment)    | the addon                  |
| Warband — roster, Great Vault, keys, currencies, titles | no (parsed from a local file) | the addon                  |
| Bot Ops _(operator-only)_                               | no (SSH)                      | `ops.json` + key-based SSH |

The middle column is about what actually calls Blizzard — it's why the Warband tab keeps working when
the API doesn't. It isn't a way to skip step 1: the app routes you to the connect form before **any**
data tab, so a developer client is needed to reach all of them today (Bot Ops with an `ops.json` is
the one exception).

### 1. A Battle.net developer client (Client ID + Secret)

**You have to register your own** at [develop.battle.net](https://develop.battle.net/) — see
_Getting a Client ID & Secret_ below for the walkthrough. Your Battle.net account needs an
**Authenticator** attached first; Blizzard requires two-factor before it will grant API access at all.

The app ships no credential, and there's no secret-free path to add later. Blizzard's token endpoint
rejects a public client outright — probed directly against `oauth.battle.net`:

- an authorization-code exchange **without a secret** (PKCE) returns `401 invalid_client`;
- the **device-code** grant returns `401 unauthorized_client` — _"Client does not have a required
  roles to use this grant type"_.

A shipped secret would also be extractable from the binary, and every user would then share one rate
limit — one abusive user would break the app for everyone. Yours stays on your machine: see
[Architecture](#architecture--the-secret-never-touches-the-webview).

### 2. The Warbandeer addon — for the Warband tab

Two addons in [`nazumods/wow`](https://github.com/nazumods/wow) share the name, and it's the data one
that matters:

- **`Warbandeer_Characters`** is the headless data layer. It writes
  `…\_retail_\WTF\Account\<ACCOUNT>\SavedVariables\Warbandeer_Characters.lua` — the file this app
  parses. This is the addon that must be installed.
- **`Warbandeer`** is the in-game viewer, and lists `Warbandeer_Characters` among its dependencies,
  so installing it pulls the data layer in. That's why "install Warbandeer" is the usual instruction.

Both also depend on `LibNAddOn` and `LibNUI` from the same repo.

**Log into each character at least once** after installing it. The game writes SavedVariables only
when it writes them — at logout or `/reload` — so a character you haven't played since installing
isn't in the file at all, and one you haven't played since the weekly reset still carries last week's
numbers. Hence the "as of" times on the Warband views, and why characters not seen since the reset
are marked as such instead of being shown as though their vault were current.

**Windows only.** Addon discovery walks fixed install paths — `\Program Files (x86)\World of
Warcraft`, `\Program Files\World of Warcraft`, `\World of Warcraft` and `\Games\World of Warcraft`,
on drives `C:` through `F:` (`candidate_roots()` in
[`src-tauri/src/warband.rs`](src-tauri/src/warband.rs)). An install anywhere else isn't found. Only
this tab is affected — nothing else in the app cares where WoW lives.

### 3. Connecting a Battle.net account — optional, and nothing uses it yet

**Settings → Connect account** runs an OAuth **authorization-code** flow for account-wide data. It
needs `http://localhost:48757/callback` on your developer client's **Redirect URLs** — step 5 of
_Getting a Client ID & Secret_ below, where the exact-match rule is spelled out.

A connection lasts about **24 hours**. Blizzard issues **no refresh token** for this grant — the
token response carries only the token, its `scope`, `sub` and `token_type`, with `expires_in=86399` —
so reconnecting periodically is the documented behaviour rather than a fault.

**Nothing consumes it yet.** The plumbing landed before the views that will use it, so connecting
today changes nothing you can see; the first consumer (the account's own character index) is still
open work — issue [#175](https://github.com/roshne/wow-companion/issues/175). It's documented here
because the button is visible in Settings and ought to be explicable.

## Run it

```bash
npm install
```

**As a standalone app** (recommended) — build a release executable and launch it, with no dev
server or terminal attached:

```bash
npm run app          # build the exe, then launch it
# or run the two steps separately:
npm run build:exe    # -> src-tauri/target/release/wow-companion.exe
npm run launch       # start the last-built exe (detached)
```

Start it with `npm run app` (or by double-clicking `src-tauri/target/release/wow-companion.exe`);
stop it by closing its window. **WebView2** is required — it ships with Windows 11.

**Don't want to build locally?** Every push to `main` builds the executable in CI. Download the
latest from the [**Build app**](../../actions/workflows/build.yml) workflow → newest run →
**Artifacts → `wow-companion-windows`**. No toolchain needed.

**Dev mode** (hot reload while hacking on the UI; needs the Rust toolchain + WebView2):

```bash
npm run tauri dev
```

Then, in the app: paste a **Client ID / Secret** (see _Getting a Client ID & Secret_ below) →
_Save to keychain_ → pick a **region** → explore the **WoW Token**, **Realm Status**,
**Character**, and **Guild** tabs.

Build the Windows installer (NSIS) + updater artifacts:

```bash
npm run build:installer   # -> src-tauri/target/release/bundle/nsis/*_x64-setup.exe
```

The app **auto-updates**: on launch it checks the latest GitHub Release and, if a newer signed
version exists, offers an in-place install. The installer is currently unsigned, so Windows
SmartScreen may warn on first run (**More info → Run anyway**). Cutting a release (`npm run bump` →
tag → the release workflow drafts a GitHub Release) and signing-key setup are in
[`docs/updater.md`](docs/updater.md).

## Getting a Client ID & Secret

1. Go to **[develop.battle.net](https://develop.battle.net/)** and log in with your Battle.net account.
2. Ensure your account has an **Authenticator** attached — two-factor auth is required for API access.
3. Accept the **Blizzard Developer API Terms of Use** if prompted.
4. Open **[API Access → Clients](https://develop.battle.net/access/clients)** and click **Create Client**.
5. Fill in:
   - **Client Name** — anything, e.g. `wow-companion`.
   - **Redirect URLs** — enter exactly:

     ```
     http://localhost:48757/callback
     ```

     This is only needed to **connect your Battle.net account** (for account-wide data); every other
     tab uses client credentials and no redirect at all. Blizzard matches this string **exactly** and
     accepts only `http`/`https`, so the port can't be changed or chosen at runtime — if it doesn't
     match, the consent screen refuses before it ever redirects back. Already created a client with a
     placeholder here? Edit it and add this URL.

   - **Intended Use / Service URL** — optional; describe it (e.g. "personal WoW dashboard").
6. Click **Create**, then open the client to copy its **Client ID** and **Client Secret**.
7. In WoW Companion, paste both and click **Save to keychain** — the secret is stored by Rust in your OS
   keychain and never leaves your machine.

> Only ever paste the secret into the app's own field. You can regenerate it anytime from the same page.

## Layout

```
src/                     # React frontend
  App.tsx                # app shell: credentials gate, region picker, tab nav
  components/            # per-tab UIs — CharacterDetail (+ PaperDoll / ItemPopover),
                         #   AuctionHouse, Warband (+ WarbandGearBoard), TokenPrice, RealmStatus,
                         #   BotOps (operator-only), …
  lib/                   # data + logic — queries (TanStack Query), gearCheck / gearFix,
                         #   useWarbandGear, region resolution, persistence, hooks, botops (re-export)
  lib/bnet.ts            # builds the typed client (token from Rust, fetch via Tauri HTTP)
  vendor/battlenet-wow-client/   # vendored typed client (generated types + auth + factory)
  vendor/bot-ops/        # vendored shared module (frontend half) — nazumods/wow apps/bot-ops
src-tauri/               # Rust backend
  src/lib.rs             # keychain + OAuth token commands
  src/warband.rs         # Warbandeer SavedVariables parser (sandboxed mlua VM)
  vendor/bot-ops/        # vendored shared module (Rust half) — the SSH ops commands
  capabilities/          # HTTP scope for *.api.blizzard.com
```

## Status

**Stable (1.1.0).** Compiles end-to-end (`cargo check` + `tsc` + `vite build` all pass), the test suite
is green, and every tab is live. Response bodies for the endpoints the app uses are typed by the
vendored client — captured upstream and re-vendored through the `battlenet-api-research` pipeline — so
data flows through the typed client end-to-end. Exercising the live data views needs your Battle.net
credentials (see above); the Warband tab needs none.

1.1 mines the local addon database far deeper than 1.0 did: the parser went from 14 fields to also
reading wealth, currencies, the Great Vault, lockouts, keystones and titles, and four new Warband
views were built on top. Figures sourced from the addon show when they were last scanned — the file
is only written when the game writes it, so a character not played since the weekly reset carries
last week's numbers, and the views say so rather than implying otherwise.

The footer reads `v1.1.0 (9502198)` — the version plus the commit it was built from, so two builds of
the same version are still tellable apart (`-dirty` marks a build made with uncommitted changes).
