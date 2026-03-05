export function CompensationSkeleton() {
  return (
    <section className="compensation-skeleton-layout" aria-hidden="true">
      <div className="compensation-skeleton-summary" />
      <div className="table-skeleton-header" />
      {Array.from({ length: 4 }, (_, index) => (
        <div key={`compensation-skeleton-table-${index}`} className="table-skeleton-row" />
      ))}
      <div className="compensation-skeleton-equity-grid">
        {Array.from({ length: 2 }, (_, index) => (
          <div key={`compensation-skeleton-equity-${index}`} className="compensation-skeleton-equity-card" />
        ))}
      </div>
      <div className="compensation-skeleton-timeline" />
    </section>
  );
}
