import { getTranslations } from "next-intl/server";

import { EmptyState } from "../../../components/shared/empty-state";
import { PageHeader } from "../../../components/shared/page-header";
import { getAuthenticatedSession } from "../../../lib/auth/session";

import { DashboardClient } from "./dashboard-client";

export default async function DashboardPage() {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    const t = await getTranslations('common');
    const tPage = await getTranslations('dashboard');
    return (
      <>
        <PageHeader
          title={tPage('title')}
          description={tPage('description')}
        />
        <EmptyState
          title={t('emptyState.profileSetupRequired')}
          description={t('emptyState.profileSetupRequiredBody')}
          ctaLabel={t('emptyState.openSettings')}
          ctaHref="/settings"
        />
      </>
    );
  }

  return <DashboardClient />;
}
