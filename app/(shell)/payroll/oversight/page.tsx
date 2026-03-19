import { getTranslations } from "next-intl/server";

import { EmptyState } from "../../../../components/shared/empty-state";
import { PageHeader } from "../../../../components/shared/page-header";
import { checkPageAccess } from "../../../../lib/auth/check-page-access";
import { OversightClient } from "./oversight-client";

export default async function FinanceOversightPage() {
  const { allowed, profile } = await checkPageAccess("/payroll");

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
