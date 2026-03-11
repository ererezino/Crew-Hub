import { getTranslations } from "next-intl/server";

import { EmptyState } from "../../../components/shared/empty-state";
import { getAuthenticatedSession } from "../../../lib/auth/session";
import { hasRole } from "../../../lib/roles";
import { ExpensesClient } from "./expenses-client";

export default async function ExpensesPage() {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    const t = await getTranslations('common');
    return (
      <EmptyState
        title={t('emptyState.profileUnavailable')}
        description={t('emptyState.profileUnavailableBody')}
      />
    );
  }

  const canApprove =
    hasRole(session.profile.roles, "MANAGER") ||
    hasRole(session.profile.roles, "FINANCE_ADMIN") ||
    hasRole(session.profile.roles, "SUPER_ADMIN");

  const canViewReports =
    canApprove ||
    hasRole(session.profile.roles, "HR_ADMIN");

  const isAdmin =
    hasRole(session.profile.roles, "HR_ADMIN") ||
    hasRole(session.profile.roles, "FINANCE_ADMIN") ||
    hasRole(session.profile.roles, "SUPER_ADMIN");

  return (
    <ExpensesClient
      currentUserId={session.profile.id}
      canViewReports={canViewReports}
      showEmployeeColumn={canApprove || isAdmin}
    />
  );
}
