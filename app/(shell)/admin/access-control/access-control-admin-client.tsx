"use client";

import { useCallback, useEffect, useState } from "react";

import { NavIcon } from "../../../../components/shared/nav-icon";
import { PageHeader } from "../../../../components/shared/page-header";

/* ── Module registry (matches navigation.ts) ── */

type ModuleDef = {
  key: string;
  label: string;
  icon: string;
  category: string;
};

const ALL_MODULES: ModuleDef[] = [
  { key: "/dashboard", label: "Home", icon: "LayoutDashboard", category: "Core" },
  { key: "/announcements", label: "Notifications", icon: "Bell", category: "Core" },
  { key: "/time-off", label: "Time Off", icon: "CalendarOff", category: "My work" },
  { key: "/me/pay", label: "My Pay", icon: "Wallet", category: "My work" },
  { key: "/documents", label: "Documents", icon: "FileText", category: "My work" },
  { key: "/expenses", label: "Expenses", icon: "Receipt", category: "My work" },
  { key: "/learning", label: "Learning", icon: "GraduationCap", category: "My work" },
  { key: "/approvals", label: "Approvals", icon: "CheckCircle", category: "Team" },
  { key: "/people", label: "Crew Members", icon: "Users", category: "Team" },
  { key: "/scheduling", label: "Scheduling", icon: "Calendar", category: "Team" },
  { key: "/onboarding", label: "Onboarding", icon: "Rocket", category: "Team" },
  { key: "/team-hub", label: "Team Hub", icon: "BookOpen", category: "Team" },
  { key: "/payroll", label: "Payroll", icon: "Calculator", category: "Finance" },
  { key: "/admin/compensation", label: "Compensation", icon: "Coins", category: "Finance" },
  { key: "/performance", label: "Performance", icon: "Star", category: "Operations" },
  { key: "/compliance", label: "Compliance", icon: "ShieldCheck", category: "Operations" },
  { key: "/analytics", label: "Analytics", icon: "BarChart3", category: "Operations" },
  { key: "/signatures", label: "Signatures", icon: "PenTool", category: "Operations" }
];

const MODULE_BY_KEY = new Map(ALL_MODULES.map((m) => [m.key, m]));
const CATEGORIES = ["Core", "My work", "Team", "Finance", "Operations"] as const;

/* ── Role configuration ── */

type RoleDef = {
  role: string;
  label: string;
  description: string;
  icon: string;
  accent: string;
  accentLight: string;
};

const ROLES: RoleDef[] = [
  {
    role: "EMPLOYEE",
    label: "Employee",
    description: "Standard access for every crew member",
    icon: "User",
    accent: "#16a34a",
    accentLight: "#f0fdf4"
  },
  {
    role: "TEAM_LEAD",
    label: "Team Lead",
    description: "Employee access plus team oversight",
    icon: "UserCheck",
    accent: "#2563eb",
    accentLight: "#eff6ff"
  },
  {
    role: "MANAGER",
    label: "Manager",
    description: "Team lead access plus onboarding",
    icon: "Users",
    accent: "#7c3aed",
    accentLight: "#f5f3ff"
  },
  {
    role: "HR_ADMIN",
    label: "HR Admin",
    description: "Full people operations and compliance",
    icon: "Shield",
    accent: "#ea580c",
    accentLight: "#fff7ed"
  },
  {
    role: "FINANCE_ADMIN",
    label: "Finance Admin",
    description: "Payroll, compensation, and financial oversight",
    icon: "Coins",
    accent: "#ca8a04",
    accentLight: "#fefce8"
  },
  {
    role: "SUPER_ADMIN",
    label: "Super Admin",
    description: "Unrestricted access to every module",
    icon: "Crown",
    accent: "#db2777",
    accentLight: "#fdf2f8"
  }
];

