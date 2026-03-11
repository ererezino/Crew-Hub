import { getTranslations } from "next-intl/server";

import { EmptyState } from "../../../components/shared/empty-state";
import { PageHeader } from "../../../components/shared/page-header";
import { getAuthenticatedSession } from "../../../lib/auth/session";
import { normalizeUserRoles, type UserRole } from "../../../lib/navigation";
import { hasRole } from "../../../lib/roles";
import { AnalyticsClient } from "./analytics-client";

function canViewAnalytics(roles: readonly UserRole[]): boolean {
  return (
    hasRole(roles, "HR_ADMIN") ||
    hasRole(roles, "FINANCE_ADMIN") ||
    hasRole(roles, "SUPER_ADMIN")
  );
}

export default async function AnalyticsPage() {
  const session = await getAuthenticatedSession();
  const tNav = await getTranslations('nav');

  if (!session?.profile) {
    const t = await getTranslations('common');
    return (
      <>
        <PageHeader
          title={tNav('analytics')}
          description={tNav('description.analytics')}
        />
        <EmptyState
          title={t('emptyState.profileUnavailable')}
          description={t('emptyState.profileUnavailableBody')}
        />
      </>
    );
  }

  const userRoles = normalizeUserRoles(session.profile.roles);

  if (!canViewAnalytics(userRoles)) {
    const t = await getTranslations('common');
    const tAnalytics = await getTranslations('analyticsPage');
    return (
      <>
        <PageHeader
          title={tNav('analytics')}
          description={tNav('description.analytics')}
        />
        <EmptyState
          title={t('emptyState.accessDenied')}
          description={tAnalytics('accessDenied')}
        />
      </>
    );
  }

  return <AnalyticsClient userRoles={userRoles} />;
}
