/**
 * The build stamp shown in the app footer.
 *
 * Lives here rather than inline in `vite.config.ts` so the "the timestamp self-drops at a stable
 * release" rule is a tested contract instead of something only a release build would reveal. The
 * config imports these and bakes the result in via `define` (see `__BUILD_ID__`).
 */

/** A build timestamp as `YYYYMMDD-HH:MM:SS`, in the build machine's local time. */
export function buildStamp(now: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const date = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}`;
  const time = `${p(now.getHours())}:${p(now.getMinutes())}:${p(now.getSeconds())}`;
  return `${date}-${time}`;
}

/**
 * True for a version that isn't a stable release: any `0.x` (pre-1.0) or any semver prerelease
 * (`1.0.0-rc.1`). These are the versions where knowing *which* build you're running matters.
 */
export function isPrerelease(version: string): boolean {
  return /^0\.|-/.test(version);
}

/**
 * The footer's version string: `v<version>` for a stable release, `v<version>-<stamp>` while pre-1.0
 * or prerelease. The timestamp is an alpha/beta aid for telling two same-version builds apart, so it
 * drops itself the moment the version goes stable — no separate change needed at the 1.0 bump.
 */
export function buildId(version: string, now: Date): string {
  return isPrerelease(version) ? `v${version}-${buildStamp(now)}` : `v${version}`;
}
