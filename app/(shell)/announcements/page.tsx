import { EmptyState } from "../../../components/shared/empty-state";
import { PageHeader } from "../../../components/shared/page-header";
import { getAuthenticatedSession } from "../../../lib/auth/session";
import { hasRole } from "../../../lib/roles";
import { AnnouncementsClient } from "./announcements-client";

export default async function AnnouncementsPage() {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return (
      <>
        <PageHeader
          title="Notifications"
          description="Company updates, alerts, and messages since your last visit."
        />
        <EmptyState
          title="Profile is unavailable"
          description="No profile is linked to this account yet."
        />
      </>
    );
  }

  const canManageAnnouncements =
    hasRole(session.profile.roles, "HR_ADMIN") ||
    hasRole(session.profile.roles, "SUPER_ADMIN");
  const isSuperAdmin = hasRole(session.profile.roles, "SUPER_ADMIN");

  return (
    <AnnouncementsClient
      canManageAnnouncements={canManageAnnouncements}
      isSuperAdmin={isSuperAdmin}
      currentUserName={session.profile.full_name}
    />
  );
}
