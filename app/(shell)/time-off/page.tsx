import { getTranslations } from "next-intl/server";

import { EmptyState } from "../../../components/shared/empty-state";
import { getAuthenticatedSession } from "../../../lib/auth/session";
import { TimeOffTabsClient } from "./time-off-tabs-client";

type TimeOffPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function resolveRequestedTab(searchParams: Record<string, string | string[] | undefined>): string {
  const rawTab = searchParams.tab;

  if (typeof rawTab !== "string") {
    return "my-requests";
  }

  return rawTab;
}

export default async function TimeOffPage({ searchParams }: TimeOffPageProps) {
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

  const resolvedSearchParams = await searchParams;

  return (
    <TimeOffTabsClient
      requestedTab={resolveRequestedTab(resolvedSearchParams)}
      userRoles={session.profile.roles}
    />
  );
}
