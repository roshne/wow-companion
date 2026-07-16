import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

// jsdom here doesn't expose a global `localStorage` (and Node's experimental Web Storage is inert
// without a flag), so install a minimal in-memory store for the persistence helpers to run against.
function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? (store.get(key) as string) : null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
  } as Storage;
}

vi.stubGlobal("localStorage", createMemoryStorage());

// jsdom lacks ResizeObserver, which @tanstack/react-virtual attaches to the scroll element. A no-op
// stub lets the virtualizer mount; tests that need real dimensions mock `getBoundingClientRect`.
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

// Unmount React trees between tests so queries don't see stale DOM from a prior test.
afterEach(() => {
  cleanup();
});
