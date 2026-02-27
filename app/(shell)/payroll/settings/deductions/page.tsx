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

  if (!session?.profile) {
    return (
      <>
        <PageHeader
          title="Payroll Settings"
          description="Manage statutory withholding rollout and deduction configuration."
        />
        <EmptyState
          title="Profile is unavailable"
          description="No profile is linked to this account yet."
          ctaLabel="Back to payroll"
          ctaHref="/payroll"
        />
      </>
    );
  }

  if (!canViewPayroll(session.profile.roles)) {
    return (
      <>
        <PageHeader
          title="Payroll Settings"
          description="Manage statutory withholding rollout and deduction configuration."
        />
        <EmptyState
          title="Access denied"
          description="Only HR Admin, Finance Admin, and Super Admin can view payroll settings."
          ctaLabel="Back to dashboard"
          ctaHref="/dashboard"
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
        : "Unable to load Nigeria withholding configuration.";
  }

  return (
    <>
      <PageHeader
        title="Payroll Settings"
        description="Configure country-by-country statutory withholding in Crew Hub."
      />

      <DeductionsSettingsClient
        initialNigeriaConfig={nigeriaConfig}
        initialNigeriaConfigError={nigeriaConfigError}
        canEditNigeria={canEditNigeriaRules(session.profile.roles)}
      />
    </>
  );
}
