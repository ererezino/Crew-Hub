import { getTranslations } from "next-intl/server";

import { EmptyState } from "../../../../../../components/shared/empty-state";
import { PageHeader } from "../../../../../../components/shared/page-header";
import { getAuthenticatedSession } from "../../../../../../lib/auth/session";
import { hasAnyRole } from "../../../../../../lib/roles";
import { PageViewClient } from "./page-view-client";

type PageViewPageProps = {
  params: Promise<{
    hubId: string;
    sectionId: string;
    pageId: string;
  }>;
};

export default async function PageViewPage({ params }: PageViewPageProps) {
  const session = await getAuthenticatedSession();
  const t = await getTranslations("teamHubPage");
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

  const { hubId, sectionId, pageId } = await params;
  const roles = session.profile.roles;
  const isLeadOrAdmin = hasAnyRole(roles, [
    "TEAM_LEAD",
    "MANAGER",
    "HR_ADMIN",
    "SUPER_ADMIN"
  ]);

  return (
    <PageViewClient
      hubId={hubId}
      sectionId={sectionId}
      pageId={pageId}
      isLeadOrAdmin={isLeadOrAdmin}
    />
  );
}
