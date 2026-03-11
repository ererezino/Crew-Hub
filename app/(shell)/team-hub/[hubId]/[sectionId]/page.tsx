import { getTranslations } from "next-intl/server";

import { EmptyState } from "../../../../../components/shared/empty-state";
import { PageHeader } from "../../../../../components/shared/page-header";
import { getAuthenticatedSession } from "../../../../../lib/auth/session";
import { hasAnyRole } from "../../../../../lib/roles";
import { SectionClient } from "./section-client";

type SectionPageProps = {
  params: Promise<{
    hubId: string;
    sectionId: string;
  }>;
};

export default async function SectionPage({ params }: SectionPageProps) {
  const session = await getAuthenticatedSession();
  const t = await getTranslations("teamHubPage");
  const tCommon = await getTranslations("common");

  if (!session?.profile) {
    return (
      <>
        <PageHeader
          title={t("sectionTitle")}
          description={t("sectionDescription")}
        />
        <EmptyState
          title={tCommon("emptyState.profileUnavailable")}
          description={tCommon("emptyState.profileUnavailableBody")}
        />
      </>
    );
  }

  const { hubId, sectionId } = await params;
  const roles = session.profile.roles;
  const isLeadOrAdmin = hasAnyRole(roles, [
    "TEAM_LEAD",
    "MANAGER",
    "HR_ADMIN",
    "SUPER_ADMIN"
  ]);

  return (
    <SectionClient
      hubId={hubId}
      sectionId={sectionId}
      isLeadOrAdmin={isLeadOrAdmin}
    />
  );
}
