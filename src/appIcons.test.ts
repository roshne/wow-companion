import { describe, it, expect } from "vitest";
import tauriConf from "../src-tauri/tauri.conf.json";

// The window/taskbar/bundle icon is drawn from the files listed in `bundle.icon`, which are
// generated from `src-tauri/icons/source/app-icon.svg` via `npm run tauri icon`. These assertions
// guard the config contract so a careless edit can't silently drop or mis-path a platform icon.
// (That the referenced files are present and correctly sized on disk is exercised by the CI build,
// which bundles them — reproducing that here would mean pulling Node's fs types into the browser
// app's global scope, which isn't worth it.)
describe("tauri bundle icons", () => {
  const icons: string[] = tauriConf.bundle.icon;

  it("references a non-empty icon set", () => {
    expect(Array.isArray(icons)).toBe(true);
    expect(icons.length).toBeGreaterThan(0);
  });

  it("includes each platform-critical icon", () => {
    // Windows/Linux desktop PNGs, the Windows .ico, and the macOS .icns.
    expect(icons).toEqual(
      expect.arrayContaining([
        "icons/32x32.png",
        "icons/128x128.png",
        "icons/128x128@2x.png",
        "icons/icon.ico",
        "icons/icon.icns",
      ]),
    );
  });

  it("only references image files under icons/", () => {
    for (const rel of icons) {
      expect(rel).toMatch(/^icons\/[\w@.-]+\.(png|ico|icns)$/);
    }
  });

  it("has no duplicate entries", () => {
    expect(new Set(icons).size).toBe(icons.length);
  });
});
