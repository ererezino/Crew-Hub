import { getTranslations } from "next-intl/server";

import { EmptyState } from "../../../../components/shared/empty-state";
import { PageHeader } from "../../../../components/shared/page-header";
import { getAuthenticatedSession } from "../../../../lib/auth/session";
import { hasRole } from "../../../../lib/roles";
import { AnnouncementsArchiveClient } from "./announcements-archive-client";

export default async function AnnouncementsArchivePage() {
  const session = await getAuthenticatedSession();
  const t = await getTranslations("announcements");
  const tCommon = await getTranslations("common");

  if (!session?.profile) {
    return (
      <>
        <PageHeader
          title={t("archiveTitle")}
          description={t("archiveDescription")}
        />
        <EmptyState
          title={tCommon("emptyState.profileUnavailable")}
          description={tCommon("emptyState.profileUnavailableBody")}
        />
      </>
    );
  }

  const isSuperAdmin = hasRole(session.profile.roles, "SUPER_ADMIN");

  return <AnnouncementsArchiveClient isSuperAdmin={isSuperAdmin} />;
}
