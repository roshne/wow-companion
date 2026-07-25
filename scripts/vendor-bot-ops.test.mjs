import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { EXIT, FILES, SOURCE_DIR, normalize, validate } from "./vendor-bot-ops.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(repoRoot, ...rel.split("/")), "utf8");

describe("validate", () => {
  // GitHub can answer a bad path with an HTML error page and a 200, so "it downloaded" is not
  // enough — every guard below is the difference between a broken vendor and a broken build.
  it("passes the real vendored files", () => {
    for (const { source, target } of FILES) {
      expect(validate(source, read(target)), `${source} should validate`).toBeNull();
    }
  });

  it("rejects an empty response", () => {
    expect(validate("ts/index.ts", "   \n ")).toMatch(/empty/);
  });

  it("rejects an HTML error page served in place of each file", () => {
    const html = "<!DOCTYPE html><html><body>404</body></html>";
    for (const { source } of FILES) {
      expect(validate(source, html), `${source} should reject HTML`).not.toBeNull();
    }
  });

  it("rejects a crate whose commands are not nested in `commands`", () => {
    // Registration is `bot_ops::commands::bot_status`; a crate-root layout would not compile
    // in the host app, and the failure would surface far from the vendor step.
    expect(validate("rust/src/lib.rs", "pub fn ops_config() {}")).toMatch(/pub mod commands/);
  });

  it("rejects a different crate's manifest", () => {
    expect(validate("rust/Cargo.toml", '[package]\nname = "warbandeer-desktop"\n')).not.toBeNull();
  });
});

describe("normalize", () => {
  it("stores LF so a re-vendor on Windows is not a diff (see .gitattributes)", () => {
    expect(normalize("a\r\nb\r\n")).toBe("a\nb\n");
  });

  it("leaves already-LF text alone, so repeated runs are idempotent", () => {
    expect(normalize("a\nb\n")).toBe("a\nb\n");
  });
});

describe("FILES", () => {
  it("splits the module across the Rust and TS vendor trees", () => {
    const targets = FILES.map((f) => f.target);
    expect(targets).toContain("src-tauri/vendor/bot-ops/src/lib.rs");
    expect(targets).toContain("src/vendor/bot-ops/index.ts");
  });

  it("keeps the crate manifest alongside its source", () => {
    // A path dependency needs both; vendoring lib.rs without Cargo.toml breaks `cargo check`.
    expect(FILES.map((f) => f.target)).toContain("src-tauri/vendor/bot-ops/Cargo.toml");
  });

  it("names sources relative to the module dir, not the source repo root", () => {
    for (const { source } of FILES) {
      expect(source.startsWith(SOURCE_DIR)).toBe(false);
      expect(source.startsWith("/")).toBe(false);
    }
  });
});

describe("EXIT codes", () => {
  // Shared contract with fetch-static-data.mjs so one scheduled watch can branch on both.
  it("keeps every outcome on a distinct code", () => {
    const codes = Object.values(EXIT);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("reserves 0 for success so a shell truthiness check still works", () => {
    expect(EXIT.OK).toBe(0);
  });

  it("separates a broken fetch from staleness, so a network blip isn't read as an update", () => {
    expect(EXIT.BROKEN).not.toBe(EXIT.STALE);
  });

  it("leaves 2 free, matching fetch-static-data's not-published code", () => {
    expect(Object.values(EXIT)).not.toContain(2);
  });
});

describe("the vendored copy", () => {
  it("carries the same OPS_FIELDS the box's whitelist mirrors", () => {
    const ts = read("src/vendor/bot-ops/index.ts");
    for (const key of ["ANNOUNCE_CHANNEL_ID", "WOW_REALM", "AUTO_UPDATE"]) {
      expect(ts).toContain(key);
    }
  });

  it("is re-exported through src/lib/botops.ts rather than imported from src/vendor directly", () => {
    // Keeps the vendored path an implementation detail — the same contract as the other
    // vendored modules, and the reason a re-vendor never touches app code.
    expect(read("src/lib/botops.ts")).toContain('from "../vendor/bot-ops"');
    expect(read("src/components/BotOps.tsx")).toContain('from "../lib/botops"');
    expect(read("src/components/BotOps.tsx")).not.toContain("vendor/bot-ops");
  });
});
