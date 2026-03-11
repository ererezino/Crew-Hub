import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { EmptyState } from "../../../components/shared/empty-state";
import { PageHeader } from "../../../components/shared/page-header";
import { getAuthenticatedSession } from "../../../lib/auth/session";
import type { UserRole } from "../../../lib/navigation";
import { hasRole } from "../../../lib/roles";
import { PayrollDashboardClient } from "./payroll-dashboard-client";

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

export default async function PayrollPage() {
  const session = await getAuthenticatedSession();
  const tNav = await getTranslations('nav');

  if (!session?.profile) {
    const t = await getTranslations('common');
    return (
      <>
        <PageHeader
          title={tNav('payroll')}
          description={tNav('description.payroll')}
        />
        <EmptyState
          title={t('emptyState.profileUnavailable')}
          description={t('emptyState.profileUnavailableBody')}
        />
      </>
    );
  }

  if (!canViewPayroll(session.profile.roles)) {
    const t = await getTranslations('common');
    const tPayroll = await getTranslations('payrollPage');
    return (
      <>
        <PageHeader
          title={tNav('payroll')}
          description={tNav('description.payroll')}
        />
        <EmptyState
          title={t('emptyState.accessDenied')}
          description={tPayroll('accessDenied')}
        />
      </>
    );
  }

  const tPayroll = await getTranslations('payrollPage');

  return (
    <PayrollDashboardClient
      canManage={canManagePayroll(session.profile.roles)}
      createRunHref="/payroll/runs/new"
      settingsHref="/payroll/settings/deductions"
      headerActions={
        <>
          <Link className="button button-subtle" href="/payroll/settings/deductions">
            {tPayroll('withholdingSettings')}
          </Link>
          {canManagePayroll(session.profile.roles) ? (
            <Link className="button button-accent" href="/payroll/runs/new">
              {tPayroll('createPayrollRun')}
            </Link>
          ) : null}
        </>
      }
    />
  );
}
