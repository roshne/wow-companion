import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Skeleton, SkeletonTable, SkeletonLines } from "./Skeleton";

describe("Skeleton primitives", () => {
  it("renders a single aria-hidden shimmer block", () => {
    const { container } = render(<Skeleton />);
    const block = container.querySelector(".skeleton");
    expect(block).toBeInTheDocument();
    expect(block).toHaveAttribute("aria-hidden", "true");
  });

  it("SkeletonTable renders a busy status with rows × columns cells", () => {
    const { container } = render(<SkeletonTable rows={4} columns={3} />);
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-busy", "true");
    expect(container.querySelectorAll(".skeleton")).toHaveLength(12);
    // A visually-hidden label announces loading to assistive tech.
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });

  it("SkeletonLines renders one shimmer per line inside a status region", () => {
    const { container } = render(<SkeletonLines lines={5} />);
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(container.querySelectorAll(".skeleton")).toHaveLength(5);
  });
});
