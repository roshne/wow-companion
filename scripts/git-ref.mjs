// The commit a build came from, for the footer's build ID.
//
// Lives here rather than inline in vite.config.ts for the same reason `src/lib/buildId.ts` does: the
// parsing is a tested contract, not something only a release build would reveal. Split so the pure
// half (parsing git's output) is unit-tested and only the process spawn is untestable.
//
// A build outside a git checkout — a source tarball, a vendored copy — is a supported case, not an
// error: `gitRef()` degrades to `{ sha: null }` and the footer falls back to a bare version.

import { execFileSync } from "node:child_process";

// Exactly the seven lowercase hex digits `git rev-parse --short=7` emits. Anything else — an empty
// result, an error message on stdout, a truncated read — is treated as "no sha" rather than shown.
const SHORT_SHA_RE = /^[0-9a-f]{7}$/;

/** A short sha parsed out of git's stdout, or null if it isn't one. */
export function parseSha(stdout) {
  if (typeof stdout !== "string") return null;
  const sha = stdout.trim();
  return SHORT_SHA_RE.test(sha) ? sha : null;
}

/**
 * Whether `git status --porcelain` reported anything. A dirty tree matters because the sha then names
 * a commit the build doesn't actually match — the one case the old build timestamp covered better.
 */
export function parseDirty(stdout) {
  return typeof stdout === "string" && stdout.trim().length > 0;
}

/** Run a git subcommand and return its stdout. Throws if git is missing or the command fails. */
function runGit(args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
}

/**
 * The build's source ref as `{ sha, dirty }`. Never throws: no git, no repository, or a detached or
 * empty checkout all yield `{ sha: null, dirty: false }`, and the caller renders a bare version.
 *
 * `run` is injectable so the tests can drive both halves without a real repository.
 */
export function gitRef(run = runGit) {
  let sha;
  try {
    sha = parseSha(run(["rev-parse", "--short=7", "HEAD"]));
  } catch {
    return { sha: null, dirty: false };
  }
  if (!sha) return { sha: null, dirty: false };

  let dirty = false;
  try {
    dirty = parseDirty(run(["status", "--porcelain"]));
  } catch {
    // The sha is already known and useful on its own; failing to assess cleanliness shouldn't discard it.
  }
  return { sha, dirty };
}
