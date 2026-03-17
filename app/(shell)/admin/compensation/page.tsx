import { getTranslations } from "next-intl/server";

import { EmptyState } from "../../../../components/shared/empty-state";
import { PageHeader } from "../../../../components/shared/page-header";
import { checkPageAccess } from "../../../../lib/auth/check-page-access";
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

export default async function AdminCompensationPage({
  searchParams
}: AdminCompensationPageProps) {
  const { allowed, profile } = await checkPageAccess("/admin/compensation");
  const t = await getTranslations("adminCompensation");
  const tCommon = await getTranslations("common");

  if (!profile) {
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

  if (!allowed) {
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
      canApprove={hasRole(profile.roles, "SUPER_ADMIN")}
    />
  );
}
