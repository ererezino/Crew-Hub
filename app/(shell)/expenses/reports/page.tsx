import { EmptyState } from "../../../../components/shared/empty-state";
import { PageHeader } from "../../../../components/shared/page-header";
import { getAuthenticatedSession } from "../../../../lib/auth/session";
import type { UserRole } from "../../../../lib/navigation";
import { hasRole } from "../../../../lib/roles";
import { ExpenseReportsClient } from "./reports-client";

function canViewExpenseReports(roles: readonly UserRole[]): boolean {
  return (
    hasRole(roles, "MANAGER") ||
    hasRole(roles, "HR_ADMIN") ||
    hasRole(roles, "FINANCE_ADMIN") ||
    hasRole(roles, "SUPER_ADMIN")
  );
}

export default async function ExpenseReportsPage() {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return (
      <>
        <PageHeader
          title="Expense Reports"
          description="Monthly analytics by category, employee, and department."
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

  if (!canViewExpenseReports(session.profile.roles)) {
    return (
      <>
        <PageHeader
          title="Expense Reports"
          description="Monthly analytics by category, employee, and department."
        />
        <EmptyState
          title="Access denied"
          description="Only managers and admin roles can view expense reports."
          ctaLabel="Open expenses"
          ctaHref="/expenses"
        />
      </>
    );
  }

  return <ExpenseReportsClient />;
}
