import { EmptyState } from "../../../components/shared/empty-state";
import { MetricCard } from "../../../components/shared/metric-card";
import { PageHeader } from "../../../components/shared/page-header";

const DASHBOARD_METRICS = [
  {
    label: "Active Crew Members",
    value: "48",
    hint: "Distributed across 5 countries"
  },
  {
    label: "Open Time Off Requests",
    value: "7",
    hint: "2 are pending manager review"
  },
  {
    label: "Onboarding Tasks Due",
    value: "11",
    hint: "Due within the next 14 days"
  },
  {
    label: "Compliance Deadlines",
    value: "5",
    hint: "Upcoming items for this month"
  }
];

export default function DashboardPage() {
  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Phase 1.1 shell placeholder using Crew Hub shared design components."
      />

      <section className="metric-grid" aria-label="Dashboard metrics">
        {DASHBOARD_METRICS.map((metric) => (
          <MetricCard
            key={metric.label}
            label={metric.label}
            value={metric.value}
            hint={metric.hint}
          />
        ))}
      </section>

      <EmptyState
        title="Module data is not connected yet"
        description="This dashboard confirms shell layout, responsive navigation, command palette, and topbar interactions."
        ctaLabel="Open settings"
        ctaHref="/settings"
      />
    </>
  );
}
