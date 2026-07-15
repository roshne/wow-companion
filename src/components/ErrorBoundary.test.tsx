import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ErrorBoundary } from "./ErrorBoundary";

function Boom({ crash, label = "content" }: { crash: boolean; label?: string }) {
  if (crash) throw new Error("kaboom");
  return <div>{label}</div>;
}

describe("ErrorBoundary", () => {
  // A caught render error is logged by React (and by the boundary) — keep test output clean.
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders children normally when they don't throw", () => {
    render(
      <ErrorBoundary>
        <Boom crash={false} label="all good" />
      </ErrorBoundary>,
    );
    expect(screen.getByText("all good")).toBeInTheDocument();
    expect(screen.queryByText("Something went wrong")).toBeNull();
  });

  it("renders the fallback (with the error message) when a child throws", () => {
    render(
      <ErrorBoundary>
        <Boom crash />
      </ErrorBoundary>,
    );
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(screen.getByText("kaboom")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });

  it("recovers when 'Try again' is clicked and the child no longer throws", () => {
    let crash = true;
    function Flaky() {
      if (crash) throw new Error("kaboom");
      return <div>recovered</div>;
    }
    render(
      <ErrorBoundary>
        <Flaky />
      </ErrorBoundary>,
    );
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();

    crash = false;
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(screen.getByText("recovered")).toBeInTheDocument();
  });

  it("auto-resets when resetKeys change (e.g. tab/region navigation)", () => {
    const { rerender } = render(
      <ErrorBoundary resetKeys={["token", "us"]}>
        <Boom crash />
      </ErrorBoundary>,
    );
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();

    rerender(
      <ErrorBoundary resetKeys={["realms", "us"]}>
        <Boom crash={false} label="fresh view" />
      </ErrorBoundary>,
    );
    expect(screen.getByText("fresh view")).toBeInTheDocument();
    expect(screen.queryByText("Something went wrong")).toBeNull();
  });
});
