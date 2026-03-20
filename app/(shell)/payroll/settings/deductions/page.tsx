import { getTranslations } from "next-intl/server";

import { EmptyState } from "../../../../../components/shared/empty-state";
import { PageHeader } from "../../../../../components/shared/page-header";
import { getAuthenticatedSession } from "../../../../../lib/auth/session";
import type { UserRole } from "../../../../../lib/navigation";
import { hasRole } from "../../../../../lib/roles";
import { loadNigeriaRuleConfig } from "../../../../../lib/payroll/engines/nigeria";
import { DeductionsSettingsClient } from "./settings-client";

function canEditNigeriaRules(roles: readonly UserRole[]): boolean {
  return hasRole(roles, "FINANCE_ADMIN") || hasRole(roles, "FINANCE_APPROVER") || hasRole(roles, "SUPER_ADMIN");
}

export default async function PayrollDeductionsSettingsPage() {
  const session = await getAuthenticatedSession();
  const profile = session?.profile ?? null;
  const t = await getTranslations("payrollPage");
  const tSettings = await getTranslations("payrollSettings");
  const tCommon = await getTranslations("common");

  if (!profile) {
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

  if (!profile || !canEditNigeriaRules(profile.roles)) {
    return (
      <>
        <PageHeader
          title={t("settingsTitle")}
          description={t("settingsDescription")}
        />
        <EmptyState
          title={tCommon("emptyState.accessDenied")}
          description={t("createAccessDenied")}
        />
      </>
    );
  }

  let nigeriaConfig = null;
  let nigeriaConfigError: string | null = null;

  try {
    nigeriaConfig = await loadNigeriaRuleConfig({
      orgId: profile.org_id
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
        canEditNigeria={canEditNigeriaRules(profile.roles)}
      />
    </>
  );
}
