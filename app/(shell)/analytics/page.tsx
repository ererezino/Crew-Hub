import { getTranslations } from "next-intl/server";

import { EmptyState } from "../../../components/shared/empty-state";
import { PageHeader } from "../../../components/shared/page-header";
import { checkPageAccess } from "../../../lib/auth/check-page-access";
import { normalizeUserRoles } from "../../../lib/navigation";
import { AnalyticsClient } from "./analytics-client";

export default async function AnalyticsPage() {
  const { allowed, profile } = await checkPageAccess("/analytics");
  const tNav = await getTranslations('nav');

  if (!profile) {
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

  if (!allowed) {
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

  const userRoles = normalizeUserRoles(profile.roles);

  return <AnalyticsClient userRoles={userRoles} />;
}
