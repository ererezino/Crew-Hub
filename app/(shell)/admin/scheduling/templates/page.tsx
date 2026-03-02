import { EmptyState } from "../../../../../components/shared/empty-state";
import { getAuthenticatedSession } from "../../../../../lib/auth/session";
import { hasRole } from "../../../../../lib/roles";
import { SchedulingTemplatesAdminClient } from "./scheduling-templates-admin-client";

export default async function SchedulingTemplatesAdminPage() {
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

  const canManageTemplates =
    hasRole(session.profile.roles, "MANAGER") ||
    hasRole(session.profile.roles, "HR_ADMIN") ||
    hasRole(session.profile.roles, "SUPER_ADMIN");

  if (!canManageTemplates) {
    return (
      <EmptyState
        title="Template management is restricted"
        description="Only managers and admins can manage shift templates."
        ctaLabel="Open Scheduling"
        ctaHref="/scheduling"
      />
    );
  }

  return <SchedulingTemplatesAdminClient />;
}
