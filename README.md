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
- **Warband** — a warband-wide roster (name, class colour, level, item level, spec, professions for
  every alt) read locally from the [Warbandeer](https://github.com/nazumods/wow) addon — no API call —
  plus a **gear board**: a characters × slots item-level matrix that streams in row by row,
  sorts/filters by item level / issues / class / role, and shows a warband-wide **"needs attention"**
  gear-fix roll-up.
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
parses it in a sandboxed embedded Lua VM (`mlua`). It needs the
[Warbandeer](https://github.com/nazumods/wow) addon installed and logged into at least once; no
Battle.net credentials are involved.

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
   - **Redirect URLs** — required by the form but unused by this app (it uses client-credentials only);
     enter `https://localhost`.
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
                         #   useWarbandGear, region resolution, persistence, hooks, botops (SSH ops)
  lib/bnet.ts            # builds the typed client (token from Rust, fetch via Tauri HTTP)
  vendor/battlenet-wow-client/   # vendored typed client (generated types + auth + factory)
src-tauri/               # Rust backend
  src/lib.rs             # keychain + OAuth token commands
  src/warband.rs         # Warbandeer SavedVariables parser (sandboxed mlua VM)
  src/botops.rs          # operator-only: manage the warbandeer-discord bot over SSH
  capabilities/          # HTTP scope for *.api.blizzard.com
```

## Status

**Beta (0.5.0).** Compiles end-to-end (`cargo check` + `tsc` + `vite build` all pass), the test suite
is green, and every tab is live. Response bodies for the endpoints the app uses are now typed by the
vendored client — captured upstream and re-vendored through the `battlenet-api-research` pipeline — so
data flows through the typed client end-to-end. Exercising the live data views needs your Battle.net
credentials (see above). Heading to **1.0** after a couple of clean installs.
