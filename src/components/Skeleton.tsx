import type { CSSProperties } from "react";

/**
 * A single shimmering placeholder block. Cosmetic, so it's `aria-hidden` — the surrounding
 * `SkeletonTable`/`SkeletonLines` wrapper carries the `role="status"` that announces "loading".
 */
export function Skeleton({
  width = "100%",
  height = "1em",
  radius = 6,
  style,
}: {
  width?: number | string;
  height?: number | string;
  radius?: number | string;
  style?: CSSProperties;
}) {
  return (
    <span
      className="skeleton"
      aria-hidden="true"
      style={{ width, height, borderRadius: radius, ...style }}
    />
  );
}

/** A busy status wrapper announcing loading to assistive tech, with a visually-hidden label. */
function Loading({ children }: { children: React.ReactNode }) {
  return (
    <div role="status" aria-busy="true" aria-live="polite">
      <span className="visually-hidden">Loading…</span>
      {children}
    </div>
  );
}

/** A table-shaped skeleton: `rows` × `columns` shimmer cells. For grid/table views. */
export function SkeletonTable({ rows = 6, columns = 3 }: { rows?: number; columns?: number }) {
  return (
    <Loading>
      <div className="skeleton-table">
        {Array.from({ length: rows * columns }, (_, i) => (
          <Skeleton key={i} height="1.1em" />
        ))}
      </div>
    </Loading>
  );
}

/** A stack of shimmer lines (the last one shortened), for prose/stat blocks. */
export function SkeletonLines({ lines = 3 }: { lines?: number }) {
  return (
    <Loading>
      <div className="skeleton-lines">
        {Array.from({ length: lines }, (_, i) => (
          <Skeleton key={i} height="1.1em" width={i === lines - 1 ? "60%" : "100%"} />
        ))}
      </div>
    </Loading>
  );
}
