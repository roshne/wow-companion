// Assemble the Tauri updater manifest (latest.json) the in-app updater consumes, from the artifacts
// `npm run build:installer` just produced. The updater fetches this from the latest GitHub Release
// (see plugins.updater.endpoints in tauri.conf.json). Run in the release workflow after the build:
//
//   node scripts/make-latest-json.mjs --tag v0.2.0 [--out <path>] [--notes "…"]
//
// It reads the signed installer's `.sig` from the NSIS bundle dir and points the download URL at the
// release the tag names. The version comes from the source files (asserted consistent), not the tag,
// so a mismatched tag surfaces here too.

import { readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertConsistent, readAllVersions, repoRoot } from "./versions.mjs";

const NSIS_DIR = join(repoRoot, "src-tauri", "target", "release", "bundle", "nsis");
const DEFAULT_REPO = "roshne/wow-companion";

// Pure: build the manifest object from its parts. A single Windows target mirrors the app's
// Windows-only distribution today; add more platform keys here when other OSes ship.
export function buildUpdaterManifest({ version, signature, url, notes, pubDate }) {
  return {
    version,
    notes,
    pub_date: pubDate,
    platforms: {
      "windows-x86_64": { signature, url },
    },
  };
}

function parseArg(argv, name) {
  const i = argv.indexOf(name);
  return i !== -1 ? argv[i + 1] : undefined;
}

// Find the NSIS installer (…-setup.exe) in the bundle dir. Exactly one is expected; its sibling
// `<installer>.sig` (emitted because bundle.createUpdaterArtifacts is on) holds the signature.
function findInstaller() {
  let files;
  try {
    files = readdirSync(NSIS_DIR);
  } catch {
    throw new Error(
      `NSIS bundle dir not found: ${NSIS_DIR} — run \`npm run build:installer\` first.`,
    );
  }
  const installers = files.filter((f) => f.endsWith("-setup.exe"));
  if (installers.length !== 1) {
    throw new Error(`Expected exactly one *-setup.exe in ${NSIS_DIR}, found ${installers.length}.`);
  }
  return installers[0];
}

function main() {
  const argv = process.argv.slice(2);
  const tag = parseArg(argv, "--tag");
  if (!tag) {
    console.error(
      "Usage: node scripts/make-latest-json.mjs --tag <tag> [--out <path>] [--notes <text>]",
    );
    process.exit(1);
  }
  const out = parseArg(argv, "--out") ?? join(repoRoot, "latest.json");
  const repo = process.env.GITHUB_REPOSITORY || DEFAULT_REPO;

  let version, installer, signature;
  try {
    version = assertConsistent(readAllVersions());
    installer = findInstaller();
    signature = readFileSync(join(NSIS_DIR, `${installer}.sig`), "utf8").trim();
  } catch (err) {
    console.error(`! ${err.message}`);
    process.exit(1);
  }

  const url = `https://github.com/${repo}/releases/download/${tag}/${installer}`;
  const notes =
    parseArg(argv, "--notes") ?? `See https://github.com/${repo}/releases/tag/${tag} for details.`;
  const manifest = buildUpdaterManifest({
    version,
    signature,
    url,
    notes,
    pubDate: new Date().toISOString(),
  });

  writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`+ wrote ${out}`);
  console.log(`  version:   ${version}`);
  console.log(`  installer: ${installer}`);
  console.log(`  url:       ${url}`);
}

// Run the CLI only when executed directly (`node scripts/make-latest-json.mjs …`), not when a test
// imports `buildUpdaterManifest` — otherwise the missing `--tag` would exit the test process.
function isDirectRun() {
  const invoked = process.argv[1];
  if (!invoked) return false;
  try {
    return realpathSync(invoked) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isDirectRun()) main();
