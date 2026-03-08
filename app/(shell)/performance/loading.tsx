export default function PerformanceLoading() {
  return (
    <div className="page-loading" aria-hidden="true">
      <div className="table-skeleton-header" />
      <div style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-4)", marginBottom: "var(--space-4)" }}>
        <div className="skeleton-block" style={{ height: 36, width: 100, borderRadius: "var(--radius-md)" }} />
        <div className="skeleton-block" style={{ height: 36, width: 80, borderRadius: "var(--radius-md)" }} />
      </div>
      <div className="table-skeleton">
        <div className="table-skeleton-row" />
        <div className="table-skeleton-row" />
        <div className="table-skeleton-row" />
        <div className="table-skeleton-row" />
      </div>
    </div>
  );
}
