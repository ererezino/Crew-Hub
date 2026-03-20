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

function canManagePayroll(roles: readonly UserRole[]): boolean {
  return hasRole(roles, "FINANCE_ADMIN") || hasRole(roles, "FINANCE_APPROVER") || hasRole(roles, "SUPER_ADMIN");
}

export default async function PayrollRunDetailPage({ params }: PayrollRunDetailPageProps) {
  const session = await getAuthenticatedSession();
  const profile = session?.profile ?? null;
  const { id } = await params;
  const t = await getTranslations("payrollPage");
  const tCommon = await getTranslations("common");
  const tSettings = await getTranslations("payrollSettings");

  if (!profile) {
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

  if (!profile || !canManagePayroll(profile.roles)) {
    return (
      <>
        <PageHeader
          title={t("runTitle")}
          description={t("runDescription")}
        />
        <EmptyState
          title={tCommon("emptyState.accessDenied")}
          description={t("createAccessDenied")}
        />
      </>
    );
  }

  return (
    <PayrollRunDetailClient
      runId={id}
      viewerUserId={profile.id}
      canManage={canManagePayroll(profile.roles)}
      canApprove={hasRole(profile.roles, "FINANCE_APPROVER") || hasRole(profile.roles, "SUPER_ADMIN")}
    />
  );
}
