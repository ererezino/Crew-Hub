import { EmptyState } from "../../../../../components/shared/empty-state";
import { getAuthenticatedSession } from "../../../../../lib/auth/session";
import { hasRole } from "../../../../../lib/roles";
import { LearningReportsClient } from "./learning-reports-client";

export default async function LearningReportsPage() {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return (
      <EmptyState
        title="Profile is unavailable"
        description="No profile is linked to this account yet."
        ctaLabel="Back to learning admin"
        ctaHref="/admin/learning"
      />
    );
  }

  const canViewReports =
    hasRole(session.profile.roles, "HR_ADMIN") ||
    hasRole(session.profile.roles, "SUPER_ADMIN");

  if (!canViewReports) {
    return (
      <EmptyState
        title="Learning reports are restricted"
        description="Only HR Admin and Super Admin can view learning reports."
        ctaLabel="Open learning"
        ctaHref="/learning"
      />
    );
  }

  return <LearningReportsClient />;
}
