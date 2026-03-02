import { useId } from "react";

type SparklineProps = {
  data: { value: number }[];
  width?: number;
  height?: number;
  color?: string;
  className?: string;
};

export function Sparkline({
  data,
  width = 80,
  height = 36,
  color = "var(--color-accent)",
  className
}: SparklineProps) {
  const id = useId();

  if (data.length < 2) return null;

  const values = data.map((d) => d.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const padding = 2;
  const plotWidth = width - padding * 2;
  const plotHeight = height - padding * 2;

  const coords = values.map((v, i) => {
    const x = padding + (i / (values.length - 1)) * plotWidth;
    const y = padding + plotHeight - ((v - min) / range) * plotHeight;
    return { x, y };
  });

  const polylinePoints = coords.map((c) => `${c.x},${c.y}`).join(" ");

  const firstX = coords[0].x;
  const lastX = coords[coords.length - 1].x;
  const bottomY = padding + plotHeight;
  const fillPath = [
    `M${firstX},${bottomY}`,
    ...coords.map((c) => `L${c.x},${c.y}`),
    `L${lastX},${bottomY}`,
    "Z"
  ].join(" ");

  const gradientId = `sparkline-grad-${id}`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.25} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={fillPath} fill={`url(#${gradientId})`} />
      <polyline
        points={polylinePoints}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
