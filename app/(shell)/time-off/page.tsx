import { getTranslations } from "next-intl/server";

import { EmptyState } from "../../../components/shared/empty-state";
import { getAuthenticatedSession } from "../../../lib/auth/session";
import { fetchTimeOffSummaryData } from "../../../lib/time-off/fetch-time-off-summary";
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

  // Server-fetch time-off summary for the default month/year so it's in the initial HTML.
  // If the fetch fails, render without initialData — the client will retry via API.
  let initialSummaryData;

  try {
    initialSummaryData = await fetchTimeOffSummaryData(session.profile);
  } catch {
    // Graceful degradation: client will fetch on mount
  }

  return (
    <TimeOffTabsClient
      requestedTab={resolveRequestedTab(resolvedSearchParams)}
      userRoles={session.profile.roles}
      currentUserId={session.profile.id}
      currentOrgId={session.profile.org_id}
      initialSummaryData={initialSummaryData}
    />
  );
}
