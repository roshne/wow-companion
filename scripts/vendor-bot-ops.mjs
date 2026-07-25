// Vendor the shared Bot Ops module from nazumods/wow (apps/bot-ops) into this repo.
//
// Why vendor rather than depend: the module is authored in a different repo and a different org.
// A cargo git dependency would make the Rust build reach the network and pin a moving rev, and npm
// cannot depend on a git *subdirectory* at all. Vendoring keeps the build offline and the tree
// self-contained — the same contract as battlenet-wow-client and wow-static-data beside it.
//
// This is the CONSUMER side of a one-directional sync. nazumods/wow is the source of truth; never
// hand-edit the vendored copies, because the next run overwrites them.
//
//   src-tauri/vendor/bot-ops/{Cargo.toml,src/lib.rs}   <- apps/bot-ops/rust/...
//   src/vendor/bot-ops/index.ts                        <- apps/bot-ops/ts/index.ts
//
// Usage:
//   node scripts/vendor-bot-ops.mjs                 # fetch from GitHub, write if changed
//   node scripts/vendor-bot-ops.mjs --check         # report only, never writes
//   node scripts/vendor-bot-ops.mjs --from R:/repos/wow   # use a local checkout instead
//
// A local checkout (--from, or WOW_REPO_DIR) reads the working tree, so it picks up module changes
// that are not pushed yet. Without it the script reads GitHub at the default branch — which is what
// an unattended staleness check should do, since it must not depend on a checkout existing.
//
// Exit codes are a contract, matching fetch-static-data.mjs so a scheduled watch can treat them
// the same way:
//
//   0  up to date (or, without --check, written successfully)
//   1  the vendored copy is stale                 -> ACTIONABLE, notify
//   3  fetch, read or validation failed           -> ACTIONABLE, something is broken
//
// (Code 2 — "nothing published yet" — has no analogue here: the module is committed source, not a
// release artifact, so its absence is a genuine breakage rather than a quiet not-yet.)

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const SOURCE_REPO = "nazumods/wow";
export const SOURCE_DIR = "apps/bot-ops";

/**
 * What lands where. `source` is relative to apps/bot-ops in nazumods/wow; `target` is relative to
 * this repo root.
 *
 * Only these files — the module also carries package.json/tsconfig/docs, which exist so it can be
 * developed and typechecked standalone and are not needed by a consumer.
 */
export const FILES = [
  { source: "rust/Cargo.toml", target: "src-tauri/vendor/bot-ops/Cargo.toml" },
  { source: "rust/src/lib.rs", target: "src-tauri/vendor/bot-ops/src/lib.rs" },
  { source: "ts/index.ts", target: "src/vendor/bot-ops/index.ts" },
];

/** Exit codes — see the header comment. Consumed by the scheduled staleness watch. */
export const EXIT = {
  OK: 0,
  STALE: 1,
  BROKEN: 3,
};

/** Normalize to LF so a re-vendor is deterministic regardless of platform (.gitattributes: LF). */
export function normalize(text) {
  return text.replace(/\r\n/g, "\n");
}

/**
 * Guard against writing a truncated or wrong-file response into the tree. GitHub serves an HTML
 * error page with a 200 in some failure modes, so "it downloaded" is not enough.
 */
export function validate(sourcePath, text) {
  if (text.trim() === "") return `${sourcePath} is empty`;
  if (sourcePath.endsWith("lib.rs") && !text.includes("pub mod commands"))
    return `${sourcePath} has no \`pub mod commands\` — not the bot-ops crate`;
  if (sourcePath.endsWith("index.ts") && !text.includes("OPS_FIELDS"))
    return `${sourcePath} has no OPS_FIELDS — not the bot-ops module`;
  if (sourcePath.endsWith("Cargo.toml") && !text.includes('name = "bot-ops"'))
    return `${sourcePath} is not the bot-ops crate manifest`;
  return null;
}

async function fetchText(url) {
  const res = await fetch(url, { headers: { "user-agent": "wow-companion-vendor" } });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status} ${res.statusText}`);
  return res.text();
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { accept: "application/vnd.github+json", "user-agent": "wow-companion-vendor" },
  });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status} ${res.statusText}`);
  return res.json();
}

/** Reader over a local checkout: reads the working tree, so unpushed module edits are visible. */
function localSource(dir) {
  const base = join(resolve(dir), ...SOURCE_DIR.split("/"));
  if (!existsSync(base)) {
    throw new Error(`Not a nazumods/wow checkout (no ${SOURCE_DIR}): ${resolve(dir)}`);
  }
  return {
    describe: `${resolve(dir)} (working tree)`,
    read(rel) {
      const from = join(base, ...rel.split("/"));
      if (!existsSync(from)) throw new Error(`Missing source file: ${from}`);
      return readFileSync(from, "utf8");
    },
  };
}

/** Reader over the public GitHub repo at its default branch. No auth — the repo is public. */
async function remoteSource() {
  const repo = await fetchJson(`https://api.github.com/repos/${SOURCE_REPO}`);
  const ref = repo?.default_branch ?? "main";
  return {
    describe: `${SOURCE_REPO}@${ref}`,
    async read(rel) {
      return fetchText(
        `https://raw.githubusercontent.com/${SOURCE_REPO}/${ref}/${SOURCE_DIR}/${rel}`,
      );
    },
  };
}

function resolveLocalDir() {
  const flag = process.argv.indexOf("--from");
  if (flag !== -1) {
    const dir = process.argv[flag + 1];
    if (!dir) throw new Error("--from needs a path to a nazumods/wow checkout");
    return dir;
  }
  return process.env.WOW_REPO_DIR || null;
}

async function main() {
  const check = process.argv.includes("--check");
  const localDir = resolveLocalDir();
  const source = localDir ? localSource(localDir) : await remoteSource();

  // Read and validate everything before writing anything: a half-applied vendor would leave the
  // Rust crate and the TS API out of step with each other, which is worse than not updating.
  const incoming = [];
  for (const { source: rel, target } of FILES) {
    const text = normalize(await source.read(rel));
    const problem = validate(rel, text);
    if (problem) {
      console.error(`${problem} - refusing to write.`);
      process.exit(EXIT.BROKEN);
    }
    const to = join(repoRoot, ...target.split("/"));
    const previous = existsSync(to) ? normalize(readFileSync(to, "utf8")) : null;
    incoming.push({ rel, target, to, text, stale: previous !== text });
  }

  const stale = incoming.filter((f) => f.stale);
  if (stale.length === 0) {
    console.log(`= bot-ops is up to date with ${source.describe} (${FILES.length} files).`);
    return;
  }

  if (check) {
    console.error(`! bot-ops is stale against ${source.describe}:`);
    for (const f of stale) console.error(`    ${f.target}`);
    console.error("  Run `npm run vendor:bot-ops` to update it.");
    process.exit(EXIT.STALE);
  }

  for (const f of incoming) {
    if (!f.stale) {
      console.log(`  = ${f.target} (unchanged)`);
      continue;
    }
    mkdirSync(dirname(f.to), { recursive: true });
    writeFileSync(f.to, f.text);
    console.log(`  + ${f.target} (updated)`);
  }
  console.log(
    `Vendored bot-ops from ${source.describe} (${stale.length} of ${FILES.length} changed).`,
  );
  console.log("Run `npm run lint && npm test && npm run build` before committing.");
}

// Only run when invoked directly, so the tests can import the helpers above.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((err) => {
    // A thrown error is a fetch/read failure, not staleness — must not exit 1.
    console.error(err.message);
    process.exit(EXIT.BROKEN);
  });
}
