import { describe, expect, it } from "vitest";
import { gitRef, parseDirty, parseSha } from "./git-ref.mjs";

// A fake `run` driven by a map of subcommand -> stdout (or a thrown error). Keyed by the first arg so
// a test can make rev-parse succeed while status fails.
const fakeGit = (byCommand) => (args) => {
  const outcome = byCommand[args[0]];
  if (outcome instanceof Error) throw outcome;
  if (outcome === undefined) throw new Error(`unexpected git ${args[0]}`);
  return outcome;
};

describe("parseSha", () => {
  it("accepts the seven lowercase hex digits git emits, trimming the newline", () => {
    expect(parseSha("9502198\n")).toBe("9502198");
    expect(parseSha("  b4597ae  ")).toBe("b4597ae");
  });

  it.each([
    ["empty", ""],
    ["whitespace only", "\n"],
    ["too short", "950219"],
    ["too long", "9502198a"],
    ["uppercase", "9502ABC"],
    ["an error message", "fatal: not a git repository"],
    ["not a string", null],
  ])("rejects %s", (_label, stdout) => {
    expect(parseSha(stdout)).toBeNull();
  });
});

describe("parseDirty", () => {
  it("is false for the empty output of a clean tree", () => {
    expect(parseDirty("")).toBe(false);
    expect(parseDirty("\n")).toBe(false);
  });

  it("is true as soon as git names any changed path", () => {
    expect(parseDirty(" M src/App.tsx\n")).toBe(true);
    expect(parseDirty("?? scratch.txt\n")).toBe(true);
  });
});

describe("gitRef", () => {
  it("reports the sha and a clean tree", () => {
    const run = fakeGit({ "rev-parse": "9502198\n", status: "" });
    expect(gitRef(run)).toEqual({ sha: "9502198", dirty: false });
  });

  it("flags a dirty tree, since the sha then names a commit the build doesn't match", () => {
    const run = fakeGit({ "rev-parse": "9502198\n", status: " M src/App.tsx\n" });
    expect(gitRef(run)).toEqual({ sha: "9502198", dirty: true });
  });

  it("degrades to no sha outside a git checkout instead of throwing", () => {
    // A source tarball or a vendored copy is a supported way to build, not an error.
    const run = fakeGit({ "rev-parse": new Error("fatal: not a git repository") });
    expect(gitRef(run)).toEqual({ sha: null, dirty: false });
  });

  it("degrades to no sha when git prints something that isn't one", () => {
    const run = fakeGit({ "rev-parse": "", status: "" });
    expect(gitRef(run)).toEqual({ sha: null, dirty: false });
  });

  it("keeps a known sha even if the cleanliness check fails", () => {
    const run = fakeGit({ "rev-parse": "9502198\n", status: new Error("index locked") });
    expect(gitRef(run)).toEqual({ sha: "9502198", dirty: false });
  });
});
