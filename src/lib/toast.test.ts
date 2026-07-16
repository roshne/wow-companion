import { describe, it, expect, vi } from "vitest";
import { onToast, notifyToast, notifyError } from "./toast";

describe("toast pub/sub", () => {
  it("delivers a toast to a subscriber", () => {
    const listener = vi.fn();
    const off = onToast(listener);
    notifyToast({ message: "hi", tone: "info" });
    expect(listener).toHaveBeenCalledWith({ message: "hi", tone: "info" });
    off();
  });

  it("delivers to every subscriber", () => {
    const a = vi.fn();
    const b = vi.fn();
    const offA = onToast(a);
    const offB = onToast(b);
    notifyToast({ message: "x", tone: "error" });
    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledOnce();
    offA();
    offB();
  });

  it("stops delivering after unsubscribe", () => {
    const listener = vi.fn();
    const off = onToast(listener);
    off();
    notifyToast({ message: "x", tone: "info" });
    expect(listener).not.toHaveBeenCalled();
  });

  it("notifyError publishes an error-tone toast", () => {
    const listener = vi.fn();
    const off = onToast(listener);
    notifyError("boom");
    expect(listener).toHaveBeenCalledWith({ message: "boom", tone: "error" });
    off();
  });

  it("is safe to notify with no subscribers", () => {
    expect(() => notifyError("nobody listening")).not.toThrow();
  });
});
