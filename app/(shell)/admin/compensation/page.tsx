import { getTranslations } from "next-intl/server";

import { EmptyState } from "../../../../components/shared/empty-state";
import { PageHeader } from "../../../../components/shared/page-header";
import { getAuthenticatedSession } from "../../../../lib/auth/session";
import type { UserRole } from "../../../../lib/navigation";
import { hasRole } from "../../../../lib/roles";
import { AdminCompensationClient } from "./admin-compensation-client";

type AdminCompensationPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function readEmployeeId(
  params: Record<string, string | string[] | undefined>
): string | null {
  const value = params.employeeId;

  if (typeof value !== "string") {
    return null;
  }

  return value.trim().length > 0 ? value : null;
}

function canManageCompensation(roles: readonly UserRole[]): boolean {
  return (
    hasRole(roles, "HR_ADMIN") ||
    hasRole(roles, "FINANCE_ADMIN") ||
    hasRole(roles, "SUPER_ADMIN")
  );
}

export default async function AdminCompensationPage({
  searchParams
}: AdminCompensationPageProps) {
  const session = await getAuthenticatedSession();
  const t = await getTranslations("adminCompensation");
  const tCommon = await getTranslations("common");

  if (!session?.profile) {
    return (
      <>
        <PageHeader
          title={t("pageTitle")}
          description={t("pageDescription")}
        />
        <EmptyState
          title={tCommon("emptyState.profileUnavailable")}
          description={tCommon("emptyState.profileUnavailableBody")}
        />
      </>
    );
  }

  if (!canManageCompensation(session.profile.roles)) {
    return (
      <>
        <PageHeader
          title={t("pageTitle")}
          description={t("pageDescription")}
        />
        <EmptyState
          title={tCommon("emptyState.accessDenied")}
          description={t("accessDeniedDescription")}
        />
      </>
    );
  }

  const resolvedSearchParams = await searchParams;
  const employeeId = readEmployeeId(resolvedSearchParams);

  return (
    <AdminCompensationClient
      initialEmployeeId={employeeId}
      canApprove={hasRole(session.profile.roles, "SUPER_ADMIN")}
    />
  );
}
