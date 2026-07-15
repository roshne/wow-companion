# Roadmap research — M2–M5 + cross-cutting

Research feeding the milestones in [#1](https://github.com/roshne/wow-companion/issues/1). For each
remaining item: a concrete recommended approach for **this** stack, an effort estimate, key
risks/decisions, and sources. Grounded in the codebase (commit at time of writing after #18) and
current (2026) docs for Tauri v2 / React 19 / TanStack Query v5. **Effort:** S ≈ hours, M ≈ a day or
two, L ≈ multi-day.

> This is a planning aid, not a spec — verify version-specific details (flagged inline) at
> implementation time.

## Current state (grounding)

- **Stack:** Tauri v2 + React 19 + TS, Vite 7. Hand-rolled CSS (`src/App.css`), no UI framework.
- **Data:** vendored typed `battlenet-wow-client` (openapi-fetch). Requests go through the **Tauri HTTP
  plugin (Rust)**, not the webview — so response headers are readable and there's no webview CORS.
  OAuth token exchange happens **in Rust** (`src-tauri/src/lib.rs`); the secret lives in the OS
  keychain and never reaches the webview.
- **API typing:** 189 of 216 GET endpoints are typed from captured samples (#14–#17). This directly
  enables most of M3.
- **UI:** four tabs — WoW Token, Realm Status, Character Lookup, Warband. Fetching is ad-hoc
  `useState`/`useEffect`; errors are crammed into status strings. No client persistence layer.
- **Backend:** `keyring` compiled `windows-native` only; token cache is an in-memory `Mutex<Option<…>>`
  with a 60s expiry skew; token URL hardcoded to `oauth.battle.net`. CSP is `null`. Distribution is
  greenfield (no updater/store plugins, no signing, placeholder icons, `version 0.1.0` duplicated
  across `package.json` / `tauri.conf.json` / `Cargo.toml` with no sync).

## At a glance

| Item                                | Milestone | Effort   | Notes                                            |
| ----------------------------------- | --------- | -------- | ------------------------------------------------ |
| TanStack Query adoption (#19)       | M2        | M        | Foundation for the rest of M2                    |
| 429 backoff + retry (#20)           | M2        | S        | Plugs into the QueryClient                       |
| Error boundary per view (#20)       | M2        | S        | Plugs into TanStack error contract               |
| Persist region + recent chars (#22) | M2        | S        | Independent; shared storage helper               |
| Detect 401 → re-auth (#21)          | M2        | S–M      | Frontend + small Rust touch                      |
| Realm table + slug autocomplete     | M3        | S        | Fields already fetched; one cached list          |
| Favorites                           | M3        | S        | Shared localStorage helper                       |
| Token price history + sparkline     | M3        | S–M      | Must self-accumulate; hand-rolled SVG            |
| Character detail                    | M3        | M        | Endpoints typed (except M+ per-dungeon)          |
| Guild lookup                        | M3        | M        | Roster table ≈ Warband clone                     |
| Auction house browser               | M3        | L        | Virtualization + item-name cache                 |
| Loading/empty/toasts                | M4        | M        | State-model refactor across 4 tabs               |
| Class/faction colors + render image | M4        | S–M      | Color map already in repo; couple w/ CSP         |
| Manual light/dark toggle            | M4        | S        | CSS-selector refactor of existing tokens         |
| Real app icons                      | M4        | S        | One command + a source PNG                       |
| Tighten CSP                         | Cross     | S–M      | Mostly just `img-src` for render hosts           |
| Component + Rust tests              | Cross     | M        | Greenfield harness (RTL/jsdom, cargo test)       |
| Signed installer + updater          | M5        | L        | Long pole: acquiring a signing identity          |
| Release workflow + version bump     | M5        | M        | tauri-action + a bump script                     |
| Cross-platform keychain + CN region | M5        | S–M each | Cargo features; CN needs a Rust token-URL branch |

**Recommended sequence** is at the [end](#recommended-build-sequence).

---

## M2 — Reliability & data layer

Two structural facts drive this milestone: **openapi-fetch never throws** (it returns
`{data, error, response}`), and requests go through Rust so **all response headers are visible**.
Define one shared error type — `BnetError` carrying `response.status` + a parsed `Retry-After` — and a
`unwrap()` helper that throws on `!response.ok`. It's consumed by all three of query error-state,
retry gating, and error-boundary routing.

### #19 — Adopt TanStack Query · **M**

**Approach.** Install `@tanstack/react-query` v5 (React 19 is a supported peer). One module-singleton
`QueryClient`, `QueryClientProvider` in `main.tsx`. **Do not** use `openapi-react-query` — its queryKey
(`[method, path, params]`) omits the host, which is a silent cache-collision bug given the per-region
`baseUrl`. Use a thin manual `queryFn` over `bnet.api.GET` + the `unwrap()` helper. **Put `region` in
every queryKey** (`["token", region]`, `["character", region, realm, name]`) — this alone makes region
switching correct (independent per-region caches, instant re-show, no refetch until stale) and replaces
the current `useEffect(…, [bnet])` pattern. Suggested defaults: `staleTime` ~5 min for token/realms,
~60 s for characters (the biggest lever for staying under rate limits); `gcTime` ~30 min;
`refetchOnWindowFocus: false` (desktop). Model the user-triggered reads (TokenPrice, CharacterLookup)
as `enabled`-gated queries + `refetch()`, not mutations; CharacterLookup's avatar is a dependent query;
RealmStatus's pagination loop stays one query (or `useInfiniteQuery`).

**Watch out for.** Forgetting to `throw` (query holds an error body as "success"); v5 errors if `data` is
`undefined`; **region left out of any queryKey → cross-region data bleed** (make it a review checkpoint);
StrictMode double-invokes queryFns in dev (expected).

Sources: [TanStack important-defaults](https://tanstack.com/query/v5/docs/framework/react/guides/important-defaults),
[query-functions](https://tanstack.com/query/v5/docs/framework/react/guides/query-functions),
[openapi-react-query](https://openapi-ts.dev/openapi-react-query/) (why _not_ to use it here).

### #20 — 429 backoff + retry · **S**

**Approach.** Primary policy in the `QueryClient`: `retry` predicate that retries only 429 + 5xx (never
401/403/404) up to ~4 attempts; `retryDelay` that **honors `Retry-After` exactly when present**
(parse both delta-seconds _and_ HTTP-date per RFC 9110), else capped exponential backoff with full
jitter (`min(1000·2^n, 30_000) + random`). TanStack's own default is the same exp-backoff minus jitter.
Add a **transport-layer retry middleware** in `client.ts` only for RealmStatus's pagination — TanStack
retries re-run the _whole_ queryFn, so a 429 on page 12 would refetch all 12 pages; a middleware retries
just the failing page.

**Watch out for.** **Uncertain whether Blizzard sends `Retry-After` on 429** — design to honor if present,
fall back to backoff if not. Retrying the paginated queryFn multiplies requests against the very quota
you're protecting (the argument for the middleware). Ensure the auth middleware + retry compose (token
refreshed per attempt).

Sources: [query-retries](https://tanstack.com/query/v5/docs/framework/react/guides/query-retries),
[MDN Retry-After](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Retry-After).

### #20 — React error boundary per view · **S**

**Approach.** Error boundaries are **still class-based in React 19** (no hook equivalent; React 19 only
added root `onCaughtError`/`onUncaughtError` options). Use `react-error-boundary` v6 and wrap the tab
switch with `resetKeys={[tab, region]}` (auto-reset on navigation). Wrap with TanStack's
`QueryErrorResetBoundary` so "Try again" actually refetches. Route **only unexpected/systemic** query
failures to the boundary via per-query `throwOnError: true`; keep expected inline failures (the existing
404 "character not found") as in-component `error` state.

**Watch out for.** Boundaries don't catch event-handler/async errors outside render — the on-demand
fetches only reach the boundary once surfaced through a `throwOnError` query. Without
`QueryErrorResetBoundary`, a failed `throwOnError` query won't refetch on retry (known footgun). Verify
`react-error-boundary` v6 hook names against the installed version.

Sources: [QueryErrorResetBoundary](https://tanstack.com/query/v5/docs/framework/react/reference/QueryErrorResetBoundary),
[react-error-boundary](https://github.com/bvaughn/react-error-boundary),
[React 19 boundaries still class-based](https://andrei-calazans.com/posts/react-19-error-boundary-changed/).

### #21 — Detect 401 → re-enter credentials · **S–M**

**Approach.** On a 401 from a data call (invalid/expired secret), clear the stored secret and route back
to the connect form instead of failing silently. The `BnetError` from #19 already carries status; a
global handler (QueryCache `onError`, or the error boundary) can call the existing `clear_credentials`
Rust command + flip the app's `hasCreds` state. Small Rust touch only if you want a distinct "secret
rejected" vs "no secret" signal.

**Watch out for.** Distinguish a 401 (bad secret) from a transient token-fetch failure; don't nuke
credentials on a network blip. The token is cached in Rust — invalidate it too on 401.

### #22 — Persist last region + recent characters · **S**

**Approach.** For this small, low-write payload, **`localStorage` is the pragmatic default** — and
crucially it's **synchronous**, so you can seed `useState(() => localStorage.getItem("region") ?? "us")`
and open on the right region with no flash. The Tauri **Store plugin** (`@tauri-apps/plugin-store`) is
the upgrade path if you later want a file in the app-config dir, Rust-side access, or durability beyond
webview cache — but it's async (needs a load gate) and requires a Cargo dep + `store:default` capability.
MRU pattern: dedupe-and-move-to-front, cap ~8, key by `{region, realmSlug, name}`. Store character
_identity_, not the fetched profile (re-fetch via TanStack). Put it in one `lib/persist.ts` so swapping
backends is a one-file change — **this module is shared with M3's token-history and favorites**.

**Watch out for.** localStorage can be wiped by clearing webview data (use Store if it must be durable —
esp. Linux/WebKitGTK, flagged as uncertain). Validate persisted values on read. Store plugin needs the
capability permission or calls fail at runtime.

Sources: [Tauri Store plugin](https://v2.tauri.app/plugin/store/),
[MDN localStorage](https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage).

---

## M3 — Features

All endpoints below are **typed** unless noted. Namespaces via `bnet.namespace(...)`; character/profile
calls send `locale=en_US` (flat name strings), the connected-realm **search** does not (name _objects_ —
must read via `loc()`).

### Realm table enhancements + slug autocomplete · **S**

**Approach.** **Zero new API calls** for the table: the connected-realm **search** response RealmStatus
already paginates embeds per realm `timezone`, `category`, and `type` (`{type, name}` = Normal/RP) — just
surface fields already in `cr.realms[]` (read with `loc()`). Autocomplete: fetch `/data/wow/realm/index`
once (full `{name, slug}` list), cache it, filter as the user types, submit the `slug`. Replaces the
current "must know the slug transform" UX in Character/Guild inputs. A `<datalist>` or small dropdown —
no library.

**Watch out for.** Search returns localized name **objects** — `loc()`, not raw string access.
`realm/index` (flat) vs `connected-realm/search` (grouped w/ status) are different granularities.

### Favorites (pin characters/realms) · **S**

**Approach.** Client state + the shared `lib/persist.ts` (localStorage). Pin/star toggle on cards/rows; a
"Favorites" strip for one-click re-lookup. Key by `{region, realmSlug, name}` (region-scoped).

**Watch out for.** Stale pins (a favorited character that later 404s) — show and allow removing dead
entries. Share the storage helper with token-history (don't invent two schemes).

### WoW Token price history + sparkline · **S–M**

**Approach.** History must be **self-accumulated** — the endpoint returns only the current price. On each
fetch append `{timestamp, price}` to a capped ring-buffer in localStorage, **deduping on the server's
`last_updated_timestamp`** (updates ~every 20 min). Sparkline: hand-rolled inline SVG `<polyline>`
(~15 lines, zero deps, themeable) — matches the app's dependency-light posture. Add a periodic/on-focus
capture so points accrue even off-tab.

**Watch out for.** Fresh installs show an empty sparkline until points collect — design an honest
"collecting history…" empty state. Dedupe on `last_updated_timestamp`, not wall-clock. Cap the series.

### Character detail · **M**

**Approach.** Extend CharacterLookup into a detail view with sub-tabs (Overview / Gear / M+ / PvP /
Professions), fetching each sub-resource **lazily per sub-tab** (avoid a 6-call burst). All endpoints
typed: `.../equipment` (per-slot item, quality, stats, sockets, enchants), `.../specializations`,
`.../statistics`, `.../achievements`, `.../mythic-keystone-profile` (overall `current_mythic_rating`),
`.../pvp-summary` (honor/BG maps), `.../professions`. Overview is nearly free (item level + achievement
points are in the summary already used). Color gear by `quality.name` (reuse the class-color pattern).

**Watch out for.** **M+ per-dungeon best runs (`.../mythic-keystone-profile/season/{seasonId}`) is
untyped** (`content?: never`) — overall rating works; per-dungeon detail needs hand-typing a live sample
or deferral. Rated PvP brackets (2v2/3v3/RBG) are **not** in `pvp-summary` — need `.../pvp-bracket/{b}`
(verify typed). Lazy-load sub-resources.

### Guild lookup (roster + achievements) · **M**

**Approach.** Input mirrors CharacterLookup (reuse `lib/slug.ts` for the `nameSlug`). Summary card
(member count, achievement points, faction color) + a sortable roster table ≈ a clone of `Warband.tsx`
(reuse its sort machinery + `CLASS_COLORS`). Endpoints typed: guild summary, `.../roster`,
`.../achievements`, `.../activity`.

**Watch out for.** Roster returns class/race as **IDs, not names** — need an id→name/color map (or
`/data/wow/playable-class/{id}`, static+typed). Large guilds return hundreds of members in one
un-paginated array — sort/filter client-side; virtualize if 500+ rows.

### Auction house browser · **L**

**Approach.** The milestone's heaviest feature. **Virtualize** the list — `@tanstack/react-virtual`
(headless, variable-size, maintained; not `react-window`). **Item-name resolution is the core problem:**
auctions return only `item.id` with no name and there's **no bulk item endpoint** — resolve only the IDs
in the current viewport via `/data/wow/item/{id}` (static, effectively immutable → **cache resolved items
in a persistent local store indefinitely**), dedupe in-flight, and aggregate rows by `item.id` first
(min buyout / total qty) so you resolve far fewer names. Model realm auctions (`buyout`/`bid`,
`bonus_lists`) and region-wide commodities (`unit_price`, stackable) as two distinct modes.

**Watch out for.** A full-realm auctions payload is very large (tens of thousands of rows) — parse/hold
once, never re-fetch per interaction; Blizzard regenerates AH data ~hourly so cache the snapshot.
Item-name resolution against 100 req/s · 36k/hr is the real constraint — viewport-only + persistent
static cache. Prices are copper (÷10,000 = gold, as `TokenPrice` already does).

Sources: [TanStack Virtual](https://github.com/TanStack/virtual); endpoint typing confirmed against the
captured schemas in `battlenet-api-research/openapi/responses/`.

**M3 build order:** shared `lib/persist.ts` first (unblocks token-history + favorites) → realm
table/autocomplete (near-free, improves Character/Guild inputs) → character detail + guild (shared table
patterns) → auctions last (its own subsystem).

---

## M4 — Polish & UX

### Loading skeletons, empty states, error toasts · **M**

**Approach.** Add **`sonner`** (~3–4 KB, one `<Toaster />` mounted once in `App.tsx`, imperative
`toast.error()`); route the tab components' `catch` blocks there instead of the `setSub("Error: …")`
strings. Keep inline `sub` for _non-error_ status only. Skeletons: pure CSS `.skeleton` class (gradient +
`@keyframes shimmer`) reusing the existing `--card`/`--border` tokens; a tiny `<Skeleton>` helper.
Standardize Warband's empty-state pattern into a shared `<EmptyState>`. Distinguish not-loaded (skeleton)
/ loaded-empty (empty state) / error (toast).

**Watch out for.** Don't double-report (toast _or_ inline, not both). Mount `<Toaster />` once, above the
tabs. Respect `prefers-reduced-motion` for the shimmer. Drive sonner's `theme` prop from the toggle
(item below).

Sources: [sonner](https://github.com/emilkowalski/sonner).

### Class/faction colors + full character render image · **S–M**

**Approach.** The canonical 13-class color map **already exists** in `Warband.tsx` (byte-for-byte the
Warcraft-wiki set) — extract to `src/lib/wow.ts` and reuse in CharacterLookup (key off
`character_class.id` 1–13, or normalize the name). For the render image, CharacterLookup currently pulls
only the `avatar` asset from `character-media`; the `assets` array also carries **`main`** (full-body JPG,
class-colored bg) and **`main-raw`** (full-body PNG, transparent bg — best for compositing). Swap to
`main-raw → main → avatar` with fallback. Hosts: `render.worldofwarcraft.com` + regional
`render-*.worldofwarcraft.com` — **this host must be in the CSP `img-src`** (couple with the CSP item).
Faction colors aren't an API constant — define your own Alliance-blue / Horde-red tokens (`faction.type`
= `ALLIANCE`/`HORDE`).

**Watch out for.** `main`/`main-raw` may be **absent** for some characters (keep the fallback chain).
Priest color is pure white `#FFFFFF` — needs an outline/darker fallback on the light theme. Full-body
renders are tall — new layout class, don't stretch the 84px avatar slot. Use the **updated** (Dragonflight+)
hexes, not legacy Mage/Warlock values. _Uncertain:_ Blizzard's render docs are JS-rendered (couldn't be
quoted verbatim) — verify `main-raw` presence against a live response before relying on it.

Sources: [Class colors (warcraft.wiki.gg)](https://warcraft.wiki.gg/wiki/Class_colors), repo `Warband.tsx`.

### Manual light/dark theme toggle · **S**

**Approach.** Today `App.css` puts dark tokens in a single `@media (prefers-color-scheme: dark)` block.
Convert to tri-state: move dark tokens to `:root[data-theme="dark"]`, keep a media query scoped to
`:root[data-theme="system"]` so "system" still auto-follows the OS, light stays the `:root` default. A
small hook in `App.tsx` reads the saved choice from localStorage (default `system`), sets
`document.documentElement.dataset.theme`, persists on change. A segmented control in the appbar. Feed the
resolved theme to sonner's `<Toaster theme>`.

**Watch out for.** Avoid first-paint flash (set `data-theme` via a tiny inline script in `index.html`
before hydration, or accept one frame). "System" must live-update on OS change (the scoped media query
handles it). Don't theme the intentionally-fixed class/faction colors.

### Real app icons · **S**

**Approach.** Provide one **1024×1024 RGBA** source PNG and run `npm run tauri icon <source.png>`. The
`src-tauri/icons/` set and `tauri.conf.json` `bundle.icon` paths are **already wired** (placeholder
icons) — the command overwrites in place; no config change. Only real work is the artwork.

**Watch out for.** Source must be square + have alpha. The generated `.ico` must include a 256px layer
(the command handles it). Commit the regenerated binaries (ensure `.gitattributes` treats them as binary
— they are by default).

Sources: [Tauri icons](https://v2.tauri.app/develop/icons/).

---

## M5 — Distribution

Greenfield: no updater/store plugins, no signing, `version 0.1.0` in three files with no sync.

### Signed installer + updater · **L**

**Approach.** Drop `--no-bundle` for releases; target **NSIS** (`"targets": ["nsis"]`,
`nsis.installMode: "perUser"` to match the current no-admin posture), set
**`bundle.createUpdaterArtifacts: true`** (emits the `.sig` files). Add `@tauri-apps/plugin-updater`
(register in `lib.rs`, `updater:default` capability, `plugins.updater` config with `pubkey` + a GitHub
Releases `latest.json` endpoint). Generate the **updater keypair** (`tauri signer generate`) — this is
**separate** from the Authenticode code-signing cert and is mandatory (the updater refuses unsigned
artifacts). Build with `TAURI_SIGNING_PRIVATE_KEY[_PASSWORD]`. Code signing: either a traditional OV/EV
cert (`bundle.windows.certificateThumbprint` + `digestAlgorithm: "sha256"` + `timestampUrl`) or **Azure
Trusted/Artifact Signing** via the v2 `signCommand` (~$10/mo, HSM-managed, nothing to custody).

**Watch out for.** **Updater private-key custody is catastrophic if lost** — installed clients trust only
the embedded `pubkey`; back it up offline + GitHub secrets, never in the repo. `createUpdaterArtifacts`
must be on or no `.sig` is emitted (silent). The installer the updater launches must **also** be
Authenticode-signed or the update triggers UAC/SmartScreen mid-update. Unsigned/fresh-OV installers hit
SmartScreen. macOS updater would additionally need notarization (out of scope while Windows-only).

Sources: [Windows installer](https://v2.tauri.app/distribute/windows-installer/),
[Windows signing](https://v2.tauri.app/distribute/sign/windows/),
[Updater plugin](https://v2.tauri.app/plugin/updater/).

### Release workflow + version bumping · **M**

**Approach.** A **separate** release workflow (keep `build.yml` for dev exes) using
**`tauri-apps/tauri-action`**, triggered on a `v*` tag, `permissions: contents: write`. It builds signed
bundles, creates the GitHub Release, uploads installers + `.sig` + generates `latest.json`. Use
`releaseDraft: true` as a manual gate (the `/releases/latest/…` updater endpoint only resolves once
**published, non-prerelease**). Version bump: a small `npm run version <x.y.z>` script rewriting all three
files + `cargo update -p wow-companion` + commit + tag (`tauri.conf.json` is the canonical version the
action reads for `__VERSION__`).

**Watch out for.** **Version drift** across the three files breaks updater comparisons — add a CI check
asserting they agree. _Uncertain:_ tauri-action's updater-JSON input name has drifted across versions
(`uploadUpdaterJson` vs `includeUpdaterJson`) — pin the action version and check its README. First
release has no updater baseline (matters from v2 onward).

Sources: [GitHub pipelines](https://v2.tauri.app/distribute/pipelines/github/),
[tauri-action](https://github.com/tauri-apps/tauri-action).

### Cross-platform keychain + optional China region · **S–M each**

**Approach (keychain).** Make `keyring` features target-conditional in `Cargo.toml`:
`windows-native` (Windows), `apple-native` (macOS), **`sync-secret-service` + `vendored`** (Linux — sync
D-Bus Secret Service, durable; **not** `linux-native`/keyutils which isn't persisted across reboots). The
existing `Entry`/`get_password`/`set_password` calls are backend-agnostic — **no Rust logic changes**,
only feature wiring + a CI matrix (macOS/Linux runners with the webkit2gtk + D-Bus deps the current
Windows-only CI avoids).

**Approach (CN region).** CN is **not** just another `Region` value — it uses different hosts on **both**
sides: frontend data host `gateway.battlenet.com.cn` (already allowlisted in the HTTP capability; the
`baseUrl` default `${region}.api.blizzard.com` is wrong for CN) **and** the Rust OAuth URL
`oauth.battlenet.com.cn/token` (the hardcoded `TOKEN_URL`). Because tokens come from the Rust command
(not the vendored `TokenManager`), **the token-URL branch must be in Rust** — pass the region into
`get_access_token`. CN needs separate credentials (distinct developer portal); likely a second keyring
account key.

**Watch out for.** **The split-exchange trap:** adding `cn` only to the TS `baseUrl` while leaving Rust's
`TOKEN_URL` global means tokens are minted against `oauth.battle.net` and fail on CN data hosts — must
change Rust. CN needs a CN-registered app (untestable with global creds); reachability from outside China
is unreliable. Linux keychain needs a running Secret Service daemon at runtime — handle "unavailable"
gracefully. _Uncertain:_ keyring feature names are version-specific (these are v3.6.x; v4 renamed them).

Sources: [keyring v3 features](https://docs.rs/crate/keyring/3.6.3/features); CN hosts per repo comments.

**Signing-identity note (external lead time).** Azure Trusted/Artifact Signing is ~$10/mo, HSM-managed,
gives immediate SmartScreen reputation, and has an **individual-developer path** (US/Canada only for
public trust). But enrollment/identity validation can take days–weeks and a rejection forces a pivot to a
purchased cert with different CI plumbing. **Start this acquisition early, in parallel** — it's the true
long pole of M5, independent of code.

---

## Cross-cutting — security & tests

### Tighten the Tauri CSP · **S–M**

**Approach.** Key insight: **almost no data traffic touches the webview stack** — OAuth is Rust/reqwest
and data calls go through the HTTP plugin over IPC to Rust, neither subject to webview CSP `connect-src`.
The only direct webview remote load is the character **`<img>`**. So a tight CSP mainly needs:
`img-src 'self' data: https://*.worldofwarcraft.com` (covers `render` + regional `render-*`),
`connect-src 'self' ipc: http://ipc.localhost` (**required for `invoke()` + the HTTP-plugin IPC bridge**
— _not_ the API hosts), `default-src 'self'`, `script-src 'self'` (Tauri auto-nonces bundled scripts),
`style-src 'self' 'unsafe-inline'` (React inline styles + injected `<style>`). The HTTP-plugin host
allowlist stays in `capabilities/default.json` (already scoped) — separate mechanism from CSP.

**Watch out for.** A strict `csp` also applies during `tauri dev` (Vite on `:1420`, HMR websocket on
`:1421`) — use a relaxed **`devCsp`** allowing `ws://localhost:* http://localhost:*` so HMR isn't broken.
**Omitting `ipc: http://ipc.localhost` from `connect-src` silently breaks every `invoke()`.** _Uncertain:_
confirm the `devCsp` field name against the current v2 schema.

Sources: [Tauri CSP](https://v2.tauri.app/security/csp/), [Tauri security](https://v2.tauri.app/security/).

### Tests — component smoke tests + Rust token-cache · **M**

**Approach (frontend).** Add `@testing-library/react`, `jest-dom`, `user-event`, `jsdom`. Keep the
current node-env `.test.ts` project for lib helpers and add a **jsdom project for `.test.tsx`** via
Vitest 4 **`test.projects`** (the successor to the removed `workspace`) with a `setupFiles` importing
`jest-dom` + `cleanup()`. The tab components take `bnet` as a **prop** → inject a fake client
(`{ api: { GET: vi.fn().mockResolvedValue({data, response:{ok:true}}) }, region, namespace }`) — no
network, no Tauri. Warband/App call `invoke()` directly → `vi.mock("@tauri-apps/api/core")`. Assert
loading → rendered data (token gold value, realm rows, character card).

**Approach (Rust).** The cache-validity check (`now + skew < expires_at`) and credential parsing
(`split_once('\n')`) are inline in the async `get_access_token`. **Extract pure free functions**
(`token_is_fresh(expires_at, now)`, `parse_credentials(&str)`) + a `#[cfg(test)] mod tests` covering
fresh/within-skew/expired/malformed. Runs via `cargo test` — no keychain/network.

**Watch out for.** _Uncertain:_ Vitest 4 config surface shifted (`workspace` removed, `environmentMatchGlobs`
deprecated) — verify `test.projects` against the installed 4.1. Must mock `@tauri-apps/api/core` +
`plugin-http` or tests fail at import. StrictMode double-fires effect loads — assert final state via
`waitFor`, not call counts. `cleanup()` after each test. Keep the fake client loosely typed
(`as unknown as BlizzardClient`) to avoid fighting the OpenAPI generics.

Sources: [RTL setup](https://testing-library.com/docs/react-testing-library/setup/),
[Vitest projects](https://vitest.dev/guide/).

---

## Cross-milestone threads

- **`BnetError` + `unwrap()` contract** (M2) is shared by query error-state, retry gating, and boundary
  routing — define it once, first.
- **`region` in every queryKey** (M2) is the through-line making region switching, per-region quota, and
  MRU/favorites keys all behave.
- **`lib/persist.ts`** (M2 #22) is reused by M3 token-history and favorites — build it once.
- **Render image (M4) ↔ CSP (cross-cutting)** are coupled: enabling `main-raw` adds the
  `render*.worldofwarcraft.com` host the tightened `img-src` must allow — land them together.
- **Class-color map** already exists in `Warband.tsx` — extract to `lib/wow.ts`; reused by Character
  detail and Guild roster.
- **Component test harness** (cross-cutting) is worth standing up alongside the M2 refactor so the
  TanStack migration and new components ship with tests, not after.
- **Version-sync** (M5) touches `package.json` / `tauri.conf.json` / `Cargo.toml` — a bump script + a CI
  guard prevents drift that would silently break the updater.

## Recommended build sequence

1. **M2 foundation:** #19 TanStack Query (with the `BnetError`/`unwrap` contract + region-in-key) → then
   #20 retry + #20 error boundaries plug in → #22 persistence in parallel (builds `lib/persist.ts`) →
   #21 401 handling. Stand up the RTL/jsdom test project here so the refactor is covered.
2. **M3 quick wins:** realm table + slug autocomplete (near-free), favorites + token-history (on the new
   persist helper).
3. **M3 depth:** character detail, then guild lookup (shared table/lookup patterns; extract `lib/wow.ts`).
4. **M4 polish:** toasts/skeletons (pairs with the M2 loading/error refactor), class colors + render
   image **+ CSP together**, theme toggle, real icons.
5. **M3 auctions** (L) — its own subsystem; do when the rest is stable.
6. **M5 distribution:** **start the signing-identity acquisition now, in parallel** (external lead time);
   then version-bump script + tauri-action release workflow + updater; cross-platform keychain + CN as
   discrete follow-ups.
7. **Cross-cutting cleanup:** Rust token-cache test (small, anytime), CSP (with the render image).

## Open decisions & uncertainties

| Question                                                    | Bearing on                                                |
| ----------------------------------------------------------- | --------------------------------------------------------- |
| Does Blizzard send `Retry-After` on 429?                    | #20 backoff design (honor-if-present fallback either way) |
| localStorage vs Store plugin for persistence                | #22, token-history, favorites (start localStorage)        |
| Azure Trusted Signing eligibility (country/region)          | M5 signing — confirm before committing the pipeline       |
| tauri-action updater-JSON input name (version drift)        | M5 release workflow — pin + verify                        |
| keyring feature names if bumping v3→v4                      | M5 cross-platform keychain                                |
| Vitest 4 `test.projects` exact shape                        | Cross-cutting tests                                       |
| `main-raw` availability per character; Tauri `devCsp` field | M4 render image / CSP — verify live                       |

_Sources are linked inline per item. Codebase grounding: `src/`, `src-tauri/`, and the captured schemas
in the sibling `battlenet-api-research` repo._
