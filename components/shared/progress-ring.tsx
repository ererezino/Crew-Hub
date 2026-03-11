"use client";

import { useTranslations } from "next-intl";

type ProgressRingProps = {
  value: number;
  label: string;
  size?: number;
};

function clampPercentage(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  if (value < 0) {
    return 0;
  }

  if (value > 100) {
    return 100;
  }

  return Math.round(value);
}

export function ProgressRing({ value, label, size = 116 }: ProgressRingProps) {
  const t = useTranslations("common");
  const normalizedValue = clampPercentage(value);
  const percentText = t("percentValue", { value: normalizedValue });
  const strokeWidth = 8;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference - (normalizedValue / 100) * circumference;

  return (
    <div className="progress-ring" role="img" aria-label={`${label}: ${percentText}`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="var(--border-default)"
          strokeWidth={strokeWidth}
          fill="none"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="var(--color-accent)"
          strokeWidth={strokeWidth}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <span className="progress-ring-value numeric">{percentText}</span>
      <span className="progress-ring-label">{label}</span>
    </div>
  );
}
