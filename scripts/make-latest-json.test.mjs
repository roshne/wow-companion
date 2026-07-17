import { describe, expect, it } from "vitest";
import { buildUpdaterManifest } from "./make-latest-json.mjs";

describe("buildUpdaterManifest", () => {
  const parts = {
    version: "0.2.0",
    signature: "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZQ==",
    url: "https://github.com/roshne/wow-companion/releases/download/v0.2.0/wow-companion_0.2.0_x64-setup.exe",
    notes: "See the release page.",
    pubDate: "2026-07-17T00:00:00.000Z",
  };

  it("shapes the Tauri updater manifest with a single windows-x86_64 platform", () => {
    expect(buildUpdaterManifest(parts)).toEqual({
      version: "0.2.0",
      notes: "See the release page.",
      pub_date: "2026-07-17T00:00:00.000Z",
      platforms: {
        "windows-x86_64": {
          signature: parts.signature,
          url: parts.url,
        },
      },
    });
  });

  it("embeds the signature and download URL verbatim", () => {
    const platform = buildUpdaterManifest(parts).platforms["windows-x86_64"];
    expect(platform.signature).toBe(parts.signature);
    expect(platform.url).toBe(parts.url);
  });

  it("keeps the version as a bare semver (no leading v), matching the app version", () => {
    // The updater compares this against the running app's tauri.conf.json version, which is unprefixed.
    expect(buildUpdaterManifest(parts).version).toBe("0.2.0");
  });
});
