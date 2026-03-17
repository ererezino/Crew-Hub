import { getTranslations } from "next-intl/server";

import { EmptyState } from "../../../../components/shared/empty-state";
import { PageHeader } from "../../../../components/shared/page-header";
import { checkPageAccess } from "../../../../lib/auth/check-page-access";
import { AdminPerformanceClient } from "./performance-admin-client";

export default async function PerformanceAdminPage() {
  const { allowed, profile } = await checkPageAccess("/performance");
  const t = await getTranslations("performanceAdmin");
  const tCommon = await getTranslations("common");

  if (!profile) {
    return (
      <>
        <PageHeader
          title={t("title")}
          description={t("description")}
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
          title={t("title")}
          description={t("description")}
        />
        <EmptyState
          title={tCommon("emptyState.accessDenied")}
          description={t("accessDeniedDescription")}
          ctaLabel={t("backToPerformance")}
          ctaHref="/performance"
        />
      </>
    );
  }

  return <AdminPerformanceClient />;
}
