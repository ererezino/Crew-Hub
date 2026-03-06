"use client";

import { PageHeader } from "../../../../components/shared/page-header";

const ROLE_DEFAULTS: { role: string; label: string; modules: string[] }[] = [
  {
    role: "EMPLOYEE",
    label: "Employee",
    modules: ["Home", "Announcements", "Time Off", "My Pay", "Documents", "Learning", "Expenses"]
  },
  {
    role: "TEAM_LEAD",
    label: "Team Lead",
    modules: ["Home", "Announcements", "Time Off", "My Pay", "Documents", "Learning", "Expenses", "Approvals", "People", "Scheduling", "Team Hub"]
  },
  {
    role: "MANAGER",
    label: "Manager",
    modules: ["Home", "Announcements", "Time Off", "My Pay", "Documents", "Learning", "Expenses", "Approvals", "People", "Scheduling", "Onboarding", "Team Hub"]
  },
  {
    role: "HR_ADMIN",
    label: "HR Admin",
    modules: ["Home", "Announcements", "Time Off", "My Pay", "Documents", "Learning", "Expenses", "Approvals", "People", "Scheduling", "Onboarding", "Team Hub", "Performance", "Compliance", "Analytics", "Signatures"]
  },
  {
    role: "FINANCE_ADMIN",
    label: "Finance Admin",
    modules: ["Home", "Announcements", "Time Off", "My Pay", "Documents", "Learning", "Expenses", "Approvals", "People", "Payroll", "Compensation", "Analytics"]
  },
  {
    role: "SUPER_ADMIN",
    label: "Super Admin",
    modules: ["All modules"]
  }
];

export function AccessControlAdminClient() {
  return (
    <>
      <PageHeader
        title="Roles & Access"
        description="Default role permissions and per-person overrides."
      />

      <div style={{ display: "grid", gap: "var(--space-6)" }}>
        <section>
          <h3 className="section-heading" style={{ marginBottom: "var(--space-4)" }}>
            Default Role Permissions
          </h3>
          <p className="body-text" style={{ color: "var(--text-secondary)", marginBottom: "var(--space-4)" }}>
            These are the default modules each role can access. Role-based access is enforced in code.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: "var(--space-4)" }}>
            {ROLE_DEFAULTS.map((entry) => (
              <div key={entry.role} className="card">
                <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", marginBottom: "var(--space-3)" }}>
                  <span style={{ fontSize: "14px", fontWeight: 600, color: "var(--text-primary)" }}>{entry.label}</span>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-1)" }}>
                  {entry.modules.map((mod) => (
                    <span
                      key={mod}
                      style={{
                        fontSize: "12px",
                        padding: "2px 8px",
                        borderRadius: "11px",
                        background: "var(--bg-secondary)",
                        color: "var(--text-secondary)",
                        fontWeight: 500
                      }}
                    >
                      {mod}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h3 className="section-heading" style={{ marginBottom: "var(--space-4)" }}>
            Per-Person Overrides
          </h3>
          <p className="body-text" style={{ color: "var(--text-secondary)", marginBottom: "var(--space-4)" }}>
            Grant individual employees access to modules their role would not normally allow. This should be rare and treated as an exception.
          </p>
          <div className="card">
            <div className="empty-state-container" style={{ textAlign: "center", padding: "var(--space-8) var(--space-4)" }}>
              <p className="body-text" style={{ color: "var(--text-tertiary)" }}>
                No per-person overrides configured. To add an override, edit the employee&apos;s profile in People and adjust their access.
              </p>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
