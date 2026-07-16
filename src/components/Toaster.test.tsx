import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { Toaster } from "./Toaster";
import { notifyToast, notifyError } from "../lib/toast";

afterEach(() => vi.useRealTimers());

describe("Toaster", () => {
  it("renders nothing until a toast is published", () => {
    const { container } = render(<Toaster />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows a published toast as an alert", () => {
    render(<Toaster />);
    act(() => notifyError("Failed (HTTP 503)."));
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Failed (HTTP 503).");
    expect(alert).toHaveClass("toast-error");
  });

  it("dedupes an identical toast that's already visible", () => {
    render(<Toaster />);
    act(() => {
      notifyError("Failed (HTTP 503).");
      notifyError("Failed (HTTP 503).");
    });
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });

  it("shows distinct messages as separate toasts", () => {
    render(<Toaster />);
    act(() => {
      notifyError("Failed (HTTP 503).");
      notifyToast({ message: "Heads up.", tone: "info" });
    });
    expect(screen.getAllByRole("alert")).toHaveLength(2);
  });

  it("auto-dismisses a toast after the timeout", () => {
    vi.useFakeTimers();
    render(<Toaster />);
    act(() => notifyError("Failed (HTTP 500)."));
    expect(screen.getByRole("alert")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(6000));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("dismisses a toast when its close button is clicked", () => {
    render(<Toaster />);
    act(() => notifyError("Failed (HTTP 500)."));
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
