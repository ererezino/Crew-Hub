import { getTranslations } from "next-intl/server";

import { EmptyState } from "../../../../components/shared/empty-state";
import { PageHeader } from "../../../../components/shared/page-header";
import { getAuthenticatedSession } from "../../../../lib/auth/session";
import { hasRole } from "../../../../lib/roles";

import { AdminSurveysClient } from "./admin-surveys-client";

export default async function AdminSurveysPage() {
  const session = await getAuthenticatedSession();
  const t = await getTranslations("adminSurveys");
  const tSurveys = await getTranslations("surveys");
  const tCommon = await getTranslations("common");

  if (!session?.profile) {
    return (
      <>
        <PageHeader
          title={tSurveys("adminTitle")}
          description={tSurveys("adminDescription")}
        />
        <EmptyState
          title={tCommon("emptyState.profileUnavailable")}
          description={tCommon("emptyState.profileUnavailableBody")}
        />
      </>
    );
  }

  const canManageSurveys =
    hasRole(session.profile.roles, "HR_ADMIN") ||
    hasRole(session.profile.roles, "SUPER_ADMIN");

  if (!canManageSurveys) {
    return (
      <>
        <PageHeader
          title={tSurveys("adminTitle")}
          description={tSurveys("adminDescription")}
        />
        <EmptyState
          title={t("adminRestricted")}
          description={t("adminRestrictedDescription")}
          ctaLabel={t("openSurveys")}
          ctaHref="/surveys"
        />
      </>
    );
  }

  return <AdminSurveysClient />;
}
