import { EmptyState } from "../../../../components/shared/empty-state";
import { PageHeader } from "../../../../components/shared/page-header";
import { getAuthenticatedSession } from "../../../../lib/auth/session";

import { PayClient } from "./pay-client";

type PayPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function resolveRequestedTab(searchParams: Record<string, string | string[] | undefined>): string {
  const rawTab = searchParams.tab;

  if (typeof rawTab !== "string") {
    return "payslips";
  }

  return rawTab;
}

export default async function PayPage({ searchParams }: PayPageProps) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return (
      <>
        <PageHeader
          title="Pay"
          description="Review your pay statements, payout details, and compensation."
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

  const resolvedSearchParams = await searchParams;

  return (
    <PayClient requestedTab={resolveRequestedTab(resolvedSearchParams)} userRoles={session.profile.roles} />
  );
}
