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
  `src-tauri/tauri.conf.json`; `src/appIcons.test.ts` guards that list (non-empty, references the
  platform-critical icons, image files only, no duplicates).

## Getting a fresh source icon from an AI assistant (Copilot, etc.)

`tauri icon` takes **one** source file and generates the whole set, so the only thing you need an
assistant to produce is a single clean master. Whatever you prompt, insist on these **hard
requirements** or the output won't drop into the pipeline:

1. **Square, ≥ 1024×1024.** Exactly 1:1; anything else gets distorted or cropped.
2. **Transparency (alpha).** PNG-32 or SVG, transparent _around_ the icon shape — no baked-in
   rectangular background. (A filled rounded tile _as_ the icon is fine; its corners must be
   transparent.)
3. **PNG or SVG only.** Not JPG/WebP (no usable alpha).
4. **Reads at 16px.** One bold focal element, high contrast, generous margin. No thin lines, fine
   detail, drop shadows, or photorealism.
5. **No text** beyond maybe a single bold monogram letter — words turn to mush when shrunk.
6. **Original artwork.** Don't ask for Blizzard's WoW logo or any trademarked mark — this app is
   _not affiliated with Blizzard_. Describe an original motif instead.
7. **Brand fit:** accent blue `#396cd8` (light) / `#4b8bff` (dark), from `src/App.css`.

### If it outputs an SVG (e.g. Copilot Chat writing code)

Tauri rasterizes SVG with **resvg**, which is stricter than a browser. Require:

- `viewBox="0 0 1024 1024"`, transparent background.
- Plain shapes, `<path>`, gradients (`linearGradient`/`radialGradient`), and **stroked** paths only.
- **No** `<filter>` (blur/drop-shadow won't render), **no** `<text>` (convert letters to `<path>`),
  no external fonts/images, no CSS classes.
- **No `--` inside XML comments** — a double hyphen is an XML parse error that crashes `tauri icon`
  (this bit us: `app's --accent` inside a comment).

### If it outputs a PNG (an image generator)

- Ask for **1024×1024, transparent background, flat/vector icon style, centered, no text**.
- Image models often add a background or lettering anyway — verify the result is _actually_
  transparent and _exactly_ square before feeding it in; pad/crop to 1024×1024 if not.

### Copy-paste prompt (SVG)

```
Create an original app icon as a single self-contained SVG. Output only the SVG.
- viewBox "0 0 1024 1024", transparent background.
- A rounded-square tile filling most of the canvas (small transparent margin),
  filled with a blue gradient from #4b8bff to #2a54c0.
- One bold, simple mark centered on the tile; it MUST stay legible at 16px.
- resvg-safe ONLY: shapes, <path>, linearGradient/radialGradient, stroked paths.
  NO <filter>, NO <text> (use <path> for any letters), no external fonts/images, no CSS.
- No "--" anywhere inside XML comments.
Theme: a World of Warcraft *companion* app. Original artwork only — do NOT use
Blizzard's logo or any trademarked mark.
```

### Copy-paste prompt (PNG image generator)

```
A flat, minimal app icon. 1024x1024, square, transparent background.
[your motif], centered, bold high-contrast shapes, no text, no drop shadows,
no photorealism. A blue (#396cd8) rounded tile with a white emblem.
Original artwork evoking a fantasy-game companion — not any existing brand logo.
```

Then run `npm run tauri icon <the-file>` and follow the regeneration steps above.
