import { EmptyState } from "../../../components/shared/empty-state";
import { getAuthenticatedSession } from "../../../lib/auth/session";
import { hasRole } from "../../../lib/roles";
import { LearningTabsClient } from "./learning-tabs-client";

type LearningPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function resolveRequestedTab(searchParams: Record<string, string | string[] | undefined>): string {
  const rawTab = searchParams.tab;

  if (typeof rawTab !== "string") {
    return "courses";
  }

  return rawTab;
}

export default async function LearningPage({ searchParams }: LearningPageProps) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return (
      <EmptyState
        title="Profile is unavailable"
        description="No profile is linked to this account yet."
      />
    );
  }

  const resolvedSearchParams = await searchParams;

  return (
    <LearningTabsClient
      requestedTab={resolveRequestedTab(resolvedSearchParams)}
      userRoles={session.profile.roles}
      canManageSurveys={
        hasRole(session.profile.roles, "HR_ADMIN") ||
        hasRole(session.profile.roles, "SUPER_ADMIN")
      }
    />
  );
}
