import { EmptyState } from "../../../components/shared/empty-state";
import { getAuthenticatedSession } from "../../../lib/auth/session";
import { hasRole } from "../../../lib/roles";
import { ExpensesClient } from "./expenses-client";

export default async function ExpensesPage() {
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
    hasRole(session.profile.roles, "FINANCE_ADMIN") ||
    hasRole(session.profile.roles, "SUPER_ADMIN");

  const canReimburse =
    hasRole(session.profile.roles, "FINANCE_ADMIN") ||
    hasRole(session.profile.roles, "SUPER_ADMIN");

  const isAdmin =
    hasRole(session.profile.roles, "HR_ADMIN") ||
    hasRole(session.profile.roles, "FINANCE_ADMIN") ||
    hasRole(session.profile.roles, "SUPER_ADMIN");

  return (
    <ExpensesClient
      currentUserId={session.profile.id}
      canApprove={canApprove}
      canReimburse={canReimburse}
      showEmployeeColumn={canApprove || isAdmin}
    />
  );
}