const DEFAULT_ROLE_MODULES: Record<string, string[]> = {
  EMPLOYEE: [
    "/dashboard", "/announcements", "/time-off", "/me/pay",
    "/documents", "/expenses", "/learning"
  ],
  TEAM_LEAD: [
    "/dashboard", "/announcements", "/time-off", "/me/pay",
    "/documents", "/expenses", "/learning",
    "/approvals", "/people", "/scheduling", "/team-hub"
  ],
  MANAGER: [
    "/dashboard", "/announcements", "/time-off", "/me/pay",
    "/documents", "/expenses", "/learning",
    "/approvals", "/people", "/scheduling", "/onboarding", "/team-hub"
  ],
  HR_ADMIN: [
    "/dashboard", "/announcements", "/time-off", "/me/pay",
    "/documents", "/expenses", "/learning",
    "/approvals", "/people", "/scheduling", "/onboarding", "/team-hub",
    "/performance", "/compliance", "/analytics", "/signatures"
  ],
  FINANCE_ADMIN: [
    "/dashboard", "/announcements", "/time-off", "/me/pay",
    "/documents", "/expenses", "/learning",
    "/approvals", "/people",
    "/payroll", "/admin/compensation", "/analytics"
  ],
  SUPER_ADMIN: ALL_MODULES.map((m) => m.key)
};

/* ── Helpers ── */

function groupByCategory(moduleKeys: string[]): Map<string, ModuleDef[]> {
  const groups = new Map<string, ModuleDef[]>();
  for (const cat of CATEGORIES) {
    groups.set(cat, []);
  }
  for (const key of moduleKeys) {
    const mod = MODULE_BY_KEY.get(key);
    if (!mod) continue;
    const arr = groups.get(mod.category);
    if (arr) arr.push(mod);
  }
  return groups;
}

/* ── Component ── */

