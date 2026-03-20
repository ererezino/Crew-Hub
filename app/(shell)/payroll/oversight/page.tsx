import { getTranslations } from "next-intl/server";

import { EmptyState } from "../../../../components/shared/empty-state";
import { PageHeader } from "../../../../components/shared/page-header";
import { getAuthenticatedSession } from "../../../../lib/auth/session";
import { hasRole } from "../../../../lib/roles";
import { OversightClient } from "./oversight-client";

export default async function FinanceOversightPage() {
  const session = await getAuthenticatedSession();
  const profile = session?.profile ?? null;

  if (!profile) {
    const t = await getTranslations("common");
    return (
      <>
        <PageHeader
          title="Finance oversight"
          description="Cycles awaiting approval, payout blockers, and audit status"
        />
        <EmptyState
          title={t("emptyState.profileUnavailable")}
          description={t("emptyState.profileUnavailableBody")}
        />
      </>
    );
  }

  const allowed = hasRole(profile.roles, "FINANCE_APPROVER") || hasRole(profile.roles, "SUPER_ADMIN");

  if (!allowed) {
    const t = await getTranslations("common");
    return (
      <>
        <PageHeader
          title="Finance oversight"
          description="Cycles awaiting approval, payout blockers, and audit status"
        />
        <EmptyState
          title={t("emptyState.accessDenied")}
          description="You do not have permission to view finance oversight."
        />
      </>
    );
  }

  return <OversightClient />;
}
