export function DashboardSkeleton() {
  return (
    <div className="home-page" aria-hidden="true">
      {/* Hero skeleton */}
      <div
        className="dashboard-widget-skeleton"
        style={{ height: 120, borderRadius: "var(--radius-modal)", marginBottom: "var(--space-3)" }}
      />

      {/* Metrics strip skeleton */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "var(--space-4)", marginBottom: "var(--space-3)" }}>
        {Array.from({ length: 4 }, (_, i) => (
          <div key={`metric-skeleton-${i}`} className="dashboard-widget-skeleton" style={{ height: 80 }} />
        ))}
      </div>

      {/* Action banner skeleton */}
      <div
        className="dashboard-widget-skeleton"
        style={{ height: 52, borderRadius: "var(--radius-card)", marginBottom: "var(--space-8)" }}
      />

      {/* Widget grid skeleton */}
      <div className="dashboard-widget-grid">
        {Array.from({ length: 6 }, (_, index) => (
          <div
            key={`widget-skeleton-${index}`}
            className="dashboard-widget-skeleton"
          />
        ))}
      </div>
    </div>
  );
}

export function WidgetSkeleton() {
  return (
    <div className="dashboard-widget-skeleton" aria-hidden="true" />
  );
}
