import { getTranslations } from "next-intl/server";

import { fetchApprovalsCountsData } from "../../../lib/approvals/fetch-approvals-counts";
import { EmptyState } from "../../../components/shared/empty-state";
import { PageHeader } from "../../../components/shared/page-header";
import { checkPageAccess } from "../../../lib/auth/check-page-access";
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
  const { allowed, profile } = await checkPageAccess("/approvals");
  const tNav = await getTranslations('nav');

  if (!profile) {
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

  if (!allowed) {
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

  const roles = profile.roles;

  const canReviewTimeOff =
    hasRole(roles, "TEAM_LEAD") ||
    hasRole(roles, "MANAGER") ||
    hasRole(roles, "HR_ADMIN") ||
    hasRole(roles, "SUPER_ADMIN");
  const canReviewExpenses =
    hasRole(roles, "TEAM_LEAD") ||
    hasRole(roles, "MANAGER") ||
    hasRole(roles, "FINANCE_ADMIN") ||
    hasRole(roles, "FINANCE_APPROVER") ||
    hasRole(roles, "SUPER_ADMIN");

  const resolvedSearchParams = await searchParams;
  const requestedTab = resolveRequestedTab(resolvedSearchParams);

  // Server-fetch approval counts so tab badges render in the initial HTML.
  // If the fetch fails, render without initialData — the client will retry via API.
  let initialCountsData;

  try {
    initialCountsData = await fetchApprovalsCountsData(profile);
  } catch {
    // Graceful degradation: client will fetch on mount
  }

  return (
    <ApprovalsClient
      requestedTab={requestedTab}
      userRoles={roles}
      canReviewTimeOff={canReviewTimeOff}
      canReviewExpenses={canReviewExpenses}
      initialCountsData={initialCountsData}
    />
  );
}
