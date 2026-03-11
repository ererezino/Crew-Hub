import { getTranslations } from "next-intl/server";

import { EmptyState } from "../../../../components/shared/empty-state";
import { getAuthenticatedSession } from "../../../../lib/auth/session";
import { hasRole } from "../../../../lib/roles";
import { AccessControlAdminClient } from "./access-control-admin-client";

export default async function AccessControlPage() {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    const t = await getTranslations('common');
    return (
      <EmptyState
        title={t('emptyState.profileUnavailable')}
        description={t('emptyState.profileUnavailableBody')}
      />
    );
  }

  if (!hasRole(session.profile.roles, "SUPER_ADMIN")) {
    const tAccess = await getTranslations('accessControl');
    return (
      <EmptyState
        title={tAccess('accessDenied')}
        description={tAccess('accessDeniedBody')}
      />
    );
  }

  return <AccessControlAdminClient />;
}
