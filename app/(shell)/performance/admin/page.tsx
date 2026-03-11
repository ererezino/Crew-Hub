import { getTranslations } from "next-intl/server";

import { EmptyState } from "../../../../components/shared/empty-state";
import { PageHeader } from "../../../../components/shared/page-header";
import { getAuthenticatedSession } from "../../../../lib/auth/session";
import { hasRole } from "../../../../lib/roles";
import { AdminPerformanceClient } from "./performance-admin-client";

export default async function PerformanceAdminPage() {
  const session = await getAuthenticatedSession();
  const t = await getTranslations("performanceAdmin");
  const tCommon = await getTranslations("common");

  if (!session?.profile) {
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

  const canManagePerformance =
    hasRole(session.profile.roles, "HR_ADMIN") ||
    hasRole(session.profile.roles, "SUPER_ADMIN");

  if (!canManagePerformance) {
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
