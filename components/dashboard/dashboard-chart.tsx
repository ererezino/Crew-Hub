"use client";

import { motion } from "framer-motion";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";

import { ChartTooltip } from "./chart-tooltip";
import type { DashboardPrimaryChart } from "../../types/dashboard";

type DashboardChartProps = {
  chart: DashboardPrimaryChart;
};

const CHART_COLORS = {
  primary: "var(--color-accent)",
  secondary: "var(--status-info-text)"
} as const;

export function DashboardChart({ chart }: DashboardChartProps) {
  return (
    <motion.article
      className="dashboard-v2-primary-chart"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        type: "spring",
        stiffness: 100,
        damping: 20,
        delay: 0.35
      }}
    >
      <h2 className="section-title">{chart.title}</h2>
      <ResponsiveContainer width="100%" height={300}>
        {chart.type === "area" ? (
          <AreaChart data={chart.data}>
            <defs>
              <linearGradient id="dash-area-primary" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={CHART_COLORS.primary} stopOpacity={0.2} />
                <stop offset="95%" stopColor={CHART_COLORS.primary} stopOpacity={0} />
              </linearGradient>
              <linearGradient id="dash-area-secondary" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={CHART_COLORS.secondary} stopOpacity={0.15} />
                <stop offset="95%" stopColor={CHART_COLORS.secondary} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid
              stroke="var(--border-subtle)"
              strokeDasharray="2 6"
              strokeOpacity={0.5}
              vertical={false}
            />
            <XAxis
              dataKey="label"
              tick={{ fill: "var(--text-muted)", fontSize: 12 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: "var(--text-muted)", fontSize: 12 }}
              axisLine={false}
              tickLine={false}
              width={48}
            />
            <Tooltip
              content={
                <ChartTooltip
                  format={chart.valueFormat ?? "number"}
                  currency={chart.currency}
                />
              }
            />
            <Area
              type="monotone"
              dataKey={chart.dataKey}
              name={chart.dataKey === "value" ? chart.title : chart.dataKey}
              stroke={CHART_COLORS.primary}
              strokeWidth={2.5}
              fill="url(#dash-area-primary)"
              dot={false}
              activeDot={{
                r: 5,
                fill: CHART_COLORS.primary,
                stroke: "var(--bg-canvas)",
                strokeWidth: 2
              }}
              animationDuration={1200}
              animationEasing="ease-out"
            />
            {chart.secondaryDataKey && (
              <Area
                type="monotone"
                dataKey={chart.secondaryDataKey}
                name={chart.secondaryDataKey}
                stroke={CHART_COLORS.secondary}
                strokeWidth={2}
                fill="url(#dash-area-secondary)"
                dot={false}
                animationDuration={1200}
                animationEasing="ease-out"
                animationBegin={200}
              />
            )}
          </AreaChart>
        ) : (
          <BarChart data={chart.data}>
            <CartesianGrid
              stroke="var(--border-subtle)"
              strokeDasharray="2 6"
              strokeOpacity={0.5}
              vertical={false}
            />
            <XAxis
              dataKey="label"
              tick={{ fill: "var(--text-muted)", fontSize: 12 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: "var(--text-muted)", fontSize: 12 }}
              axisLine={false}
              tickLine={false}
              width={48}
            />
            <Tooltip
              content={
                <ChartTooltip
                  format={chart.valueFormat ?? "number"}
                  currency={chart.currency}
                />
              }
            />
            <Bar
              dataKey={chart.dataKey}
              name={chart.dataKey === "value" ? chart.title : chart.dataKey}
              fill={CHART_COLORS.primary}
              radius={[6, 6, 0, 0]}
              animationDuration={1000}
              animationEasing="ease-out"
            />
          </BarChart>
        )}
      </ResponsiveContainer>
    </motion.article>
  );
}
