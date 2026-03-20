import { getTranslations } from "next-intl/server";

import { EmptyState } from "../../../components/shared/empty-state";
import { getAuthenticatedSession } from "../../../lib/auth/session";
import { currentMonthKey } from "../../../lib/expenses";
import { fetchExpensesData } from "../../../lib/expenses/fetch-expenses-data";
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
    hasRole(session.profile.roles, "FINANCE_APPROVER") ||
    hasRole(session.profile.roles, "SUPER_ADMIN");

  const canViewReports =
    canApprove ||
    hasRole(session.profile.roles, "HR_ADMIN");

  const isAdmin =
    hasRole(session.profile.roles, "HR_ADMIN") ||
    hasRole(session.profile.roles, "FINANCE_ADMIN") ||
    hasRole(session.profile.roles, "FINANCE_APPROVER") ||
    hasRole(session.profile.roles, "SUPER_ADMIN");

  // Server-fetch current month's expenses so the table renders in the initial HTML.
  // If the fetch fails, render without initialData — the client will retry via API.
  const month = currentMonthKey();
  let initialExpensesData;

  try {
    initialExpensesData = await fetchExpensesData(session.profile, { month });
  } catch {
    // Graceful degradation: client will fetch on mount
  }

  return (
    <ExpensesClient
      currentUserId={session.profile.id}
      canViewReports={canViewReports}
      showEmployeeColumn={canApprove || isAdmin}
      initialExpensesData={initialExpensesData}
    />
  );
}
