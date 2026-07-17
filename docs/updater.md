# Installer & auto-update

WoW Companion ships as a **Windows NSIS installer** and updates itself in place via the
[Tauri updater](https://v2.tauri.app/plugin/updater/). This doc covers how it's wired and the
one-time setup the maintainer needs to do.

## How it works

- `npm run build:installer` (`tauri build --bundles nsis`) produces `…_x64-setup.exe`. With
  `bundle.createUpdaterArtifacts: true` the build also emits the update artifact and a `.sig`
  (a [minisign](https://jedisct1.github.io/minisign/) signature).
- On launch the app calls `checkForUpdate()` ([`src/lib/updater.ts`](../src/lib/updater.ts)), which
  fetches the manifest at `plugins.updater.endpoints` **from Rust** (so it isn't gated by the
  webview CSP). If a newer version is signed by the trusted key, [`UpdateBanner`](../src/components/UpdateBanner.tsx)
  offers **Install & restart**. Any failure — offline, no release yet, running in a plain browser —
  is treated as "no update" and stays silent.
- The manifest lives at the endpoint configured in
  [`tauri.conf.json`](../src-tauri/tauri.conf.json): the latest GitHub Release's `latest.json`.

## Code signing (Authenticode)

The installer is currently **unsigned**. On first run, Windows SmartScreen may show
_"Windows protected your PC"_ — click **More info → Run anyway**. Proper Authenticode signing (an
OV/EV certificate) can be added later without touching the updater setup.

> The **updater** signature (minisign, below) is separate from Authenticode. It only proves an
> update came from us; it does not remove the SmartScreen prompt.

## One-time maintainer setup

1. **Generate the updater signing keypair** (keep the private key secret — it never goes in git):

   ```bash
   npm run tauri signer generate -- -w "$HOME/.tauri/wow-companion-updater.key"
   ```

2. **Store the private key + password as GitHub repo secrets** (Settings → Secrets and variables →
   Actions):
   - `TAURI_SIGNING_PRIVATE_KEY` — the contents of the generated `.key` file
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — the password you chose

3. **Put the public key in the config.** Paste the printed public key into
   `plugins.updater.pubkey` in [`tauri.conf.json`](../src-tauri/tauri.conf.json), replacing the
   `REPLACE_WITH_UPDATER_PUBKEY` placeholder. The pubkey is safe to commit.

## Building

- **Installer (needs the signing key):** the [`Installer`](../.github/workflows/installer.yml)
  workflow (Actions → Installer → Run workflow) builds it in CI with the secrets above and uploads
  the `wow-companion-installer` artifact. Locally: `npm run build:installer` with
  `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` in your environment.
- **Keyless local build** (e.g. to eyeball the installer UI): pass a config override to skip the
  signed artifact —
  `npm run tauri build -- --bundles nsis -c "{\"bundle\":{\"createUpdaterArtifacts\":false}}"`.
- `npm run build:exe` / `npm run app` use `--no-bundle`, so they never need the key.

## `latest.json` format (assembled by the release workflow, #45)

```json
{
  "version": "0.2.0",
  "notes": "…",
  "pub_date": "2026-01-01T00:00:00Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "<contents of the .sig file>",
      "url": "https://github.com/roshne/wow-companion/releases/download/v0.2.0/wow-companion_0.2.0_x64-setup.exe"
    }
  }
}
```

## What's deferred to #45

This PR wires the installer + updater. The **live** update flow can only be exercised once releases
exist, which is [#45 (release workflow + version bumping)](https://github.com/roshne/wow-companion/issues/45):
tag → build the installer + signed artifact → generate `latest.json` → publish a GitHub Release the
`endpoints` URL resolves to. Until then, `check()` 404s and the app simply reports no update.
