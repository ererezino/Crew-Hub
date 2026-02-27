import { EmptyState } from "../../../../../components/shared/empty-state";
import { PageHeader } from "../../../../../components/shared/page-header";
import { getAuthenticatedSession } from "../../../../../lib/auth/session";
import type { UserRole } from "../../../../../lib/navigation";
import { hasRole } from "../../../../../lib/roles";
import { PayrollRunDetailClient } from "./payroll-run-detail-client";

type PayrollRunDetailPageProps = {
  params: Promise<{ id: string }>;
};

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

export default async function PayrollRunDetailPage({ params }: PayrollRunDetailPageProps) {
  const session = await getAuthenticatedSession();
  const { id } = await params;

  if (!session?.profile) {
    return (
      <>
        <PageHeader
          title="Payroll Run"
          description="Review payroll run calculations and employee payout details."
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
          title="Payroll Run"
          description="Review payroll run calculations and employee payout details."
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
    <PayrollRunDetailClient
      runId={id}
      viewerUserId={session.profile.id}
      canManage={canManagePayroll(session.profile.roles)}
      canFinalApprove={hasRole(session.profile.roles, "SUPER_ADMIN")}
    />
  );
}
