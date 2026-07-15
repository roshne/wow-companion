# Vendored: battlenet-wow-client

This directory is a **vendored copy** of the `client/` package from
[`roshne/battlenet-api-research`](https://github.com/roshne/battlenet-api-research) (commit `30a0e18`).

Only the import specifiers were changed (extensionless, for Vite/bundler resolution). Do not hand-edit
the logic here — update it upstream in `battlenet-api-research`, then re-vendor:

1. In `battlenet-api-research/client`: `npm run generate && npm run build`.
2. From this repo: `npm run re-vendor`.

`npm run re-vendor` copies `client/src/{auth.ts,client.ts,index.ts,generated/schema.d.ts}` here and
rewrites relative imports to extensionless (`./auth`, `./client`, `./generated/schema`). It defaults to
`../battlenet-api-research`; override with a path argument (`npm run re-vendor -- <path>`) or the
`BNET_RESEARCH_DIR` env var. See [`scripts/re-vendor.mjs`](../../../scripts/re-vendor.mjs).

`generated/schema.d.ts` is itself generated from the repo's OpenAPI spec
(`openapi/battlenet-wow.openapi.json`). Response bodies are `unknown` until response schemas are
added to that spec.
