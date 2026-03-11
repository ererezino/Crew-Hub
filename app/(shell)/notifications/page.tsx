import { getTranslations } from "next-intl/server";

import { NotificationsClient } from "./notifications-client";
import { PageHeader } from "../../../components/shared/page-header";
import { getAuthenticatedSession } from "../../../lib/auth/session";
import { hasRole } from "../../../lib/roles";

export default async function NotificationsPage() {
  const session = await getAuthenticatedSession();
  const t = await getTranslations('notificationsPage');
  const isSuperAdmin =
    session?.profile?.roles
      ? hasRole(session.profile.roles, "SUPER_ADMIN")
      : false;

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('description')}
      />
      <NotificationsClient isSuperAdmin={isSuperAdmin} />
    </>
  );
}
