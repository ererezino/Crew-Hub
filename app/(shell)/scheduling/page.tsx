import { EmptyState } from "../../../components/shared/empty-state";
import { getAuthenticatedSession } from "../../../lib/auth/session";
import { SchedulingTabsClient } from "./scheduling-tabs-client";

type SchedulingPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function resolveRequestedTab(searchParams: Record<string, string | string[] | undefined>): string {
  const rawTab = searchParams.tab;

  if (typeof rawTab !== "string") {
    return "my-shifts";
  }

  return rawTab;
}

export default async function SchedulingPage({ searchParams }: SchedulingPageProps) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return (
      <EmptyState
        title="Profile is unavailable"
        description="No profile is linked to this account yet."
        ctaLabel="Back to dashboard"
        ctaHref="/dashboard"
      />
    );
  }

  const resolvedSearchParams = await searchParams;

  return (
    <SchedulingTabsClient
      requestedTab={resolveRequestedTab(resolvedSearchParams)}
      userRoles={session.profile.roles}
      currentUserId={session.profile.id}
    />
  );
}
