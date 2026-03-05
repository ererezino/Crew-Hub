export function DashboardSkeleton() {
  return (
    <section className="dashboard-v2-skeleton" aria-hidden="true">
      <div className="dashboard-v2-skeleton-greeting" />
      <div className="dashboard-widget-grid">
        {Array.from({ length: 6 }, (_, index) => (
          <div
            key={`widget-skeleton-${index}`}
            className="dashboard-widget-skeleton"
          />
        ))}
      </div>
    </section>
  );
}

export function WidgetSkeleton() {
  return (
    <div className="dashboard-widget-skeleton" aria-hidden="true" />
  );
}
