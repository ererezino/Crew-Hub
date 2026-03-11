import { getTranslations } from "next-intl/server";

import { EmptyState } from "../../../components/shared/empty-state";
import { PageHeader } from "../../../components/shared/page-header";
import { getAuthenticatedSession } from "../../../lib/auth/session";
import { hasAnyRole } from "../../../lib/roles";
import { TeamHubClient } from "./team-hub-client";

export default async function TeamHubPage() {
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

  const roles = session.profile.roles;
  const isAdmin = hasAnyRole(roles, ["HR_ADMIN", "SUPER_ADMIN"]);

  return (
    <TeamHubClient
      isAdmin={isAdmin}
      userDepartment={session.profile.department ?? null}
      userName={session.profile.full_name ?? t("aCrewMember")}
    />
  );
}
