import { EmptyState } from "../../../components/shared/empty-state";
import { PageHeader } from "../../../components/shared/page-header";
import { getAuthenticatedSession } from "../../../lib/auth/session";
import { hasRole } from "../../../lib/roles";
import { PerformanceClient } from "./performance-client";

export default async function PerformancePage() {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return (
      <>
        <PageHeader
          title="Performance"
          description="Complete your reviews, track goals, and keep performance conversations moving."
        />
        <EmptyState
          title="Profile is unavailable"
          description="No profile is linked to this account yet."
          ctaLabel="Back to dashboard"
          ctaHref="/dashboard"
        />
      </>
    );
  }

  return (
    <PerformanceClient
      canManagePerformance={
        hasRole(session.profile.roles, "HR_ADMIN") ||
        hasRole(session.profile.roles, "SUPER_ADMIN")
      }
    />
  );
}
