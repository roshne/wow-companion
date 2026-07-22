# Vendored: wow-static-data

`static-data.json` is a **vendored copy** of the currency lookup bundle published by
[`nazumods/wow`](https://github.com/nazumods/wow). Do not hand-edit it — it is generated
upstream from [wago.tools](https://wago.tools) DB2 data by
`Tooling/update-static-data.ps1` and attached to a GitHub release.

## Why this exists

WoW stores currency *amounts* keyed by id; the name, icon and cap live in DB2. The Blizzard
Game Data API has **no currency endpoint**, so unlike achievements, titles, reputations or
mounts, this is the one lookup that cannot be resolved through the REST client — it has to
come from DB2. `nazumods/wow` already runs that generator on a schedule, so this repo
consumes the published artifact rather than duplicating the pipeline.

## Updating

```sh
npm run vendor:static-data     # fetch the newest bundle, write if changed
npm run check:static-data      # report only — never writes
```

`check:static-data` fetches and validates entirely in memory; it never touches the working
tree. That matters because this repo is a shared checkout — a routine that vendored on a
schedule would leave the tree dirty and silently stall `wow-companion-build`, which skips
any tick with uncommitted changes. Detection is automated; **writing is always a human
action on a clean tree.**

Its exit codes are a contract, consumed by the `wow-staticdata-watch` scheduled routine:

| Code | Meaning | Actionable |
|---:|---|---|
| 0 | Up to date | no |
| 1 | A newer bundle is available | **yes** — run `vendor:static-data` |
| 2 | Nothing published yet / no asset on the release | no — stay silent |
| 3 | Fetch or validation failed | **yes** — something is broken |

Codes 1 and 2 are deliberately distinct: before the first bundle is published, a single
non-zero code would make the watch fire a false "update available" every run.

Fetching happens at **development time** and the result is committed — the same contract as
the `battlenet-wow-client` vendoring beside it. The build never touches the network, and the
shipped app never depends on a release staying reachable.

## Release contract

| | |
|---|---|
| Source repo | `nazumods/wow` (public — no auth needed) |
| Tag | `app-static-data-v<build>-<sha8>` |
| Asset | `static-data.json` |

Two upstream details this depends on:

- The **`app-` prefix is load-bearing.** `nazumods/wow`'s CurseForge publisher skips every
  tag starting with `app-`, which is why data releases are named this way.
- The releases are published with **`latest=false`**, so `/releases/latest` will not find
  them. The newest is resolved by listing releases and taking the first tag with the prefix
  (the API returns them newest-first).

## Shape

```jsonc
{
  "build": "12.0.7.68453",     // client build the data came from
  "buildDate": "2026-07-06",
  "currencies": {
    "1792": {
      "name": "Honor",
      "icon": "achievement_legionpvptier4", // bare icon name, or null
      "maxQty": 15000,                      // 0 = uncapped
      "quality": 3
    }
  }
}
```

`icon` is `null` for the majority of rows — roughly 916 of 1,490 currencies carry no icon in
DB2 at all. That is expected, not a fetch failure; render a fallback rather than treating it
as an error.
