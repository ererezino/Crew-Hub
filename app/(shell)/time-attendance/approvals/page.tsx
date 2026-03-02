import { EmptyState } from "../../../../components/shared/empty-state";
import { getAuthenticatedSession } from "../../../../lib/auth/session";
import { hasRole } from "../../../../lib/roles";
import { TimeAttendanceApprovalsClient } from "./approvals-client";

export default async function TimeAttendanceApprovalsPage() {
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

  const canReview =
    hasRole(session.profile.roles, "TEAM_LEAD") ||
    hasRole(session.profile.roles, "MANAGER") ||
    hasRole(session.profile.roles, "HR_ADMIN") ||
    hasRole(session.profile.roles, "FINANCE_ADMIN") ||
    hasRole(session.profile.roles, "SUPER_ADMIN");

  if (!canReview) {
    return (
      <EmptyState
        title="Approvals are limited to team leads, managers, and admins"
        description="You can still review your own records from the Time & Attendance page."
        ctaLabel="Open Time & Attendance"
        ctaHref="/time-attendance"
      />
    );
  }

  return <TimeAttendanceApprovalsClient />;
}
