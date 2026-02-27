import Link from "next/link";

import { DashboardAnnouncementsWidget } from "../../../components/shared/dashboard-announcements-widget";
import { EmptyState } from "../../../components/shared/empty-state";
import { MetricCard } from "../../../components/shared/metric-card";
import { PageHeader } from "../../../components/shared/page-header";
import { CurrencyDisplay } from "../../../components/ui/currency-display";
import { getAuthenticatedSession } from "../../../lib/auth/session";
import { countryFlagFromCode, countryNameFromCode } from "../../../lib/countries";
import { formatDateTimeTooltip, formatRelativeTime } from "../../../lib/datetime";
import { isUserRole, type UserRole } from "../../../lib/navigation";
import { hasRole } from "../../../lib/roles";
import { createSupabaseServerClient } from "../../../lib/supabase/server";

type OrgMember = {
  id: string;
  full_name: string;
  manager_id: string | null;
  country_code: string | null;
  status: "active" | "inactive" | "onboarding" | "offboarding";
  roles: UserRole[];
};

type ExpenseWidgetMetrics = {
  employeePendingCount: number;
  employeePendingAmount: number;
  managerPendingCount: number;
};

type ComplianceWidgetMetrics = {
  overdueCount: number;
  nextDeadline: {
    dueDate: string;
    requirement: string;
    countryCode: string;
  } | null;
};

const COUNTRY_LABELS: Record<string, string> = {
  NG: "Nigeria",
  GH: "Ghana",
  KE: "Kenya",
  ZA: "South Africa",
  CA: "Canada"
};

function getFirstName(fullName: string): string {
  const [firstName] = fullName.trim().split(/\s+/);
  return firstName || "there";
}

function hasManagerAccess(roles: readonly UserRole[]): boolean {
  return (
    hasRole(roles, "MANAGER") ||
    hasRole(roles, "HR_ADMIN") ||
    hasRole(roles, "SUPER_ADMIN")
  );
}

function hasHrAdminAccess(roles: readonly UserRole[]): boolean {
  return hasRole(roles, "HR_ADMIN") || hasRole(roles, "SUPER_ADMIN");
}

function hasComplianceAccess(roles: readonly UserRole[]): boolean {
  return (
    hasRole(roles, "HR_ADMIN") ||
    hasRole(roles, "FINANCE_ADMIN") ||
    hasRole(roles, "SUPER_ADMIN")
  );
}

function getCountrySummary(members: readonly OrgMember[]): {
  countryCount: string;
  distribution: string;
} {
  if (members.length === 0) {
    return {
      countryCount: "--",
      distribution: "No country data yet"
    };
  }

  const grouped = members.reduce<Record<string, number>>((accumulator, member) => {
    const key = member.country_code ?? "--";
    accumulator[key] = (accumulator[key] ?? 0) + 1;
    return accumulator;
  }, {});

  const entries = Object.entries(grouped)
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([countryCode, count]) => {
      const label = COUNTRY_LABELS[countryCode] ?? countryCode;
      return `${label}: ${count}`;
    });

  return {
    countryCount: String(entries.length),
    distribution: entries.join(" | ")
  };
}

function getComplianceAlertCount(members: readonly OrgMember[]): string {
  const onboardingCount = members.filter((member) => member.status === "onboarding").length;
  return String(onboardingCount);
}

function getRoleBadge(roles: readonly UserRole[]): string {
  if (hasRole(roles, "SUPER_ADMIN")) {
    return "Super Admin";
  }

  if (hasRole(roles, "HR_ADMIN") && hasRole(roles, "FINANCE_ADMIN")) {
    return "HR Admin + Finance Admin";
  }

  if (hasRole(roles, "HR_ADMIN")) {
    return "HR Admin";
  }

  if (hasRole(roles, "FINANCE_ADMIN")) {
    return "Finance Admin";
  }

  if (hasRole(roles, "MANAGER")) {
    return "Manager";
  }

  return "Employee";
}

