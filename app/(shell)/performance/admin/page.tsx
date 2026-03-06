import { EmptyState } from "../../../../components/shared/empty-state";
import { PageHeader } from "../../../../components/shared/page-header";
import { getAuthenticatedSession } from "../../../../lib/auth/session";
import { hasRole } from "../../../../lib/roles";
import { AdminPerformanceClient } from "./performance-admin-client";

export default async function PerformanceAdminPage() {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return (
      <>
        <PageHeader
          title="Performance Admin"
          description="Run review cycles, track completion, and calibrate fairly."
        />
        <EmptyState
          title="Profile is unavailable"
          description="No profile is linked to this account yet."
        />
      </>
    );
  }

  const canManagePerformance =
    hasRole(session.profile.roles, "HR_ADMIN") ||
    hasRole(session.profile.roles, "SUPER_ADMIN");

  if (!canManagePerformance) {
    return (
      <>
        <PageHeader
          title="Performance Admin"
          description="Run review cycles, track completion, and calibrate fairly."
        />
        <EmptyState
          title="Access denied"
          description="Only HR Admin and Super Admin can access performance admin tools."
          ctaLabel="Back to performance"
          ctaHref="/performance"
        />
      </>
    );
  }

  return <AdminPerformanceClient />;
}
