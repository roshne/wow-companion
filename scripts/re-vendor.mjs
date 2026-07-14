// Re-vendor the battlenet-wow-client from the battlenet-api-research foundation
// repo. Copies client/src/{auth.ts,client.ts,index.ts,generated/schema.d.ts}
// into src/vendor/battlenet-wow-client/, rewriting relative import specifiers to
// extensionless form (for Vite/bundler resolution). See the vendored VENDORED.md.
//
// Source path resolution (first match wins):
//   1. CLI arg:  node scripts/re-vendor.mjs <path-to-battlenet-api-research>
//   2. env var:  BNET_RESEARCH_DIR
//   3. default:  ../battlenet-api-research  (sibling of this repo)

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const vendorDir = join(repoRoot, "src", "vendor", "battlenet-wow-client");

// Paths are relative to both <research>/client/src and the vendor directory.
const FILES = ["auth.ts", "client.ts", "index.ts", "generated/schema.d.ts"];

function resolveResearchDir() {
  const candidate =
    process.argv[2] ??
    process.env.BNET_RESEARCH_DIR ??
    join(repoRoot, "..", "battlenet-api-research");
  return resolve(candidate);
}

// Drop the extension from relative import/export specifiers:
//   from "./auth.js"             -> from "./auth"
//   from "./generated/schema.js" -> from "./generated/schema"
// Bare specifiers (e.g. "openapi-fetch") are left untouched.
function toExtensionless(source) {
  return source.replace(/(\bfrom\s*["'])(\.[^"']*?)\.(?:js|jsx|mjs|cjs|ts|tsx)(["'])/g, "$1$2$3");
}

// Normalize to LF so re-vendoring is deterministic regardless of the source
// repo's line-ending settings (the vendored files are LF; see .gitattributes).
function normalize(text) {
  return toExtensionless(text).replace(/\r\n/g, "\n");
}

function sourceCommit(researchDir) {
  try {
    return execFileSync("git", ["-C", researchDir, "rev-parse", "--short", "HEAD"], {
      encoding: "utf8",
    }).trim();
  } catch {
    return "unknown";
  }
}

function main() {
  const researchDir = resolveResearchDir();
  const srcDir = join(researchDir, "client", "src");
  if (!existsSync(srcDir)) {
    console.error(`Source not found: ${srcDir}`);
    console.error("Pass the battlenet-api-research path as an argument, set BNET_RESEARCH_DIR, or");
    console.error(
      "place it at ../battlenet-api-research. Run `npm run generate && npm run build` in",
    );
    console.error("its client/ first so generated/schema.d.ts is current.");
    process.exit(1);
  }

  let changed = 0;
  for (const rel of FILES) {
    const from = join(srcDir, rel);
    if (!existsSync(from)) {
      console.error(`Missing source file: ${from}`);
      process.exit(1);
    }
    const to = join(vendorDir, rel);
    const out = normalize(readFileSync(from, "utf8"));
    const prev = existsSync(to) ? normalize(readFileSync(to, "utf8")) : null;
    if (prev === out) {
      console.log(`  = ${rel} (unchanged)`);
    } else {
      mkdirSync(dirname(to), { recursive: true });
      writeFileSync(to, out);
      console.log(`  + ${rel} (updated)`);
      changed += 1;
    }
  }

  console.log(
    `Re-vendored ${FILES.length} files from ${researchDir} @ ${sourceCommit(researchDir)} (${changed} changed).`,
  );
}

main();