async function getOrgMembers(orgId: string): Promise<OrgMember[]> {
  try {
    const supabase = await createSupabaseServerClient();

    const { data, error } = await supabase
      .from("profiles")
      .select("id, full_name, manager_id, country_code, status, roles")
      .eq("org_id", orgId)
      .is("deleted_at", null);

    if (error || !data) {
      return [];
    }

    return data.map((member) => {
      const rawRoles = Array.isArray(member.roles)
        ? member.roles.filter((role: unknown): role is string => typeof role === "string")
        : [];

      return {
        id: member.id,
        full_name: member.full_name,
        manager_id: member.manager_id,
        country_code: member.country_code,
        status: member.status,
        roles: rawRoles.filter((role): role is UserRole => isUserRole(role))
      };
    });
  } catch {
    return [];
  }
}

function parseExpenseAmount(value: unknown): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? Math.trunc(value) : 0;
  }

  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

async function getExpenseWidgetMetrics({
  orgId,
  viewerUserId,
  directReportIds
}: {
  orgId: string;
  viewerUserId: string;
  directReportIds: readonly string[];
}): Promise<ExpenseWidgetMetrics> {
  try {
    const supabase = await createSupabaseServerClient();

    const pendingEmployeeQuery = supabase
      .from("expenses")
      .select("amount")
      .eq("org_id", orgId)
      .eq("employee_id", viewerUserId)
      .eq("status", "pending")
      .is("deleted_at", null);

    const pendingManagerQuery =
      directReportIds.length > 0
        ? supabase
            .from("expenses")
            .select("amount")
            .eq("org_id", orgId)
            .eq("status", "pending")
            .is("deleted_at", null)
            .in("employee_id", [...directReportIds])
        : Promise.resolve<{ data: { amount: unknown }[]; error: null }>({
            data: [],
            error: null
          });

    const [{ data: employeeRows, error: employeeError }, managerResult] = await Promise.all([
      pendingEmployeeQuery,
      pendingManagerQuery
    ]);

    if (employeeError || managerResult.error) {
      return {
        employeePendingCount: 0,
        employeePendingAmount: 0,
        managerPendingCount: 0
      };
    }

    const employeePendingCount = (employeeRows ?? []).length;
    const employeePendingAmount = (employeeRows ?? []).reduce((sum, row) => {
      return sum + parseExpenseAmount(row.amount);
    }, 0);
    const managerPendingCount = (managerResult.data ?? []).length;

    return {
      employeePendingCount,
      employeePendingAmount,
      managerPendingCount
    };
  } catch {
    return {
      employeePendingCount: 0,
      employeePendingAmount: 0,
      managerPendingCount: 0
    };
  }
}

async function getComplianceWidgetMetrics(orgId: string): Promise<ComplianceWidgetMetrics> {
  try {
    const supabase = await createSupabaseServerClient();
    const today = new Date().toISOString().slice(0, 10);

    const [
      { data: overdueRows, error: overdueError },
      { data: nextDeadlineRow, error: nextDeadlineError }
    ] = await Promise.all([
      supabase
        .from("compliance_deadlines")
        .select("id")
        .eq("org_id", orgId)
        .is("deleted_at", null)
        .neq("status", "completed")
        .lt("due_date", today),
      supabase
        .from("compliance_deadlines")
        .select("due_date, item_id")
        .eq("org_id", orgId)
        .is("deleted_at", null)
        .neq("status", "completed")
        .gte("due_date", today)
        .order("due_date", { ascending: true })
        .limit(1)
        .maybeSingle()
    ]);

    if (overdueError || nextDeadlineError) {
      return {
        overdueCount: 0,
        nextDeadline: null
      };
    }

    const overdueCount = (overdueRows ?? []).length;
    let nextDeadline: ComplianceWidgetMetrics["nextDeadline"] = null;

    if (
      nextDeadlineRow &&
      typeof nextDeadlineRow.item_id === "string" &&
      typeof nextDeadlineRow.due_date === "string"
    ) {
      const { data: itemRow, error: itemError } = await supabase
        .from("compliance_items")
        .select("requirement, country_code")
        .eq("org_id", orgId)
        .eq("id", nextDeadlineRow.item_id)
        .is("deleted_at", null)
        .maybeSingle();

      if (
        !itemError &&
        itemRow &&
        typeof itemRow.requirement === "string" &&
        typeof itemRow.country_code === "string"
      ) {
        nextDeadline = {
          dueDate: nextDeadlineRow.due_date,
          requirement: itemRow.requirement,
          countryCode: itemRow.country_code
        };
      }
    }

    return {
      overdueCount,
      nextDeadline
    };
  } catch {
    return {
      overdueCount: 0,
      nextDeadline: null
    };
  }
}

