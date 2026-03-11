import { getTranslations } from "next-intl/server";

import { EmptyState } from "../../../components/shared/empty-state";
import { PageHeader } from "../../../components/shared/page-header";
import { getAuthenticatedSession } from "../../../lib/auth/session";
import { hasRole } from "../../../lib/roles";
import { PerformanceClient } from "./performance-client";

export default async function PerformancePage() {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    const t = await getTranslations('common');
    const tNav = await getTranslations('nav');
    return (
      <>
        <PageHeader
          title={tNav('performance')}
          description={tNav('description.performance')}
        />
        <EmptyState
          title={t('emptyState.profileUnavailable')}
          description={t('emptyState.profileUnavailableBody')}
        />
      </>
    );
  }

  return (
    <PerformanceClient
      canManagePerformance={
        hasRole(session.profile.roles, "HR_ADMIN") ||
        hasRole(session.profile.roles, "SUPER_ADMIN")
      }
    />
  );
}
