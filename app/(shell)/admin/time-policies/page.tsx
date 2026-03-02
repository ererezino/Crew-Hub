import { EmptyState } from "../../../../components/shared/empty-state";
import { getAuthenticatedSession } from "../../../../lib/auth/session";
import { hasRole } from "../../../../lib/roles";
import { TimePoliciesClient } from "./time-policies-client";

export default async function TimePoliciesPage() {
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

  const canViewPolicies =
    hasRole(session.profile.roles, "HR_ADMIN") || hasRole(session.profile.roles, "SUPER_ADMIN");

  if (!canViewPolicies) {
    return (
      <EmptyState
        title="Time policies are restricted"
        description="Only HR Admin and Super Admin can review attendance policy settings."
        ctaLabel="Open Time & Attendance"
        ctaHref="/time-attendance"
      />
    );
  }

  return <TimePoliciesClient />;
}
