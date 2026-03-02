import { EmptyState } from "../../../../components/shared/empty-state";
import { getAuthenticatedSession } from "../../../../lib/auth/session";
import { hasRole } from "../../../../lib/roles";
import { SchedulingManageClient } from "./scheduling-manage-client";

export default async function SchedulingManagePage() {
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

  const canManage =
    hasRole(session.profile.roles, "TEAM_LEAD") ||
    hasRole(session.profile.roles, "MANAGER") ||
    hasRole(session.profile.roles, "HR_ADMIN") ||
    hasRole(session.profile.roles, "SUPER_ADMIN");

  if (!canManage) {
    return (
      <EmptyState
        title="Schedule management is restricted"
        description="Only team leads, managers, and admins can create or publish schedules."
        ctaLabel="Open Scheduling"
        ctaHref="/scheduling"
      />
    );
  }

  return <SchedulingManageClient />;
}
