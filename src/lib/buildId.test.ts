import { describe, it, expect } from "vitest";
import { buildId } from "./buildId";

describe("buildId", () => {
  it("names the version and the commit it was built from", () => {
    expect(buildId("1.0.0", { sha: "9502198", dirty: false })).toBe("v1.0.0 (9502198)");
  });

  it("distinguishes two builds of the same version, which is the whole point", () => {
    // After 1.0 most changes ship without moving the version, so the version alone can't identify a
    // build. The sha moves with every commit.
    const a = buildId("1.0.0", { sha: "9502198", dirty: false });
    const b = buildId("1.0.0", { sha: "b4597ae", dirty: false });
    expect(a).not.toBe(b);
  });

  it("marks a dirty tree, so a dev build doesn't claim code it isn't running", () => {
    expect(buildId("1.0.0", { sha: "9502198", dirty: true })).toBe("v1.0.0 (9502198-dirty)");
  });

  it("falls back to a bare version when there's no commit to name", () => {
    // Building from a source tarball rather than a checkout — supported, so it renders cleanly.
    expect(buildId("1.0.0", { sha: null, dirty: false })).toBe("v1.0.0");
    expect(buildId("1.0.0", { sha: null, dirty: true })).toBe("v1.0.0");
  });

  it("applies the same format pre-1.0 and to prereleases", () => {
    expect(buildId("0.5.0", { sha: "9502198", dirty: false })).toBe("v0.5.0 (9502198)");
    expect(buildId("1.0.0-rc.1", { sha: "9502198", dirty: false })).toBe("v1.0.0-rc.1 (9502198)");
  });
});
