import { EmptyState } from "../../../../components/shared/empty-state";
import { getAuthenticatedSession } from "../../../../lib/auth/session";
import { hasRole } from "../../../../lib/roles";
import { SchedulingSwapsClient } from "./scheduling-swaps-client";

export default async function SchedulingSwapsPage() {
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

  const canManageSwaps =
    hasRole(session.profile.roles, "MANAGER") ||
    hasRole(session.profile.roles, "HR_ADMIN") ||
    hasRole(session.profile.roles, "SUPER_ADMIN");

  return (
    <SchedulingSwapsClient
      currentUserId={session.profile.id}
      canManageSwaps={canManageSwaps}
    />
  );
}
