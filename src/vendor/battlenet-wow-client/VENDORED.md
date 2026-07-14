# Vendored: battlenet-wow-client

This directory is a **vendored copy** of the `client/` package from
[`roshne/battlenet-api-research`](https://github.com/roshne/battlenet-api-research) (commit `a2fdc54`).

Only the import specifiers were changed (extensionless, for Vite/bundler resolution). Do not hand-edit
the logic here — update it upstream in `battlenet-api-research`, then re-vendor:

1. In `battlenet-api-research/client`: `npm run generate && npm run build`.
2. Copy `client/src/{auth.ts,client.ts,index.ts,generated/schema.d.ts}` here.
3. Change relative imports back to extensionless (`./auth`, `./client`, `./generated/schema`).

`generated/schema.d.ts` is itself generated from the repo's OpenAPI spec
(`openapi/battlenet-wow.openapi.json`). Response bodies are `unknown` until response schemas are
added to that spec.
