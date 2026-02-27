import { EmptyState } from "../../../../../components/shared/empty-state";
import { PageHeader } from "../../../../../components/shared/page-header";
import { getAuthenticatedSession } from "../../../../../lib/auth/session";
import type { UserRole } from "../../../../../lib/navigation";
import { hasRole } from "../../../../../lib/roles";
import { CreatePayrollRunClient } from "./payroll-run-create-client";

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

export default async function PayrollRunCreatePage() {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return (
      <>
        <PageHeader
          title="Create Payroll Run"
          description="Define pay period and pay date for a new payroll run."
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
          title="Create Payroll Run"
          description="Define pay period and pay date for a new payroll run."
        />
        <EmptyState
          title="Access denied"
          description="Only HR Admin, Finance Admin, and Super Admin can view payroll modules."
          ctaLabel="Back to dashboard"
          ctaHref="/dashboard"
        />
      </>
    );
  }

  if (!canManagePayroll(session.profile.roles)) {
    return (
      <>
        <PageHeader
          title="Create Payroll Run"
          description="Define pay period and pay date for a new payroll run."
        />
        <EmptyState
          title="Access denied"
          description="Only Finance Admin and Super Admin can create payroll runs."
          ctaLabel="Back to payroll"
          ctaHref="/payroll"
        />
      </>
    );
  }

  return <CreatePayrollRunClient />;
}
