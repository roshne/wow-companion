/**
 * A dependency-light inline SVG sparkline. Normalizes `values` into the viewBox and draws a single
 * `<polyline>`; `stroke="currentColor"` so it themes with the surrounding text. Renders nothing until
 * there are at least two points to connect.
 */
export function Sparkline({
  values,
  width = 260,
  height = 44,
}: {
  values: number[];
  width?: number;
  height?: number;
}) {
  if (values.length < 2) return null;

  const pad = 2;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const stepX = (width - pad * 2) / (values.length - 1);

  const points = values
    .map((v, i) => {
      const x = pad + i * stepX;
      const y = pad + (height - pad * 2) * (1 - (v - min) / range);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Token price history"
      style={{ display: "block" }}
    >
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth={1.5} />
    </svg>
  );
}
