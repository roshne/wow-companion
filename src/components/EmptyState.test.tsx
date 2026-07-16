import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { EmptyState } from "./EmptyState";

describe("EmptyState", () => {
  it("renders the message", () => {
    render(<EmptyState message="No results found." />);
    expect(screen.getByText("No results found.")).toBeInTheDocument();
  });

  it("omits the Retry button when no onRetry is given", () => {
    render(<EmptyState message="Nothing here." />);
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("shows a Retry button that calls onRetry when clicked", () => {
    const onRetry = vi.fn();
    render(<EmptyState message="Failed to load." onRetry={onRetry} />);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