export function AccessControlAdminClient() {
  /* role → enabled module keys (starts with defaults, overwritten by API) */
  const [roleModules, setRoleModules] = useState<Record<string, Set<string>>>(() => {
    const initial: Record<string, Set<string>> = {};
    for (const r of ROLES) {
      initial[r.role] = new Set(DEFAULT_ROLE_MODULES[r.role] ?? []);
    }
    return initial;
  });

  const [editingRole, setEditingRole] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [loadedFromApi, setLoadedFromApi] = useState(false);

  /* Fetch saved config on mount */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/v1/admin/role-permissions");
        if (!res.ok) return;
        const json = (await res.json()) as {
          data?: { configs?: { role: string; modules: string[] }[] } | null;
        };
        const configs = json?.data?.configs;
        if (!Array.isArray(configs) || cancelled) return;

        setRoleModules((prev) => {
          const next = { ...prev };
          for (const cfg of configs) {
            if (cfg.role && Array.isArray(cfg.modules)) {
              next[cfg.role] = new Set(cfg.modules);
            }
          }
          return next;
        });
        setLoadedFromApi(true);
      } catch {
        /* Use defaults */
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const startEditing = useCallback((role: string) => {
    setEditingRole(role);
    setEditDraft(new Set(roleModules[role] ?? []));
  }, [roleModules]);

  const cancelEditing = useCallback(() => {
    setEditingRole(null);
    setEditDraft(new Set());
  }, []);

  const toggleModule = useCallback((key: string) => {
    setEditDraft((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  const saveChanges = useCallback(async () => {
    if (!editingRole) return;
    setSaving(true);
    try {
      await fetch("/api/v1/admin/role-permissions", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role: editingRole,
          modules: Array.from(editDraft)
        })
      });
      setRoleModules((prev) => ({
        ...prev,
        [editingRole]: new Set(editDraft)
      }));
      setEditingRole(null);
      setEditDraft(new Set());
    } catch {
      /* Stay in edit mode on failure */
    } finally {
      setSaving(false);
    }
  }, [editingRole, editDraft]);

  return (
    <>
      <PageHeader
        title="Roles & access"
        description="See what each role can access. Role-based access is enforced automatically."
      />

      <div className="rac-page">
        {/* ── Role Permission Cards ── */}
        <section className="rac-section">
          <div className="rac-section-header">
            <h3 className="rac-section-title">Role permissions</h3>
            <p className="rac-section-subtitle">
              Every crew member inherits the modules below based on their assigned role.
              Click <strong>Edit</strong> to add or remove modules.
            </p>
          </div>

          <div className="rac-role-grid">
            {ROLES.map((roleDef) => {
              const isEditing = editingRole === roleDef.role;
              const isSuperAdmin = roleDef.role === "SUPER_ADMIN";
              const modules = roleModules[roleDef.role] ?? new Set<string>();
              const grouped = groupByCategory(Array.from(modules));
              const totalModules = modules.size;

              return (
                <article
                  key={roleDef.role}
                  className={`rac-card ${isEditing ? "rac-card-editing" : ""}`}
                  style={{
                    "--rac-accent": roleDef.accent,
                    "--rac-accent-light": roleDef.accentLight
                  } as React.CSSProperties}
                >
                  {/* Accent bar */}
                  <div className="rac-card-accent" />

                  <div className="rac-card-content">
                    {/* Header */}
                    <div className="rac-card-header">
                      <div className="rac-card-icon-wrap">
                        <NavIcon name={roleDef.icon} size={22} />
                      </div>
                      <div className="rac-card-header-text">
                        <h4 className="rac-card-name">{roleDef.label}</h4>
                        <p className="rac-card-desc">{roleDef.description}</p>
                      </div>
                      {!isSuperAdmin && !isEditing ? (
                        <button
                          type="button"
                          className="rac-edit-btn"
                          onClick={() => startEditing(roleDef.role)}
                          aria-label={`Edit ${roleDef.label} permissions`}
                        >
                          <NavIcon name="Pencil" size={14} />
                          Edit
                        </button>
                      ) : null}
                    </div>

                    {/* Module list — read mode */}
                    {!isEditing ? (
                      <div className="rac-card-modules">
                        {isSuperAdmin ? (
                          <div className="rac-super-admin-badge">
                            <NavIcon name="Crown" size={16} />
                            <span>Full access to all {ALL_MODULES.length} modules</span>
                          </div>
                        ) : (
                          Array.from(grouped.entries()).map(([category, mods]) => {
                            if (mods.length === 0) return null;
                            return (
                              <div key={category} className="rac-module-group">
                                <span className="rac-module-group-label">{category}</span>
                                <div className="rac-module-list">
                                  {mods.map((mod) => (
                                    <span key={mod.key} className="rac-module-pill">
                                      <NavIcon name={mod.icon} size={13} />
                                      {mod.label}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    ) : null}

                    {/* Module list — edit mode */}
                    {isEditing ? (
                      <div className="rac-card-edit">
                        {CATEGORIES.map((category) => {
                          const catModules = ALL_MODULES.filter((m) => m.category === category);
                          return (
                            <div key={category} className="rac-edit-group">
                              <span className="rac-module-group-label">{category}</span>
                              <div className="rac-edit-items">
                                {catModules.map((mod) => {
                                  const checked = editDraft.has(mod.key);
                                  return (
                                    <label
                                      key={mod.key}
                                      className={`rac-edit-item ${checked ? "rac-edit-item-on" : ""}`}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={checked}
                                        onChange={() => toggleModule(mod.key)}
                                        className="rac-edit-checkbox"
                                      />
                                      <NavIcon name={mod.icon} size={15} />
                                      <span>{mod.label}</span>
                                    </label>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}

                        <div className="rac-edit-actions">
                          <button
                            type="button"
                            className="rac-save-btn"
                            onClick={saveChanges}
                            disabled={saving}
                          >
                            <NavIcon name="Check" size={14} />
                            {saving ? "Saving…" : "Save changes"}
                          </button>
                          <button
                            type="button"
                            className="rac-cancel-btn"
                            onClick={cancelEditing}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : null}

                    {/* Footer */}
                    {!isEditing ? (
                      <div className="rac-card-footer">
                        <span className="rac-module-count">
                          {isSuperAdmin ? "Unrestricted" : `${totalModules} module${totalModules === 1 ? "" : "s"}`}
                        </span>
                      </div>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        {/* ── Per-Person Overrides ── */}
        <section className="rac-section">
          <div className="rac-section-header">
            <h3 className="rac-section-title">Per-person overrides</h3>
            <p className="rac-section-subtitle">
              Grant individual crew members access to modules their role wouldn&apos;t normally allow. Use sparingly.
            </p>
          </div>

          <div className="rac-overrides-empty">
            <div className="rac-overrides-empty-icon">
              <NavIcon name="ShieldOff" size={28} />
            </div>
            <p className="rac-overrides-empty-title">No overrides configured</p>
            <p className="rac-overrides-empty-desc">
              To add an override, open a crew member&apos;s profile in Crew Members and adjust their access permissions.
            </p>
          </div>
        </section>
      </div>
    </>
  );
}
