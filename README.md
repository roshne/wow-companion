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

- **WoW Token** — the current token price.
- **Realm Status** — every connected realm's status (UP/DOWN), population, and login queue, with a filter.
- **Character** — look up a character's profile summary (level, race/class/spec, faction, guild, item
  level, achievements) plus avatar, by realm + name.
- **Guild** — look up a guild by realm + name: a summary card (faction, member count, achievement
  points) and a sub-tabbed detail — a sortable **roster** (name/class colour, rank, level, race,
  class, realm), guild **achievements**, and recent **activity**.
- **Warband** — a warband-wide roster (name, class colour, level, item level, spec, professions for
  every alt) read locally from the [Warbandeer](https://github.com/nazumods/wow) addon — no API call.

The first four tabs are typed by the vendored Web API client, and the region (US/EU/KR/TW) is
switchable in the header.

### Warband tab — local addon data

The Warband tab reads the `Warbandeer_Characters` addon's SavedVariables
(`…\_retail_\WTF\Account\<ACCOUNT>\SavedVariables\Warbandeer_Characters.lua`) — a Lua table the addon
rewrites each login. The Rust backend locates the newest such file across installed accounts and
parses it in a sandboxed embedded Lua VM (`mlua`). It needs the
[Warbandeer](https://github.com/nazumods/wow) addon installed and logged into at least once; no
Battle.net credentials are involved.

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
SmartScreen may warn on first run (**More info → Run anyway**). Signing-key setup and what's deferred
to the release workflow (#45) are in [`docs/updater.md`](docs/updater.md).

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
  components/            # TokenPrice, RealmStatus, CharacterLookup, GuildLookup
  lib/bnet.ts            # builds the typed client (token from Rust, fetch via Tauri HTTP)
  lib/types.ts           # local response shapes (the spec omits response schemas)
  vendor/battlenet-wow-client/   # vendored typed client (generated types + auth + factory)
src-tauri/               # Rust backend
  src/lib.rs             # keychain + OAuth token commands
  capabilities/          # HTTP scope for *.api.blizzard.com
```

## Status

Compiles end-to-end (`cargo check` + `tsc` + `vite build` all pass) and the UI renders. Response
bodies are cast from local types (`lib/types.ts`) because the OpenAPI spec omits response schemas —
once those are captured upstream and re-vendored, responses become fully typed with no UI changes.
Exercising the live data views needs your Battle.net credentials (see above).
