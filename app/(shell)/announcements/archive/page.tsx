import { EmptyState } from "../../../../components/shared/empty-state";
import { PageHeader } from "../../../../components/shared/page-header";
import { getAuthenticatedSession } from "../../../../lib/auth/session";
import { hasRole } from "../../../../lib/roles";
import { AnnouncementsArchiveClient } from "./announcements-archive-client";

export default async function AnnouncementsArchivePage() {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return (
      <>
        <PageHeader
          title="Announcements archive"
          description="Previously dismissed announcements."
        />
        <EmptyState
          title="Profile is unavailable"
          description="No profile is linked to this account yet."
        />
      </>
    );
  }

  const isSuperAdmin = hasRole(session.profile.roles, "SUPER_ADMIN");

  return <AnnouncementsArchiveClient isSuperAdmin={isSuperAdmin} />;
}
