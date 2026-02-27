import { EmptyState } from "../../../../components/shared/empty-state";
import { getAuthenticatedSession } from "../../../../lib/auth/session";
import { hasRole } from "../../../../lib/roles";
import { TimeOffApprovalsClient } from "./approvals-client";

export default async function TimeOffApprovalsPage() {
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

  const canApprove =
    hasRole(session.profile.roles, "MANAGER") ||
    hasRole(session.profile.roles, "HR_ADMIN") ||
    hasRole(session.profile.roles, "SUPER_ADMIN");

  if (!canApprove) {
    return (
      <EmptyState
        title="Approvals are limited to managers and admins"
        description="You can still submit and track your own leave requests from the Time Off page."
        ctaLabel="Open Time Off"
        ctaHref="/time-off"
      />
    );
  }

  return <TimeOffApprovalsClient />;
}
