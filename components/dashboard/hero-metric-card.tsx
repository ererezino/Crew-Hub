"use client";

import { AnimatedNumber } from "./animated-number";
import { DeltaBadge } from "./delta-badge";
import { Sparkline } from "./sparkline";
import type { DashboardHeroMetric } from "../../types/dashboard";

type HeroMetricCardProps = {
  metric: DashboardHeroMetric;
  index: number;
};

export function HeroMetricCard({ metric, index }: HeroMetricCardProps) {
  return (
    <article
      className="hero-metric-card dashboard-fade-in"
      style={{ animationDelay: `${index * 0.08}s` }}
    >
      <div className="hero-metric-header">
        <p className="hero-metric-label">{metric.label}</p>
        <DeltaBadge current={metric.value} previous={metric.previousValue} />
      </div>
      <div className="hero-metric-body">
        <AnimatedNumber
          value={metric.value}
          format={metric.format}
          currency={metric.currency}
          className="hero-metric-value numeric"
        />
        <Sparkline
          data={metric.sparkline}
          width={80}
          height={36}
          color="var(--color-accent)"
          className="hero-metric-sparkline"
        />
      </div>
    </article>
  );
}
