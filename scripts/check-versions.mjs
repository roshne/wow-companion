// Assert the app version agrees across package.json, tauri.conf.json, Cargo.toml, and Cargo.lock.
// With `--tag <tag>` it additionally asserts they match the pushed release tag (leading "v" stripped).
// Exits non-zero on any mismatch so CI and the release workflow fail fast on version drift — which
// would otherwise silently break updater version comparisons.
//
//   node scripts/check-versions.mjs
//   node scripts/check-versions.mjs --tag v0.2.0

import { assertConsistent, readAllVersions, versionFromTag } from "./versions.mjs";

function parseTag(argv) {
  const i = argv.indexOf("--tag");
  if (i === -1) return undefined;
  const tag = argv[i + 1];
  if (!tag) {
    console.error("! --tag requires a value, e.g. --tag v0.2.0");
    process.exit(1);
  }
  return tag;
}

function main() {
  const tag = parseTag(process.argv.slice(2));

  let version;
  try {
    version = assertConsistent(readAllVersions());
  } catch (err) {
    console.error(`! ${err.message}`);
    process.exit(1);
  }
  console.log(`= versions agree: ${version}`);

  if (tag !== undefined) {
    const want = versionFromTag(tag);
    if (want !== version) {
      console.error(`! tag ${tag} (=> ${want}) does not match source version ${version}`);
      process.exit(1);
    }
    console.log(`= tag ${tag} matches source version`);
  }
}

main();
