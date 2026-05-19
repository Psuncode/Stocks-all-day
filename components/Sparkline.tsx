/**
 * Pure-SVG sparkline. Server-renderable, zero client JS.
 *
 * v3.0 T1 — mini sparkline embedded in scanner rows so the user can
 * eyeball momentum direction without clicking through. Closes come
 * from the universe candle history (last 30 closes typically).
 *
 * Color logic: emerald if last > first, red if last < first, zinc if
 * flat. Caller can override via `direction` prop (rarely useful).
 *
 * The component is `aria-hidden="true"` — it's a decorative visual.
 * Numeric data (price, ATR%, etc) is already in adjacent cells.
 */

type Direction = "up" | "down" | "auto";

export type SparklineProps = {
  closes: number[];
  width?: number;
  height?: number;
  direction?: Direction;
};

export function Sparkline({
  closes,
  width = 72,
  height = 24,
  direction = "auto",
}: SparklineProps) {
  if (!closes || closes.length < 2) {
    // Render an empty box so layout doesn't jump
    return (
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        aria-hidden="true"
        className="text-zinc-300"
      />
    );
  }

  const first = closes[0];
  const last = closes[closes.length - 1];
  let stroke = "currentColor";
  let colorClass = "text-zinc-400";
  let resolved: "up" | "down" | "flat" = "flat";
  if (direction === "up") resolved = "up";
  else if (direction === "down") resolved = "down";
  else if (last > first) resolved = "up";
  else if (last < first) resolved = "down";

  if (resolved === "up") colorClass = "text-emerald-600";
  else if (resolved === "down") colorClass = "text-red-600";

  let min = Infinity;
  let max = -Infinity;
  for (const c of closes) {
    if (c < min) min = c;
    if (c > max) max = c;
  }
  const range = max - min || 1;
  const n = closes.length;
  const stepX = n > 1 ? width / (n - 1) : 0;
  // Inset by 1px so stroke doesn't clip
  const innerH = height - 2;
  const points = closes.map((c, i) => {
    const x = i * stepX;
    const y = 1 + (1 - (c - min) / range) * innerH;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  const d = `M ${points.join(" L ")}`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
      className={colorClass}
    >
      <path
        d={d}
        fill="none"
        stroke={stroke}
        strokeWidth={1.25}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default Sparkline;
