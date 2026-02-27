import { EmptyState } from "../../components/shared/empty-state";
import { PageHeader } from "../../components/shared/page-header";

export default function LoginPage() {
  return (
    <main className="standalone-page">
      <div className="standalone-card">
        <PageHeader
          title="Crew Hub Login"
          description="Authentication wiring arrives in Phase 1.2."
        />
        <EmptyState
          title="Sign-in is not connected yet"
          description="This placeholder route confirms navigation, command palette access, and layout flow for Crew Hub."
          ctaLabel="Go to dashboard"
          ctaHref="/dashboard"
        />
      </div>
    </main>
  );
}
