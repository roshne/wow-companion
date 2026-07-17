// Set the app version across every file that carries it — running this one command is the "single
// source of truth" moment. Usage:
//
//   npm run bump 0.2.0        (or: node scripts/bump-version.mjs 0.2.0)
//
// Rewrites package.json, src-tauri/tauri.conf.json, src-tauri/Cargo.toml, and the wow-companion entry
// in src-tauri/Cargo.lock, then prints the git steps to cut the release. It deliberately does NOT
// commit or tag — that stays a reviewable step the maintainer takes.

import { readFileSync, writeFileSync } from "node:fs";
import {
  absPath,
  assertValidVersion,
  extractVersion,
  setVersion,
  VERSION_FILES,
} from "./versions.mjs";

function main() {
  const requested = process.argv[2];
  if (!requested) {
    console.error("Usage: node scripts/bump-version.mjs <version>   e.g. 0.2.0");
    process.exit(1);
  }
  try {
    assertValidVersion(requested);
  } catch (err) {
    console.error(`! ${err.message}`);
    process.exit(1);
  }

  let changed = 0;
  try {
    for (const entry of VERSION_FILES) {
      const path = absPath(entry);
      const text = readFileSync(path, "utf8");
      const current = extractVersion(entry, text);
      if (current === requested) {
        console.log(`  = ${entry.label} (already ${requested})`);
        continue;
      }
      writeFileSync(path, setVersion(entry, text, requested));
      console.log(`  + ${entry.label} (${current} -> ${requested})`);
      changed += 1;
    }
  } catch (err) {
    console.error(`! ${err.message}`);
    process.exit(1);
  }

  console.log(`\nBumped ${changed} file(s) to ${requested}.`);
  if (changed > 0) {
    console.log("\nNext, to cut the release:");
    console.log(`  git commit -am "chore(release): v${requested}"`);
    console.log(`  git tag v${requested}`);
    console.log(`  git push && git push origin v${requested}`);
    console.log("The tag push triggers the release workflow, which drafts a GitHub Release.");
  }
}

main();
