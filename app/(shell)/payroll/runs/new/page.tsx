import { getTranslations } from "next-intl/server";

import { EmptyState } from "../../../../../components/shared/empty-state";
import { PageHeader } from "../../../../../components/shared/page-header";
import { checkPageAccess } from "../../../../../lib/auth/check-page-access";
import type { UserRole } from "../../../../../lib/navigation";
import { hasRole } from "../../../../../lib/roles";
import { CreatePayrollRunClient } from "./payroll-run-create-client";

function canManagePayroll(roles: readonly UserRole[]): boolean {
  return hasRole(roles, "FINANCE_ADMIN") || hasRole(roles, "SUPER_ADMIN");
}

export default async function PayrollRunCreatePage() {
  const { allowed, profile } = await checkPageAccess("/payroll");
  const t = await getTranslations("payrollPage");
  const tCommon = await getTranslations("common");
  const tSettings = await getTranslations("payrollSettings");

  if (!profile) {
    return (
      <>
        <PageHeader
          title={t("createTitle")}
          description={t("createDescription")}
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

  if (!allowed) {
    return (
      <>
        <PageHeader
          title={t("createTitle")}
          description={t("createDescription")}
        />
        <EmptyState
          title={tCommon("emptyState.accessDenied")}
          description={t("accessDeniedModules")}
        />
      </>
    );
  }

  if (!canManagePayroll(profile.roles)) {
    return (
      <>
        <PageHeader
          title={t("createTitle")}
          description={t("createDescription")}
        />
        <EmptyState
          title={tCommon("emptyState.accessDenied")}
          description={t("createAccessDenied")}
          ctaLabel={tSettings("backToPayroll")}
          ctaHref="/payroll"
        />
      </>
    );
  }

  return <CreatePayrollRunClient />;
}
