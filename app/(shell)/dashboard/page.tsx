import Link from "next/link";

import { DashboardAnnouncementsWidget } from "../../../components/shared/dashboard-announcements-widget";
import { EmptyState } from "../../../components/shared/empty-state";
import { MetricCard } from "../../../components/shared/metric-card";
import { PageHeader } from "../../../components/shared/page-header";
import { getAuthenticatedSession } from "../../../lib/auth/session";
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
  const activeHeadcount = members.filter((member) => member.status !== "inactive").length;
  const onboardingCount = members.filter((member) => member.status === "onboarding").length;
  const countrySummary = getCountrySummary(members);

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
              <Link className="quick-link" href="/payroll">
                View Payslips
              </Link>
            </li>
            <li>
              <Link className="quick-link" href="/documents">
                My Documents
              </Link>
            </li>
          </ul>
        </div>
      </section>

      {hasManagerAccess(roles) ? (
        <section className="metric-grid" aria-label="Manager metrics">
          <MetricCard label="Team Report Count" value={String(reportCount)} hint="Direct reports in your team" />
          <MetricCard label="Who's Out" value="--" hint="Time Off status data pending" />
          <MetricCard label="Pending Approvals" value="--" hint="Approval queues come in Phase 2" />
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
