import { describe, expect, it } from "vitest";
import {
  ASSET_NAME,
  EXIT,
  TAG_PREFIX,
  bundleBuild,
  selectAssetUrl,
  selectBundleRelease,
} from "./fetch-static-data.mjs";

const release = (
  tag_name,
  assets = [{ name: ASSET_NAME, browser_download_url: `https://x/${tag_name}` }],
) => ({
  tag_name,
  assets,
});

describe("selectBundleRelease", () => {
  it("takes the first prefix match, since the API returns releases newest-first", () => {
    const picked = selectBundleRelease([
      release("app-static-data-v12.0.7.68453-ecf8b83b"),
      release("app-static-data-v12.0.6.60000-aaaaaaaa"),
    ]);
    expect(picked.tag_name).toBe("app-static-data-v12.0.7.68453-ecf8b83b");
  });

  it("skips unrelated releases — addon tags, app tags, and the desktop exe", () => {
    const picked = selectBundleRelease([
      release("Warbandeer_Collected-v12.0.7-r20"),
      release("app-warbandeer-desktop-v0.2.3"),
      release("app-static-data-v12.0.7.68453-ecf8b83b"),
    ]);
    expect(picked.tag_name).toBe("app-static-data-v12.0.7.68453-ecf8b83b");
  });

  it("does not confuse the desktop app tag for a bundle tag", () => {
    // Both start with `app-`; only the static-data one carries the full prefix.
    expect(selectBundleRelease([release("app-warbandeer-desktop-v0.2.3")])).toBeNull();
  });

  it("returns null before the first bundle is published", () => {
    expect(selectBundleRelease([release("Warbandeer-v12.0.7-r29")])).toBeNull();
    expect(selectBundleRelease([])).toBeNull();
  });

  it("tolerates a malformed payload instead of throwing", () => {
    expect(selectBundleRelease(null)).toBeNull();
    expect(selectBundleRelease([{}, { tag_name: 42 }])).toBeNull();
  });

  it("uses a prefix that keeps the CurseForge publisher away", () => {
    // nazumods/wow's publish.yml skips every tag starting with `app-`; if this prefix
    // ever loses that segment, data releases would be pushed at CurseForge.
    expect(TAG_PREFIX.startsWith("app-")).toBe(true);
  });
});

describe("selectAssetUrl", () => {
  it("finds the bundle asset by exact name", () => {
    const url = selectAssetUrl(
      release("app-static-data-v1-aaaaaaaa", [
        { name: "other.txt", browser_download_url: "https://x/other" },
        { name: ASSET_NAME, browser_download_url: "https://x/bundle" },
      ]),
    );
    expect(url).toBe("https://x/bundle");
  });

  it("returns null when the release has no bundle asset", () => {
    expect(selectAssetUrl(release("app-static-data-v1-aaaaaaaa", []))).toBeNull();
    expect(selectAssetUrl(undefined)).toBeNull();
  });
});

describe("EXIT codes", () => {
  // The scheduled staleness watch branches on these. Collapsing "a newer bundle
  // exists" into the same code as "nothing published yet" would make it fire an
  // actionable notification every run while waiting for the first release.
  it("keeps every outcome on a distinct code", () => {
    const codes = Object.values(EXIT);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("reserves 0 for success so a shell truthiness check still works", () => {
    expect(EXIT.OK).toBe(0);
  });

  it("separates actionable staleness from a not-yet-published release", () => {
    expect(EXIT.STALE).not.toBe(EXIT.NOT_PUBLISHED);
  });

  it("separates a broken fetch from staleness, so a network blip isn't read as a new bundle", () => {
    expect(EXIT.BROKEN).not.toBe(EXIT.STALE);
  });
});

describe("bundleBuild", () => {
  it("reads the build out of the bundle", () => {
    expect(bundleBuild(JSON.stringify({ build: "12.0.7.68453" }))).toBe("12.0.7.68453");
  });

  it("falls back to the tag when the JSON can't be parsed", () => {
    expect(bundleBuild("{ truncated", "app-static-data-v9-bbbbbbbb")).toBe(
      "app-static-data-v9-bbbbbbbb",
    );
  });
});
