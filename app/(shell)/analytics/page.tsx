import { EmptyState } from "../../../components/shared/empty-state";
import { PageHeader } from "../../../components/shared/page-header";
import { getAuthenticatedSession } from "../../../lib/auth/session";
import type { UserRole } from "../../../lib/navigation";
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
          description="Organization reporting across people, time off, payroll, and expenses."
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

  if (!canViewAnalytics(session.profile.roles)) {
    return (
      <>
        <PageHeader
          title="Analytics"
          description="Organization reporting across people, time off, payroll, and expenses."
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

  return <AnalyticsClient />;
}
