import { describe, it, expect, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useMediaQuery } from "./useMediaQuery";

/**
 * Install a controllable `window.matchMedia`. Returns a `set(matches)` that flips the current match
 * state and fires the `change` listeners, so a test can simulate the viewport crossing the breakpoint.
 */
function installMatchMedia(initial: boolean) {
  let matches = initial;
  const listeners = new Set<() => void>();
  const mql = {
    get matches() {
      return matches;
    },
    media: "",
    onchange: null,
    addEventListener: (_type: string, cb: () => void) => listeners.add(cb),
    removeEventListener: (_type: string, cb: () => void) => listeners.delete(cb),
    addListener: (cb: () => void) => listeners.add(cb),
    removeListener: (cb: () => void) => listeners.delete(cb),
    dispatchEvent: () => false,
  };
  window.matchMedia = vi.fn().mockImplementation((query: string) => {
    mql.media = query;
    return mql;
  }) as unknown as typeof window.matchMedia;
  return {
    set(next: boolean) {
      matches = next;
      listeners.forEach((cb) => cb());
    },
  };
}

describe("useMediaQuery", () => {
  afterEach(() => {
    delete (window as Partial<Window & typeof globalThis>).matchMedia;
  });

  it("seeds from the media query's initial match state", () => {
    installMatchMedia(true);
    const { result } = renderHook(() => useMediaQuery("(max-width: 640px)"));
    expect(result.current).toBe(true);
  });

  it("updates when the media query fires a change", () => {
    const mm = installMatchMedia(false);
    const { result } = renderHook(() => useMediaQuery("(max-width: 640px)"));
    expect(result.current).toBe(false);

    act(() => mm.set(true));
    expect(result.current).toBe(true);

    act(() => mm.set(false));
    expect(result.current).toBe(false);
  });

  it("returns false when matchMedia is unavailable", () => {
    // No matchMedia installed (jsdom default).
    const { result } = renderHook(() => useMediaQuery("(max-width: 640px)"));
    expect(result.current).toBe(false);
  });
});
