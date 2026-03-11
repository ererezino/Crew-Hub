import { getTranslations } from "next-intl/server";

import { EmptyState } from "../../../../../components/shared/empty-state";
import { PageHeader } from "../../../../../components/shared/page-header";
import { getAuthenticatedSession } from "../../../../../lib/auth/session";
import type { UserRole } from "../../../../../lib/navigation";
import { hasRole } from "../../../../../lib/roles";
import { PayrollRunDetailClient } from "./payroll-run-detail-client";

type PayrollRunDetailPageProps = {
  params: Promise<{ id: string }>;
};

function canViewPayroll(roles: readonly UserRole[]): boolean {
  return (
    hasRole(roles, "HR_ADMIN") ||
    hasRole(roles, "FINANCE_ADMIN") ||
    hasRole(roles, "SUPER_ADMIN")
  );
}

function canManagePayroll(roles: readonly UserRole[]): boolean {
  return hasRole(roles, "FINANCE_ADMIN") || hasRole(roles, "SUPER_ADMIN");
}

export default async function PayrollRunDetailPage({ params }: PayrollRunDetailPageProps) {
  const session = await getAuthenticatedSession();
  const { id } = await params;
  const t = await getTranslations("payrollPage");
  const tCommon = await getTranslations("common");
  const tSettings = await getTranslations("payrollSettings");

  if (!session?.profile) {
    return (
      <>
        <PageHeader
          title={t("runTitle")}
          description={t("runDescription")}
        />
        <EmptyState
          title={tCommon("emptyState.profileUnavailable")}
          description={tCommon("emptyState.profileUnavailableBody")}
          ctaLabel={tSettings("backToPayroll")}
          ctaHref="/payroll"
        />
      </>
    );
  }

  if (!canViewPayroll(session.profile.roles)) {
    return (
      <>
        <PageHeader
          title={t("runTitle")}
          description={t("runDescription")}
        />
        <EmptyState
          title={tCommon("emptyState.accessDenied")}
          description={t("accessDenied")}
        />
      </>
    );
  }

  return (
    <PayrollRunDetailClient
      runId={id}
      viewerUserId={session.profile.id}
      canManage={canManagePayroll(session.profile.roles)}
      canFinalApprove={hasRole(session.profile.roles, "SUPER_ADMIN")}
    />
  );
}
