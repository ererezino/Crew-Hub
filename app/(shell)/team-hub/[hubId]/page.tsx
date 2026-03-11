import { getTranslations } from "next-intl/server";

import { EmptyState } from "../../../../components/shared/empty-state";
import { PageHeader } from "../../../../components/shared/page-header";
import { getAuthenticatedSession } from "../../../../lib/auth/session";
import { hasAnyRole } from "../../../../lib/roles";
import { HubHomeClient } from "./hub-home-client";

type HubPageProps = {
  params: Promise<{
    hubId: string;
  }>;
};

export default async function HubPage({ params }: HubPageProps) {
  const session = await getAuthenticatedSession();
  const t = await getTranslations("teamHub");
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

  const { hubId } = await params;
  const roles = session.profile.roles;
  const isLeadOrAdmin = hasAnyRole(roles, [
    "TEAM_LEAD",
    "MANAGER",
    "HR_ADMIN",
    "SUPER_ADMIN"
  ]);

  return <HubHomeClient hubId={hubId} isLeadOrAdmin={isLeadOrAdmin} />;
}
