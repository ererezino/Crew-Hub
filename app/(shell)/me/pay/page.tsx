import { getTranslations } from "next-intl/server";

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
    const t = await getTranslations('common');
    const tPay = await getTranslations('pay');
    return (
      <>
        <PageHeader
          title={tPay('title')}
          description={tPay('description')}
        />
        <EmptyState
          title={t('emptyState.profileUnavailable')}
          description={t('emptyState.profileUnavailableBody')}
        />
      </>
    );
  }

  const resolvedSearchParams = await searchParams;

  return (
    <PayClient requestedTab={resolveRequestedTab(resolvedSearchParams)} userRoles={session.profile.roles} />
  );
}
