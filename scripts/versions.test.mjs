import { describe, expect, it } from "vitest";
import {
  assertConsistent,
  assertValidVersion,
  extractVersion,
  isValidVersion,
  readAllVersions,
  setVersion,
  versionFromTag,
  VERSION_FILES,
} from "./versions.mjs";

// Look an entry up by its label so each test targets one file format.
const byLabel = (label) => VERSION_FILES.find((e) => e.label === label);

// Representative snippets of each file — enough surrounding shape to prove the patterns don't latch
// onto the wrong "version" (dependency ranges, inline-table versions, a sibling lock entry).
const FIXTURES = {
  "package.json": `{
  "name": "wow-companion",
  "version": "0.1.0",
  "dependencies": {
    "react": "^19.1.0"
  }
}
`,
  "tauri.conf.json": `{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "wow-companion",
  "version": "0.1.0",
  "identifier": "com.roshne.wowcompanion"
}
`,
  "Cargo.toml": `[package]
name = "wow-companion"
version = "0.1.0"

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
tauri = { version = "2", features = [] }
`,
  "Cargo.lock": `[[package]]
name = "wow"
version = "9.9.9"

[[package]]
name = "wow-companion"
version = "0.1.0"
dependencies = [
 "tauri",
]
`,
};

describe("isValidVersion", () => {
  it.each(["0.2.0", "1.2.3", "10.20.30", "1.0.0-rc.1", "1.2.3+build.5"])("accepts %s", (v) => {
    expect(isValidVersion(v)).toBe(true);
  });

  it.each(["1.2", "v1.2.3", "1.2.3.4", "abc", "", "1.2.x"])("rejects %s", (v) => {
    expect(isValidVersion(v)).toBe(false);
  });

  it("assertValidVersion throws on a bad version and returns a good one", () => {
    expect(() => assertValidVersion("nope")).toThrow(/expected semver/i);
    expect(assertValidVersion("0.2.0")).toBe("0.2.0");
  });
});

describe("extractVersion", () => {
  it.each(Object.keys(FIXTURES))("reads the version from %s", (label) => {
    expect(extractVersion(byLabel(label), FIXTURES[label])).toBe("0.1.0");
  });

  it("throws when the field is absent", () => {
    expect(() => extractVersion(byLabel("package.json"), `{ "name": "x" }`)).toThrow(
      /No version found/,
    );
  });
});

describe("setVersion", () => {
  it.each(Object.keys(FIXTURES))("rewrites the version in %s and touches nothing else", (label) => {
    const entry = byLabel(label);
    const before = FIXTURES[label];
    const after = setVersion(entry, before, "0.2.0");

    expect(extractVersion(entry, after)).toBe("0.2.0");
    // Setting it back reproduces the original byte-for-byte, so the one version site was the only edit.
    expect(setVersion(entry, after, "0.1.0")).toBe(before);
  });

  it("leaves a dependency range and a sibling lock entry untouched", () => {
    const pkg = setVersion(byLabel("package.json"), FIXTURES["package.json"], "0.2.0");
    expect(pkg).toContain(`"react": "^19.1.0"`);

    const lock = setVersion(byLabel("Cargo.lock"), FIXTURES["Cargo.lock"], "0.2.0");
    expect(lock).toContain(`name = "wow"\nversion = "9.9.9"`);
    expect(lock).toContain(`name = "wow-companion"\nversion = "0.2.0"`);
  });

  it("does not match a dependency's inline-table version in Cargo.toml", () => {
    const toml = setVersion(byLabel("Cargo.toml"), FIXTURES["Cargo.toml"], "0.2.0");
    expect(toml).toContain(`tauri = { version = "2", features = [] }`);
    expect(toml).toContain(`name = "wow-companion"\nversion = "0.2.0"`);
  });

  it("rejects an invalid target version", () => {
    expect(() => setVersion(byLabel("package.json"), FIXTURES["package.json"], "1.2")).toThrow(
      /expected semver/i,
    );
  });

  it("throws when zero or more than one version field is present", () => {
    const entry = byLabel("package.json");
    expect(() => setVersion(entry, `{ "name": "x" }`, "0.2.0")).toThrow(/found 0/);
    const doubled = `{ "version": "0.1.0", "nested": { "version": "0.1.0" } }`;
    expect(() => setVersion(entry, doubled, "0.2.0")).toThrow(/found 2/);
  });
});

describe("assertConsistent", () => {
  it("returns the shared version when all agree", () => {
    const agreed = [
      { label: "package.json", version: "0.3.0" },
      { label: "Cargo.toml", version: "0.3.0" },
    ];
    expect(assertConsistent(agreed)).toBe("0.3.0");
  });

  it("throws and names the offenders on drift", () => {
    const drifted = [
      { label: "package.json", version: "0.2.0" },
      { label: "Cargo.toml", version: "0.1.0" },
    ];
    expect(() => assertConsistent(drifted)).toThrow(/drift/i);
    expect(() => assertConsistent(drifted)).toThrow(/Cargo\.toml: 0\.1\.0/);
  });
});

describe("versionFromTag", () => {
  it("strips a leading v", () => {
    expect(versionFromTag("v0.2.0")).toBe("0.2.0");
    expect(versionFromTag("0.2.0")).toBe("0.2.0");
  });
});

describe("the committed repo files", () => {
  it("all agree on one version", () => {
    // Reads the real package.json / tauri.conf.json / Cargo.toml / Cargo.lock. This is the local
    // mirror of the CI drift guard: a hand-edit to one file's version fails the test suite.
    expect(() => assertConsistent(readAllVersions())).not.toThrow();
  });
});