export default async function DashboardPage() {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return (
      <>
        <PageHeader
          title="Dashboard"
          description="Role-aware dashboard for Crew Hub users."
        />
        <EmptyState
          title="Profile setup is required"
          description="Your account is authenticated, but no profile record was found yet."
          ctaLabel="Open settings"
          ctaHref="/settings"
        />
      </>
    );
  }

  const profile = session.profile;
  const roles = profile.roles;
  const firstName = getFirstName(profile.full_name);
  const orgMembers = await getOrgMembers(profile.org_id);

  const members = orgMembers.length > 0
    ? orgMembers
    : [
        {
          id: profile.id,
          full_name: profile.full_name,
          manager_id: profile.manager_id,
          country_code: profile.country_code,
          status: profile.status,
          roles
        }
      ];

  const reportCount = members.filter((member) => member.manager_id === profile.id).length;
  const directReportIds = members
    .filter((member) => member.manager_id === profile.id)
    .map((member) => member.id);
  const activeHeadcount = members.filter((member) => member.status !== "inactive").length;
  const onboardingCount = members.filter((member) => member.status === "onboarding").length;
  const countrySummary = getCountrySummary(members);
  const expenseMetrics = await getExpenseWidgetMetrics({
    orgId: profile.org_id,
    viewerUserId: profile.id,
    directReportIds
  });
  const complianceMetrics = hasComplianceAccess(roles)
    ? await getComplianceWidgetMetrics(profile.org_id)
    : null;

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={`${session.org?.name ?? "Crew Hub"} operations dashboard`}
      />

      <section className="dashboard-panel">
        <h2 className="section-title">Welcome back, {firstName}</h2>
        <p className="dashboard-subtitle">Signed in as {getRoleBadge(roles)}.</p>
      </section>

      <section className="metric-grid" aria-label="Employee metrics">
        <MetricCard label="PTO Balance" value="--" hint="Available in Phase 2 Time Off" />
        <MetricCard label="Next Payday" value="--" hint="Upcoming payroll run data pending" />
        <MetricCard label="Docs Pending" value="--" hint="Document workflows land in Phase 2" />
        <MetricCard label="Onboarding Progress" value="--" hint="Personal onboarding tracker not enabled" />
      </section>

      <section className="dashboard-two-column" aria-label="Employee widgets">
        <div className="dashboard-panel">
          <DashboardAnnouncementsWidget />
        </div>

        <div className="dashboard-panel">
          <h3 className="section-title">Quick Links</h3>
          <ul className="quick-links-list">
            <li>
              <Link className="quick-link" href="/time-off">
                Request Time Off
              </Link>
            </li>
            <li>
              <Link className="quick-link" href="/me/payslips">
                View Payments
              </Link>
            </li>
            <li>
              <Link className="quick-link" href="/me/documents">
                My Documents
              </Link>
            </li>
          </ul>
          <div className="dashboard-expense-widget">
            <h4 className="section-title">Pending Expenses</h4>
            <p className="dashboard-subtitle">
              <span className="numeric">{expenseMetrics.employeePendingCount}</span>{" "}
              submissions awaiting approval
            </p>
            <p>
              <CurrencyDisplay amount={expenseMetrics.employeePendingAmount} currency="USD" />
            </p>
            <Link className="quick-link" href="/expenses">
              Open Expenses
            </Link>
          </div>
        </div>
      </section>

      {hasManagerAccess(roles) ? (
        <section className="metric-grid" aria-label="Manager metrics">
          <MetricCard label="Team Report Count" value={String(reportCount)} hint="Direct reports in your team" />
          <MetricCard label="Who's Out" value="--" hint="Time Off status data pending" />
          <MetricCard
            label="Pending Approvals"
            value={String(expenseMetrics.managerPendingCount)}
            hint="Pending expense approvals from your direct reports"
          />
          <MetricCard label="Team Health" value="--" hint="Performance health metrics pending" />
        </section>
      ) : null}

      {hasHrAdminAccess(roles) ? (
        <section className="metric-grid" aria-label="HR admin metrics">
          <MetricCard label="Headcount" value={String(activeHeadcount)} hint="Active + onboarding crew members" />
          <MetricCard label="Onboarding Pipeline" value={String(onboardingCount)} hint="People currently onboarding" />
          <MetricCard label="Compliance Alerts" value={getComplianceAlertCount(members)} hint="Profiles needing compliance follow-up" />
          <MetricCard label="People Ops Status" value="--" hint="Additional HR ops metrics pending" />
        </section>
      ) : null}

      {hasRole(roles, "FINANCE_ADMIN") ? (
        <section className="metric-grid" aria-label="Finance admin metrics">
          <MetricCard label="Current Payroll Status" value="--" hint="Payroll module status pending" />
          <MetricCard label="Pending Expenses" value="--" hint="Expense approvals pending module rollout" />
          <MetricCard label="Total Payroll Cost" value="--" hint="Payroll computation not yet enabled" />
          <MetricCard label="Reimbursement Queue" value="--" hint="Expense queue metrics coming soon" />
        </section>
      ) : null}

      {complianceMetrics ? (
        <section className="dashboard-panel dashboard-compliance-widget" aria-label="Compliance widget">
          <h3 className="section-title">Compliance</h3>
          <p className="dashboard-subtitle">
            <span className="numeric">{complianceMetrics.overdueCount}</span> overdue deadlines
          </p>
          {complianceMetrics.nextDeadline ? (
            <p className="dashboard-subtitle">
              Next: {countryFlagFromCode(complianceMetrics.nextDeadline.countryCode)}{" "}
              {countryNameFromCode(complianceMetrics.nextDeadline.countryCode)} •{" "}
              {complianceMetrics.nextDeadline.requirement}{" "}
              <span
                className="numeric"
                title={formatDateTimeTooltip(complianceMetrics.nextDeadline.dueDate)}
              >
                ({formatRelativeTime(complianceMetrics.nextDeadline.dueDate)})
              </span>
            </p>
          ) : (
            <p className="dashboard-subtitle">No upcoming compliance deadlines.</p>
          )}
          <Link className="quick-link" href="/compliance">
            Open Compliance
          </Link>
        </section>
      ) : null}

      {hasRole(roles, "SUPER_ADMIN") ? (
        <section className="metric-grid" aria-label="Super admin metrics">
          <MetricCard label="Headcount by Country" value={countrySummary.countryCount} hint={countrySummary.distribution} />
          <MetricCard label="System Health" value="Healthy" hint="Core auth and route guards are active" />
          <MetricCard label="Audit Throughput" value="--" hint="Audit analytics module pending" />
          <MetricCard label="Policy Coverage" value="--" hint="Compliance policy coverage pending" />
        </section>
      ) : null}
    </>
  );
}
