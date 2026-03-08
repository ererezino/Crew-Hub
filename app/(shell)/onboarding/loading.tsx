export default function OnboardingLoading() {
  return (
    <div className="page-loading" aria-hidden="true">
      <div className="table-skeleton-header" />
      <div className="table-skeleton" style={{ marginTop: "var(--space-4)" }}>
        <div className="table-skeleton-row" />
        <div className="table-skeleton-row" />
        <div className="table-skeleton-row" />
      </div>
    </div>
  );
}
