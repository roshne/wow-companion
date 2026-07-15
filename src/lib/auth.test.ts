import { describe, it, expect, vi } from "vitest";
import { onUnauthorized, notifyUnauthorized } from "./auth";

describe("auth pub/sub", () => {
  it("delivers a notification to a subscriber", () => {
    const listener = vi.fn();
    const off = onUnauthorized(listener);
    notifyUnauthorized();
    expect(listener).toHaveBeenCalledTimes(1);
    off();
  });

  it("delivers to every subscriber", () => {
    const a = vi.fn();
    const b = vi.fn();
    const offA = onUnauthorized(a);
    const offB = onUnauthorized(b);
    notifyUnauthorized();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    offA();
    offB();
  });

  it("stops delivering after unsubscribe", () => {
    const listener = vi.fn();
    const off = onUnauthorized(listener);
    off();
    notifyUnauthorized();
    expect(listener).not.toHaveBeenCalled();
  });

  it("is safe to notify with no subscribers", () => {
    expect(() => notifyUnauthorized()).not.toThrow();
  });
});
