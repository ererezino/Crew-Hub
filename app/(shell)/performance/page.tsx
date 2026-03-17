import { getTranslations } from "next-intl/server";

import { EmptyState } from "../../../components/shared/empty-state";
import { PageHeader } from "../../../components/shared/page-header";
import { checkPageAccess } from "../../../lib/auth/check-page-access";
import { hasRole } from "../../../lib/roles";
import { PerformanceClient } from "./performance-client";

export default async function PerformancePage() {
  const t = await getTranslations('common');
  const tNav = await getTranslations('nav');
  const { allowed, profile } = await checkPageAccess("/performance");

  if (!profile) {
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

  if (!allowed) {
    return (
      <>
        <PageHeader
          title={tNav('performance')}
          description={tNav('description.performance')}
        />
        <EmptyState
          title={t('emptyState.accessDenied')}
          description={t('emptyState.accessDeniedBody')}
        />
      </>
    );
  }

  return (
    <PerformanceClient
      canManagePerformance={
        hasRole(profile.roles, "HR_ADMIN") ||
        hasRole(profile.roles, "SUPER_ADMIN")
      }
    />
  );
}
