import Link from "next/link";

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

  if (!session?.profile) {
    return (
      <>
        <PageHeader
          title="Payroll"
          description="Run payroll with staged approvals and clear payout status."
        />
        <EmptyState
          title="Profile is unavailable"
          description="No profile is linked to this account yet."
          ctaLabel="Back to dashboard"
          ctaHref="/dashboard"
        />
      </>
    );
  }

  if (!canViewPayroll(session.profile.roles)) {
    return (
      <>
        <PageHeader
          title="Payroll"
          description="Run payroll with staged approvals and clear payout status."
        />
        <EmptyState
          title="Access denied"
          description="Only HR Admin, Finance Admin, and Super Admin can view payroll runs."
          ctaLabel="Back to dashboard"
          ctaHref="/dashboard"
        />
      </>
    );
  }

  return (
    <PayrollDashboardClient
      canManage={canManagePayroll(session.profile.roles)}
      createRunHref="/payroll/runs/new"
      settingsHref="/payroll/settings/deductions"
      headerActions={
        <>
          <Link className="button button-subtle" href="/payroll/settings/deductions">
            Withholding settings
          </Link>
          {canManagePayroll(session.profile.roles) ? (
            <Link className="button button-accent" href="/payroll/runs/new">
              Create payroll run
            </Link>
          ) : null}
        </>
      }
    />
  );
}
