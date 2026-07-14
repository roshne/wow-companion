# WoW Companion

A small **desktop app** (Tauri v2 + React/TypeScript) for the Battle.net → World of Warcraft
**Web REST API**. It's the downstream *consumer* of
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

## Run it

```bash
npm install
npm run tauri dev        # launches the desktop app (needs Rust + WebView2)
```

Then, in the app: paste a **Client ID / Secret** (create one at
`develop.battle.net/access/clients`) → *Save to keychain* → *Test token* / *Load WoW Token price*.

Build a distributable:

```bash
npm run tauri build
```

## Layout

```
src/                     # React frontend
  App.tsx                # settings + demo UI
  lib/bnet.ts            # builds the typed client (token from Rust, fetch via Tauri HTTP)
  vendor/battlenet-wow-client/   # vendored typed client (generated types + auth + factory)
src-tauri/               # Rust backend
  src/lib.rs             # keychain + OAuth token commands
  capabilities/          # HTTP scope for *.api.blizzard.com
```

## Status

Scaffold: compiles end-to-end (`cargo check` + `tsc` + `vite build` all pass). Response bodies are
typed `unknown` until response schemas are added upstream to the OpenAPI spec. A real run needs your
Battle.net credentials.
