import { describe, it, expect } from "vitest";
import { buildId, buildStamp, isPrerelease } from "./buildId";

// A fixed local-time instant: 2026-07-22 09:05:03.
const AT = new Date(2026, 6, 22, 9, 5, 3);

describe("buildStamp", () => {
  it("formats the local build time as YYYYMMDD-HH:MM:SS, zero-padded", () => {
    expect(buildStamp(AT)).toBe("20260722-09:05:03");
  });
});

describe("isPrerelease", () => {
  it("treats every 0.x and every semver prerelease as pre-stable", () => {
    expect(isPrerelease("0.1.0")).toBe(true);
    expect(isPrerelease("0.5.0")).toBe(true);
    expect(isPrerelease("1.0.0-rc.1")).toBe(true);
    expect(isPrerelease("2.3.4-beta")).toBe(true);
  });

  it("treats a plain 1.0.0-and-up as stable", () => {
    expect(isPrerelease("1.0.0")).toBe(false);
    expect(isPrerelease("10.2.1")).toBe(false);
  });
});

describe("buildId", () => {
  it("stamps a pre-1.0 build with its build time, so two 0.5.0 builds are distinguishable", () => {
    expect(buildId("0.5.0", AT)).toBe("v0.5.0-20260722-09:05:03");
  });

  it("stamps a prerelease too", () => {
    expect(buildId("1.0.0-rc.1", AT)).toBe("v1.0.0-rc.1-20260722-09:05:03");
  });

  it("drops the stamp at a stable release — the footer reads just the version", () => {
    // The contract the 1.0 bump relies on: bumping the version is the whole change, with no separate
    // edit needed to retire the timestamp.
    expect(buildId("1.0.0", AT)).toBe("v1.0.0");
  });
});
