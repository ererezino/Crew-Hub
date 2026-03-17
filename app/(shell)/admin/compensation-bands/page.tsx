import { getTranslations } from "next-intl/server";

import { EmptyState } from "../../../../components/shared/empty-state";
import { PageHeader } from "../../../../components/shared/page-header";
import { checkPageAccess } from "../../../../lib/auth/check-page-access";
import { CompensationBandsClient } from "./compensation-bands-client";

export default async function CompensationBandsPage() {
  const { allowed, profile } = await checkPageAccess("/admin/compensation");
  const t = await getTranslations("compensationBands");
  const tCommon = await getTranslations("common");

  if (!profile) {
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

  if (!allowed) {
    return (
      <>
        <PageHeader
          title={t("pageTitle")}
          description={t("pageDescription")}
        />
        <EmptyState
          title={tCommon("emptyState.accessDenied")}
          description={t("accessDeniedDescription")}
        />
      </>
    );
  }

  return <CompensationBandsClient />;
}
