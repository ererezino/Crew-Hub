import { getTranslations } from "next-intl/server";

import { EmptyState } from "../../../components/shared/empty-state";
import { PageHeader } from "../../../components/shared/page-header";
import { getAuthenticatedSession } from "../../../lib/auth/session";
import { hasRole } from "../../../lib/roles";
import { AnnouncementsClient } from "./announcements-client";

export default async function AnnouncementsPage() {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    const t = await getTranslations('common');
    const tPage = await getTranslations('announcements');
    return (
      <>
        <PageHeader
          title={tPage('pageTitle')}
          description={tPage('pageDescription')}
        />
        <EmptyState
          title={t('emptyState.profileUnavailable')}
          description={t('emptyState.profileUnavailableBody')}
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
