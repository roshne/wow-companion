/**
 * The build ID shown in the app footer: `v1.0.0 (9502198)`.
 *
 * Lives here rather than inline in `vite.config.ts` so the format is a tested contract instead of
 * something only a release build would reveal. The config reads the commit (see `scripts/git-ref.mjs`),
 * composes the string here, and bakes the result in via `define` (see `__BUILD_ID__`).
 *
 * The commit, not a timestamp: a version alone can't distinguish two builds, and after 1.0 most
 * changes ship without moving it. A sha moves with the code regardless of the version number, and
 * names the exact source rather than merely when a machine happened to compile it.
 */

/** A build's source commit. `sha` is null when the build didn't come from a git checkout. */
export interface BuildRef {
  sha: string | null;
  dirty: boolean;
}

/**
 * The footer's build ID: `v<version> (<sha>)`, with `-dirty` appended when the tree had uncommitted
 * changes — without it a dev build would claim a commit whose code it isn't running. Falls back to a
 * bare `v<version>` when there's no sha to show (a build from a source tarball rather than a checkout).
 */
export function buildId(version: string, ref: BuildRef): string {
  if (!ref.sha) return `v${version}`;
  return `v${version} (${ref.sha}${ref.dirty ? "-dirty" : ""})`;
}
