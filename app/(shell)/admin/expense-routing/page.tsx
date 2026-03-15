import { getTranslations } from "next-intl/server";

import { EmptyState } from "../../../../components/shared/empty-state";
import { PageHeader } from "../../../../components/shared/page-header";
import { getAuthenticatedSession } from "../../../../lib/auth/session";
import type { UserRole } from "../../../../lib/navigation";
import { hasRole } from "../../../../lib/roles";
import { ExpenseRoutingClient } from "./expense-routing-client";

function canManageExpenseRouting(roles: readonly UserRole[]): boolean {
  return hasRole(roles, "SUPER_ADMIN");
}

export default async function ExpenseRoutingPage() {
  const session = await getAuthenticatedSession();
  const t = await getTranslations("expenseRouting");
  const tCommon = await getTranslations("common");

  if (!session?.profile) {
    return (
      <>
        <PageHeader
          title={t("pageTitle")}
          description={t("pageDescription")}
        />
        <EmptyState
          title={tCommon("emptyState.profileUnavailable")}
          description={tCommon("emptyState.profileUnavailableBody")}
        />
      </>
    );
  }

  if (!canManageExpenseRouting(session.profile.roles)) {
    return (
      <>
        <PageHeader
          title={t("pageTitle")}
          description={t("pageDescription")}
        />
        <EmptyState
          title={tCommon("emptyState.accessDenied")}
          description={t("accessDenied")}
        />
      </>
    );
  }

  return <ExpenseRoutingClient />;
}
