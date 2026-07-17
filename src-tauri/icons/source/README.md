# App icon source

`app-icon.svg` is the editable **master** for the app's branding — a blue tile (the app's
`--accent`) with a white "W" monogram and a gold sparkle. Everything else in `../` (the
`*.png`, `icon.ico`, `icon.icns`, `Square*Logo.png`, `StoreLogo.png`) is **generated** from it;
don't hand-edit those.

## Regenerating the icon set

After editing `app-icon.svg`, from the repo root:

```bash
npm run tauri icon src-tauri/icons/source/app-icon.svg
```

This rewrites the desktop + Windows Store icons in `../` in place. The command also emits
`android/` and `ios/` sets — those are **not** tracked (see `src-tauri/.gitignore`), since this
is a desktop-only app.

Then refresh the dev-mode favicon copy so it matches:

```bash
cp src-tauri/icons/source/app-icon.svg public/app-icon.svg
```

## Notes

- The tile is rasterized by `resvg` (Tauri's built-in engine), which is stricter than a browser:
  keep the SVG to plain shapes, gradients, and stroked paths — no filters, no `<text>`, and no
  `--` inside XML comments (it's an XML parse error).
- The icons referenced by the Windows/macOS bundle are listed under `bundle.icon` in
  `src-tauri/tauri.conf.json`; `src/appIcons.test.ts` asserts those paths resolve and the PNGs
  have the expected dimensions.
