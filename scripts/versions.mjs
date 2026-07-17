// Single source of truth for "where the app version lives". Pure string transforms (no disk I/O in
// the core) so the bump, consistency-check, and release scripts share one definition and the logic
// stays unit-testable. The four files that carry the version, and how each stores it:
//
//   package.json               "version": "X.Y.Z"   (JSON, top-level key)
//   src-tauri/tauri.conf.json  "version": "X.Y.Z"   (JSON, top-level key — canonical for the build)
//   src-tauri/Cargo.toml       version = "X.Y.Z"    (TOML, bare key under [package])
//   src-tauri/Cargo.lock       the wow-companion [[package]] block's version
//
// Keeping all four in lock-step matters because the updater compares versions: drift silently breaks
// update detection, so `check-versions.mjs` enforces agreement in CI.

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// A version is semver-ish: three dot-separated integers with optional prerelease/build metadata
// (e.g. "1.2.3", "0.2.0", "1.0.0-rc.1"). Anything else is rejected so a typo can't propagate.
const VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

// Reused inside the file patterns below — the same shape, but unanchored so it matches mid-line.
const SEMVER = "\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?(?:\\+[0-9A-Za-z.-]+)?";

export function isValidVersion(v) {
  return typeof v === "string" && VERSION_RE.test(v);
}

export function assertValidVersion(v) {
  if (!isValidVersion(v)) {
    throw new Error(`Invalid version ${JSON.stringify(v)} — expected semver like "0.2.0".`);
  }
  return v;
}

// Each entry knows its path (relative to repo root) and a regex whose middle capture group is the
// version, framed by leading/trailing groups so a replacement can reuse the exact surrounding text.
// The value group is semver-shaped, not `[^"]*`, so the JSON patterns can't accidentally latch onto
// some other "version"-keyed string.
export const VERSION_FILES = [
  {
    label: "package.json",
    path: "package.json",
    re: new RegExp(`("version"\\s*:\\s*")(${SEMVER})(")`),
  },
  {
    label: "tauri.conf.json",
    path: join("src-tauri", "tauri.conf.json"),
    re: new RegExp(`("version"\\s*:\\s*")(${SEMVER})(")`),
  },
  {
    // TOML: the bare `version = "…"` under [package]. Anchored to line start (`m` flag) so it never
    // matches a dependency's inline-table version like `tauri = { version = "2", … }`.
    label: "Cargo.toml",
    path: join("src-tauri", "Cargo.toml"),
    re: new RegExp(`(^version\\s*=\\s*")(${SEMVER})(")`, "m"),
  },
  {
    // The version line immediately follows `name = "wow-companion"` in the crate's [[package]] block.
    label: "Cargo.lock",
    path: join("src-tauri", "Cargo.lock"),
    re: new RegExp(`(name = "wow-companion"\\r?\\nversion = ")(${SEMVER})(")`),
  },
];

export function absPath(entry) {
  return join(repoRoot, entry.path);
}

function globalize(re) {
  return re.flags.includes("g") ? re : new RegExp(re.source, `${re.flags}g`);
}

// Read the version out of a file's text. Throws if the expected field isn't present.
export function extractVersion(entry, text) {
  const m = entry.re.exec(text);
  if (!m) throw new Error(`No version found in ${entry.label} (pattern didn't match).`);
  return m[2];
}

// Return `text` with the version replaced. Asserts the pattern matched exactly once so a reformat
// that moves or renames the field fails loudly instead of silently leaving the old version behind.
export function setVersion(entry, text, newVersion) {
  assertValidVersion(newVersion);
  const matches = [...text.matchAll(globalize(entry.re))];
  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one version field in ${entry.label}, found ${matches.length}.`,
    );
  }
  return text.replace(entry.re, (_full, pre, _old, post) => `${pre}${newVersion}${post}`);
}

// Read every version file from disk. Returns [{ label, version, entry }, …].
export function readAllVersions() {
  return VERSION_FILES.map((entry) => ({
    label: entry.label,
    version: extractVersion(entry, readFileSync(absPath(entry), "utf8")),
    entry,
  }));
}

// Throw if the versions disagree. Pure over a list of { label, version } so tests feed fixtures and
// the CLI feeds real files. Returns the single agreed version on success.
export function assertConsistent(versions) {
  const distinct = [...new Set(versions.map((v) => v.version))];
  if (distinct.length !== 1) {
    const detail = versions.map((v) => `  ${v.label}: ${v.version}`).join("\n");
    throw new Error(`Version drift across files:\n${detail}`);
  }
  return distinct[0];
}

// Strip a leading "v" from a git tag ("v0.2.0" -> "0.2.0"). Tags are conventionally v-prefixed; the
// version files are not.
export function versionFromTag(tag) {
  return tag.replace(/^v/, "");
}
