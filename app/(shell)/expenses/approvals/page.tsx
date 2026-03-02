import { EmptyState } from "../../../../components/shared/empty-state";
import { PageHeader } from "../../../../components/shared/page-header";
import { getAuthenticatedSession } from "../../../../lib/auth/session";
import type { UserRole } from "../../../../lib/navigation";
import { hasRole } from "../../../../lib/roles";
import { ExpenseApprovalsClient } from "./approvals-client";

function canManagerApproveExpenses(roles: readonly UserRole[]): boolean {
  return hasRole(roles, "MANAGER") || hasRole(roles, "SUPER_ADMIN");
}

function canFinanceApproveExpenses(roles: readonly UserRole[]): boolean {
  return hasRole(roles, "FINANCE_ADMIN") || hasRole(roles, "SUPER_ADMIN");
}

export default async function ExpenseApprovalsPage() {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return (
      <>
        <PageHeader
          title="Expense Approvals"
          description="Review pending expense submissions and process approvals."
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

  const canManagerApprove = canManagerApproveExpenses(session.profile.roles);
  const canFinanceApprove = canFinanceApproveExpenses(session.profile.roles);

  if (!canManagerApprove && !canFinanceApprove) {
    return (
      <>
        <PageHeader
          title="Expense Approvals"
          description="Review manager approvals and finance disbursements."
        />
        <EmptyState
          title="Access denied"
          description="Only managers, finance admins, and super admins can process expense approvals."
          ctaLabel="Open expenses"
          ctaHref="/expenses"
        />
      </>
    );
  }

  return (
    <ExpenseApprovalsClient
      canManagerApprove={canManagerApprove}
      canFinanceApprove={canFinanceApprove}
    />
  );
}
