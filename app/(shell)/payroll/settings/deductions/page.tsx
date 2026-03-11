import { getTranslations } from "next-intl/server";

import { EmptyState } from "../../../../../components/shared/empty-state";
import { PageHeader } from "../../../../../components/shared/page-header";
import { getAuthenticatedSession } from "../../../../../lib/auth/session";
import { loadNigeriaRuleConfig } from "../../../../../lib/payroll/engines/nigeria";
import type { UserRole } from "../../../../../lib/navigation";
import { hasRole } from "../../../../../lib/roles";
import { DeductionsSettingsClient } from "./settings-client";

function canViewPayroll(roles: readonly UserRole[]): boolean {
  return (
    hasRole(roles, "HR_ADMIN") ||
    hasRole(roles, "FINANCE_ADMIN") ||
    hasRole(roles, "SUPER_ADMIN")
  );
}

function canEditNigeriaRules(roles: readonly UserRole[]): boolean {
  return hasRole(roles, "FINANCE_ADMIN") || hasRole(roles, "SUPER_ADMIN");
}

export default async function PayrollDeductionsSettingsPage() {
  const session = await getAuthenticatedSession();
  const t = await getTranslations("payrollPage");
  const tSettings = await getTranslations("payrollSettings");
  const tCommon = await getTranslations("common");

  if (!session?.profile) {
    return (
      <>
        <PageHeader
          title={t("settingsTitle")}
          description={t("settingsDescription")}
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
          title={t("settingsTitle")}
          description={t("settingsDescription")}
        />
        <EmptyState
          title={tCommon("emptyState.accessDenied")}
          description={t("settingsAccessDenied")}
        />
      </>
    );
  }

  let nigeriaConfig = null;
  let nigeriaConfigError: string | null = null;

  try {
    nigeriaConfig = await loadNigeriaRuleConfig({
      orgId: session.profile.org_id
    });
  } catch (error) {
    nigeriaConfigError =
      error instanceof Error
        ? error.message
        : tSettings("unableToLoadNigeriaConfig");
  }

  return (
    <>
      <PageHeader
        title={t("settingsTitle")}
        description={t("settingsCountryDescription")}
      />

      <DeductionsSettingsClient
        initialNigeriaConfig={nigeriaConfig}
        initialNigeriaConfigError={nigeriaConfigError}
        canEditNigeria={canEditNigeriaRules(session.profile.roles)}
      />
    </>
  );
}
