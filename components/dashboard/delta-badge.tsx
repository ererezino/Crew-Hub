type DeltaBadgeProps = {
  current: number;
  previous: number;
};

export function DeltaBadge({ current, previous }: DeltaBadgeProps) {
  if (previous === 0 && current === 0) return null;

  const delta =
    previous === 0
      ? current > 0
        ? 100
        : 0
      : ((current - previous) / Math.abs(previous)) * 100;

  const isPositive = delta > 0;
  const isNeutral = delta === 0;

  const displayValue =
    Math.abs(delta) >= 1000
      ? `${(Math.abs(delta) / 100).toFixed(0)}x`
      : `${Math.abs(delta).toFixed(1)}%`;

  const arrowUp = "M4 8l4-4 4 4";
  const arrowDown = "M4 4l4 4 4-4";

  return (
    <span
      className={[
        "delta-badge",
        isNeutral
          ? "delta-badge-neutral"
          : isPositive
            ? "delta-badge-up"
            : "delta-badge-down"
      ].join(" ")}
    >
      {!isNeutral && (
        <svg width={12} height={12} viewBox="0 0 12 12" aria-hidden="true">
          <path
            d={isPositive ? arrowUp : arrowDown}
            stroke="currentColor"
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </svg>
      )}
      {isPositive ? "+" : isNeutral ? "" : "-"}
      {displayValue}
    </span>
  );
}
