export function DashboardSkeleton() {
  return (
    <section className="dashboard-v2-skeleton" aria-hidden="true">
      <div className="dashboard-v2-skeleton-greeting" />
      <div className="dashboard-v2-hero-skeleton">
        {Array.from({ length: 4 }, (_, index) => (
          <div
            key={`hero-skeleton-${index}`}
            className="dashboard-v2-hero-skeleton-card"
          />
        ))}
      </div>
      <div className="dashboard-v2-chart-skeleton" />
      <div className="dashboard-v2-panels-skeleton">
        <div className="dashboard-v2-panel-skeleton" />
        <div className="dashboard-v2-panel-skeleton" />
      </div>
    </section>
  );
}
