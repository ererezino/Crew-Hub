import { EmptyState } from "../../../components/shared/empty-state";
import { PageHeader } from "../../../components/shared/page-header";
import { getAuthenticatedSession } from "../../../lib/auth/session";
import { hasRole } from "../../../lib/roles";

import { ApprovalsClient } from "./approvals-client";

type ApprovalsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function resolveRequestedTab(searchParams: Record<string, string | string[] | undefined>): string {
  const rawTab = searchParams.tab;

  if (typeof rawTab !== "string") {
    return "time-off";
  }

  return rawTab;
}

export default async function ApprovalsPage({ searchParams }: ApprovalsPageProps) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return (
      <>
        <PageHeader
          title="Approvals"
          description="Review and act on pending team requests."
        />
        <EmptyState
          title="Profile is unavailable"
          description="No profile is linked to this account yet."
          ctaLabel="Back to dashboard"
          ctaHref="/dashboard"
        />
      </>
    );
  }

  const roles = session.profile.roles;

  const canReviewTimeOff =
    hasRole(roles, "MANAGER") ||
    hasRole(roles, "HR_ADMIN") ||
    hasRole(roles, "SUPER_ADMIN");
  const canReviewExpenses =
    hasRole(roles, "MANAGER") ||
    hasRole(roles, "FINANCE_ADMIN") ||
    hasRole(roles, "SUPER_ADMIN");
  const canReviewTimesheets =
    hasRole(roles, "TEAM_LEAD") ||
    hasRole(roles, "MANAGER") ||
    hasRole(roles, "HR_ADMIN") ||
    hasRole(roles, "FINANCE_ADMIN") ||
    hasRole(roles, "SUPER_ADMIN");

  if (!canReviewTimeOff && !canReviewExpenses && !canReviewTimesheets) {
    return (
      <>
        <PageHeader
          title="Approvals"
          description="Review and act on pending team requests."
        />
        <EmptyState
          title="Approvals are restricted"
          description="Only team leads, managers, and admins can process approvals."
          ctaLabel="Open dashboard"
          ctaHref="/dashboard"
        />
      </>
    );
  }

  const resolvedSearchParams = await searchParams;
  const requestedTab = resolveRequestedTab(resolvedSearchParams);

  return (
    <ApprovalsClient
      requestedTab={requestedTab}
      userRoles={roles}
      canReviewTimeOff={canReviewTimeOff}
      canReviewExpenses={canReviewExpenses}
      canReviewTimesheets={canReviewTimesheets}
    />
  );
}
