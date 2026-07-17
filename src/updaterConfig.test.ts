import { describe, it, expect } from "vitest";
import tauriConf from "../src-tauri/tauri.conf.json";
import capabilities from "../src-tauri/capabilities/default.json";

// Guards the updater's config contract so the endpoint, signing pubkey, artifact generation, and
// window capabilities can't silently drift. The live update flow itself is exercised once releases
// are published (issue #45); here we just assert the wiring is present and coherent.
describe("updater config", () => {
  const updater = tauriConf.plugins?.updater;

  it("declares at least one update endpoint", () => {
    expect(updater?.endpoints?.length ?? 0).toBeGreaterThan(0);
  });

  it("serves every endpoint over https", () => {
    for (const url of updater?.endpoints ?? []) {
      expect(url).toMatch(/^https:\/\//);
    }
  });

  it("embeds a real signing public key (not the placeholder)", () => {
    const pubkey = updater?.pubkey ?? "";
    expect(typeof pubkey).toBe("string");
    // A minisign public key is a long base64 blob; the placeholder is short and obvious.
    expect(pubkey.length).toBeGreaterThan(40);
    expect(pubkey).not.toContain("REPLACE_WITH");
  });

  it("emits signed updater artifacts from the bundler", () => {
    expect(tauriConf.bundle.createUpdaterArtifacts).toBe(true);
  });

  it("grants the webview updater + relaunch permissions", () => {
    expect(capabilities.permissions).toContain("updater:default");
    expect(capabilities.permissions).toContain("process:allow-restart");
  });
});
