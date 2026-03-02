import { EmptyState } from "../../../../components/shared/empty-state";
import { getAuthenticatedSession } from "../../../../lib/auth/session";
import { hasRole } from "../../../../lib/roles";
import { LearningAdminClient } from "./learning-admin-client";

export default async function LearningAdminPage() {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return (
      <EmptyState
        title="Profile is unavailable"
        description="No profile is linked to this account yet."
        ctaLabel="Back to dashboard"
        ctaHref="/dashboard"
      />
    );
  }

  const canManageLearning =
    hasRole(session.profile.roles, "HR_ADMIN") ||
    hasRole(session.profile.roles, "SUPER_ADMIN");

  if (!canManageLearning) {
    return (
      <EmptyState
        title="Learning admin is restricted"
        description="Only HR Admin and Super Admin can manage learning courses."
        ctaLabel="Open learning"
        ctaHref="/learning"
      />
    );
  }

  return <LearningAdminClient />;
}
