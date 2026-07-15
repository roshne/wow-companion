import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Unmount React trees between tests so queries don't see stale DOM from a prior test.
afterEach(() => {
  cleanup();
});
