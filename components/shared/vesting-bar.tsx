type VestingBarProps = {
  vestedPercent: number;
  cliffPercent: number;
  todayOffsetPercent: number;
};

function clampPercentage(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(100, Math.max(0, value));
}

export function VestingBar({
  vestedPercent,
  cliffPercent,
  todayOffsetPercent
}: VestingBarProps) {
  const safeVested = clampPercentage(vestedPercent);
  const safeCliff = clampPercentage(cliffPercent);
  const safeTodayOffset = clampPercentage(todayOffsetPercent);

  return (
    <div className="vesting-bar-root" role="img" aria-label={`Vesting progress ${safeVested.toFixed(1)} percent`}>
      <div className="vesting-bar-track">
        <div className="vesting-bar-cliff" style={{ width: `${safeCliff}%` }} />
        <div className="vesting-bar-vested" style={{ width: `${safeVested}%` }} />
      </div>
      <span className="vesting-bar-today-marker" style={{ left: `${safeTodayOffset}%` }} aria-hidden="true" />
    </div>
  );
}
