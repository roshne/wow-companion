// Vendor the WoW static-data bundle (currency name/icon/cap lookups) from the
// nazumods/wow release feed into src/vendor/wow-static-data/static-data.json.
//
// Why fetch rather than derive: currency metadata is the one thing the Blizzard Game
// Data API cannot serve — there is no currency endpoint — so it has to come from DB2
// via wago.tools. nazumods/wow already runs that generator on a schedule and publishes
// the result, so this repo consumes the artifact instead of duplicating the pipeline.
//
// Fetched at DEVELOPMENT time and committed, deliberately — same contract as the
// battlenet-wow-client vendoring next to it. The build must never depend on the network,
// and the shipped app must never depend on a release staying reachable.
//
// Usage:
//   node scripts/fetch-static-data.mjs          # fetch + write if changed
//   node scripts/fetch-static-data.mjs --check  # report only, never writes
//
// Exit codes are a contract — the scheduled staleness watch keys on them to decide
// whether a run is actionable, so "newer bundle available" and "nothing published
// yet" must not collapse into the same non-zero code:
//
//   0  up to date (or, without --check, written successfully)
//   1  a newer bundle is available          -> ACTIONABLE, notify
//   2  nothing published yet / no asset     -> not actionable, stay silent
//   3  fetch or validation failed           -> ACTIONABLE, something is broken

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const vendorDir = join(repoRoot, "src", "vendor", "wow-static-data");
const bundlePath = join(vendorDir, "static-data.json");

export const SOURCE_REPO = "nazumods/wow";
/**
 * Releases carrying the bundle are tagged `app-static-data-v<build>-<sha8>`.
 *
 * The `app-` segment is not decoration: nazumods/wow's CurseForge publisher skips
 * every tag starting with `app-`, which is why the data releases are named this way.
 * They are also published with `latest=false`, so `/releases/latest` will NOT find
 * them — the newest must be resolved by scanning the list.
 */
export const TAG_PREFIX = "app-static-data-v";
export const ASSET_NAME = "static-data.json";

/** Exit codes — see the header comment. Consumed by the scheduled staleness watch. */
export const EXIT = {
  OK: 0,
  STALE: 1,
  NOT_PUBLISHED: 2,
  BROKEN: 3,
};

/**
 * Pick the newest bundle release from a GitHub releases payload.
 *
 * The API returns releases newest-first, so the first prefix match wins. Returns null
 * when nothing matches — the normal state before the first bundle is published.
 */
export function selectBundleRelease(releases) {
  if (!Array.isArray(releases)) return null;
  return (
    releases.find((r) => typeof r?.tag_name === "string" && r.tag_name.startsWith(TAG_PREFIX)) ??
    null
  );
}

/** Find the bundle asset's download URL on a release, or null if it isn't attached. */
export function selectAssetUrl(release) {
  const asset = release?.assets?.find((a) => a?.name === ASSET_NAME);
  return asset?.browser_download_url ?? null;
}

/**
 * The build string a bundle came from, for reporting.
 * Falls back to the tag when the JSON is unreadable so a corrupt file still names itself.
 */
export function bundleBuild(json, tagName = "unknown") {
  try {
    return JSON.parse(json)?.build ?? tagName;
  } catch {
    return tagName;
  }
}

/** Normalize to LF so a re-fetch is deterministic regardless of platform. */
function normalize(text) {
  return text.replace(/\r\n/g, "\n");
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      accept: "application/vnd.github+json",
      "user-agent": "wow-companion-vendor",
    },
  });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status} ${res.statusText}`);
  return res.json();
}

async function main() {
  const check = process.argv.includes("--check");

  const releases = await fetchJson(
    `https://api.github.com/repos/${SOURCE_REPO}/releases?per_page=100`,
  );
  const release = selectBundleRelease(releases);
  if (!release) {
    // Not an error: the publisher simply hasn't run yet. Distinct from STALE so an
    // unattended watch can stay silent instead of nagging daily about nothing.
    console.error(`No release tagged '${TAG_PREFIX}*' found in ${SOURCE_REPO}.`);
    console.error(
      "The bundle publisher may not have run yet. See src/vendor/wow-static-data/VENDORED.md.",
    );
    process.exit(EXIT.NOT_PUBLISHED);
  }

  const url = selectAssetUrl(release);
  if (!url) {
    console.error(`Release ${release.tag_name} has no '${ASSET_NAME}' asset.`);
    process.exit(EXIT.NOT_PUBLISHED);
  }

  const res = await fetch(url, { headers: { "user-agent": "wow-companion-vendor" } });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status} ${res.statusText}`);
  const incoming = normalize(await res.text());

  // Parse before writing: a truncated or HTML-error response must not land in the tree.
  let parsed;
  try {
    parsed = JSON.parse(incoming);
  } catch (err) {
    console.error(`Downloaded asset is not valid JSON (${err.message}) - refusing to write.`);
    process.exit(EXIT.BROKEN);
  }
  const count = Object.keys(parsed?.currencies ?? {}).length;
  if (count === 0) {
    console.error("Downloaded bundle has no currencies - refusing to write.");
    process.exit(EXIT.BROKEN);
  }

  const previous = existsSync(bundlePath) ? normalize(readFileSync(bundlePath, "utf8")) : null;
  const build = bundleBuild(incoming, release.tag_name);

  if (previous === incoming) {
    console.log(`= static-data.json unchanged (build ${build}, ${count} currencies).`);
    return;
  }

  if (check) {
    console.error(`! static-data.json is stale - ${release.tag_name} (build ${build}) is newer.`);
    console.error("  Run `npm run vendor:static-data` to update it.");
    process.exit(EXIT.STALE);
  }

  mkdirSync(vendorDir, { recursive: true });
  writeFileSync(bundlePath, incoming);
  console.log(
    `+ static-data.json updated to build ${build} (${count} currencies) from ${release.tag_name}.`,
  );
}

// Only run when invoked directly, so the tests can import the helpers above.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((err) => {
    // A thrown error is a fetch/network failure, not staleness — must not exit 1.
    console.error(err.message);
    process.exit(EXIT.BROKEN);
  });
}
