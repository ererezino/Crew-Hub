import { EmptyState } from "../../../components/shared/empty-state";
import { PageHeader } from "../../../components/shared/page-header";
import { getAuthenticatedSession } from "../../../lib/auth/session";
import { normalizeUserRoles, type UserRole } from "../../../lib/navigation";
import { hasRole } from "../../../lib/roles";
import { AnalyticsClient } from "./analytics-client";

function canViewAnalytics(roles: readonly UserRole[]): boolean {
  return (
    hasRole(roles, "HR_ADMIN") ||
    hasRole(roles, "FINANCE_ADMIN") ||
    hasRole(roles, "SUPER_ADMIN")
  );
}

export default async function AnalyticsPage() {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return (
      <>
        <PageHeader
          title="Analytics"
          description="Track workforce and operations trends with filters and exports for decision-making."
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

  const userRoles = normalizeUserRoles(session.profile.roles);

  if (!canViewAnalytics(userRoles)) {
    return (
      <>
        <PageHeader
          title="Analytics"
          description="Track workforce and operations trends with filters and exports for decision-making."
        />
        <EmptyState
          title="Access denied"
          description="Only HR Admin, Finance Admin, and Super Admin can access analytics."
          ctaLabel="Back to dashboard"
          ctaHref="/dashboard"
        />
      </>
    );
  }

  return <AnalyticsClient userRoles={userRoles} />;
}
