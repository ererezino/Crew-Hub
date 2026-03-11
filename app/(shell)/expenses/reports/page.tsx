import { getTranslations } from "next-intl/server";

import { EmptyState } from "../../../../components/shared/empty-state";
import { PageHeader } from "../../../../components/shared/page-header";
import { getAuthenticatedSession } from "../../../../lib/auth/session";
import type { UserRole } from "../../../../lib/navigation";
import { hasRole } from "../../../../lib/roles";
import { ExpenseReportsClient } from "./reports-client";

function canViewExpenseReports(roles: readonly UserRole[]): boolean {
  return (
    hasRole(roles, "MANAGER") ||
    hasRole(roles, "HR_ADMIN") ||
    hasRole(roles, "FINANCE_ADMIN") ||
    hasRole(roles, "SUPER_ADMIN")
  );
}

export default async function ExpenseReportsPage() {
  const session = await getAuthenticatedSession();
  const t = await getTranslations("expenseReports");
  const tCommon = await getTranslations("common");

  if (!session?.profile) {
    return (
      <>
        <PageHeader
          title={t("title")}
          description={t("pageDescription")}
        />
        <EmptyState
          title={tCommon("emptyState.profileUnavailable")}
          description={tCommon("emptyState.profileUnavailableBody")}
        />
      </>
    );
  }

  if (!canViewExpenseReports(session.profile.roles)) {
    return (
      <>
        <PageHeader
          title={t("title")}
          description={t("pageDescription")}
        />
        <EmptyState
          title={tCommon("emptyState.accessDenied")}
          description={t("accessDeniedDescription")}
          ctaLabel={t("openExpenses")}
          ctaHref="/expenses"
        />
      </>
    );
  }

  return <ExpenseReportsClient />;
}
