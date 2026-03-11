import { getTranslations } from "next-intl/server";

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
  const tNav = await getTranslations('nav');

  if (!session?.profile) {
    const t = await getTranslations('common');
    return (
      <>
        <PageHeader
          title={tNav('approvals')}
          description={tNav('description.approvals')}
        />
        <EmptyState
          title={t('emptyState.profileUnavailable')}
          description={t('emptyState.profileUnavailableBody')}
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
    const tApprovals = await getTranslations('approvalsPage');
    return (
      <>
        <PageHeader
          title={tNav('approvals')}
          description={tNav('description.approvals')}
        />
        <EmptyState
          title={tApprovals('accessDenied')}
          description={tApprovals('accessDeniedBody')}
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
