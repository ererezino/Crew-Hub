export default function TeamHubLoading() {
  return (
    <div className="page-loading" aria-hidden="true">
      <div className="table-skeleton-header" />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
          gap: "var(--space-4)",
          marginTop: "var(--space-4)"
        }}
      >
        {[1, 2, 3].map((n) => (
          <div key={n} className="card" style={{ padding: "var(--space-5)" }}>
            <div className="skeleton-block" style={{ height: 24, width: "60%", marginBottom: "var(--space-2)" }} />
            <div className="skeleton-block" style={{ height: 16, width: "40%", marginBottom: "var(--space-3)" }} />
            <div className="skeleton-block" style={{ height: 14, width: "80%" }} />
          </div>
        ))}
      </div>
    </div>
  );
}
