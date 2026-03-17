"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";

import { NavIcon } from "../../../../components/shared/nav-icon";
import { PageHeader } from "../../../../components/shared/page-header";
import type {
  AdminAccessConfigResponseData,
  NavigationAccessConfigRecord,
  DashboardWidgetConfigRecord
} from "../../../../types/access-control";

/* ── Module registry (matches navigation.ts nav items) ── */

type ModuleDef = {
  key: string;
  labelKey: string;
  icon: string;
  categoryKey: string;
};

const ALL_MODULES: ModuleDef[] = [
  { key: "/dashboard", labelKey: "modHome", icon: "LayoutDashboard", categoryKey: "catCore" },
  { key: "/announcements", labelKey: "modNotifications", icon: "Bell", categoryKey: "catCore" },
  { key: "/time-off", labelKey: "modTimeOff", icon: "CalendarOff", categoryKey: "catMyWork" },
  { key: "/me/pay", labelKey: "modMyPay", icon: "Wallet", categoryKey: "catMyWork" },
  { key: "/documents", labelKey: "modDocuments", icon: "FileText", categoryKey: "catMyWork" },
  { key: "/expenses", labelKey: "modExpenses", icon: "Receipt", categoryKey: "catMyWork" },
  { key: "/learning", labelKey: "modLearning", icon: "GraduationCap", categoryKey: "catMyWork" },
  { key: "/approvals", labelKey: "modApprovals", icon: "CheckCircle", categoryKey: "catTeam" },
  { key: "/people", labelKey: "modCrewMembers", icon: "Users", categoryKey: "catTeam" },
  { key: "/scheduling", labelKey: "modScheduling", icon: "Calendar", categoryKey: "catTeam" },
  { key: "/onboarding", labelKey: "modOnboarding", icon: "Rocket", categoryKey: "catTeam" },
  { key: "/team-hub", labelKey: "modTeamHub", icon: "BookOpen", categoryKey: "catTeam" },
  { key: "/payroll", labelKey: "modPayroll", icon: "Calculator", categoryKey: "catFinance" },
  { key: "/admin/compensation", labelKey: "modCompensation", icon: "Coins", categoryKey: "catFinance" },
  { key: "/performance", labelKey: "modPerformance", icon: "Star", categoryKey: "catOperations" },
  { key: "/compliance", labelKey: "modCompliance", icon: "ShieldCheck", categoryKey: "catOperations" },
  { key: "/analytics", labelKey: "modAnalytics", icon: "BarChart3", categoryKey: "catOperations" },
  { key: "/signatures", labelKey: "modSignatures", icon: "PenTool", categoryKey: "catOperations" }
];

const MODULE_KEYS_SET = new Set(ALL_MODULES.map((m) => m.key));
const MODULE_BY_KEY = new Map(ALL_MODULES.map((m) => [m.key, m]));
const CATEGORY_KEYS = ["catCore", "catMyWork", "catTeam", "catFinance", "catOperations"] as const;

const ALL_ROLE_KEYS = [
  "EMPLOYEE",
  "TEAM_LEAD",
  "MANAGER",
  "HR_ADMIN",
  "FINANCE_ADMIN",
  "SUPER_ADMIN"
] as const;

/* ── Role configuration ── */

type RoleDef = {
  role: string;
  labelKey: string;
  descriptionKey: string;
  icon: string;
  accent: string;
  accentLight: string;
};

const ROLES: RoleDef[] = [
  {
    role: "EMPLOYEE",
    labelKey: "roleEmployee",
    descriptionKey: "roleEmployeeDesc",
    icon: "User",
    accent: "#16a34a",
    accentLight: "#f0fdf4"
  },
  {
    role: "TEAM_LEAD",
    labelKey: "roleTeamLead",
    descriptionKey: "roleTeamLeadDesc",
    icon: "UserCheck",
    accent: "#2563eb",
    accentLight: "#eff6ff"
  },
  {
    role: "MANAGER",
    labelKey: "roleManager",
    descriptionKey: "roleManagerDesc",
    icon: "Users",
    accent: "#7c3aed",
    accentLight: "#f5f3ff"
  },
  {
    role: "HR_ADMIN",
    labelKey: "roleHrAdmin",
    descriptionKey: "roleHrAdminDesc",
    icon: "Shield",
    accent: "#ea580c",
    accentLight: "#fff7ed"
  },
  {
    role: "FINANCE_ADMIN",
    labelKey: "roleFinanceAdmin",
    descriptionKey: "roleFinanceAdminDesc",
    icon: "Coins",
    accent: "#ca8a04",
    accentLight: "#fefce8"
  },
  {
    role: "SUPER_ADMIN",
    labelKey: "roleSuperAdmin",
    descriptionKey: "roleSuperAdminDesc",
    icon: "Crown",
    accent: "#db2777",
    accentLight: "#fdf2f8"
  }
];

/* ── Helpers ── */

/**
 * Derive role → enabled module keys from nav-item-centric config.
 * A role has a module enabled if that role appears in the module's visibleToRoles.
 */
function deriveRoleModulesFromNavConfig(
  navigation: NavigationAccessConfigRecord[]
): Record<string, Set<string>> {
  const result: Record<string, Set<string>> = {};

  for (const roleDef of ROLES) {
    result[roleDef.role] = new Set<string>();
  }

  for (const navItem of navigation) {
    if (!MODULE_KEYS_SET.has(navItem.navItemKey)) continue;
    for (const role of navItem.visibleToRoles) {
      if (result[role]) {
        result[role].add(navItem.navItemKey);
      }
    }
  }

  // SUPER_ADMIN always has all modules
  result["SUPER_ADMIN"] = new Set(ALL_MODULES.map((m) => m.key));

  return result;
}

/**
 * Build updated navigation payload from role-centric changes.
 * Takes the full nav config and applies role→module changes,
 * preserving per-person overrides (granted/revoked employee IDs).
 */
function buildNavigationPayload(
  roleModules: Record<string, Set<string>>,
  existingNavigation: NavigationAccessConfigRecord[]
) {
  const existingByKey = new Map(
    existingNavigation.map((row) => [row.navItemKey, row] as const)
  );

  return ALL_MODULES.map((mod) => {
    const existing = existingByKey.get(mod.key);

    // Compute visibleToRoles: collect all non-SUPER_ADMIN roles that have this module checked
    const visibleToRoles: string[] = [];
    for (const roleKey of ALL_ROLE_KEYS) {
      if (roleKey === "SUPER_ADMIN") continue; // SUPER_ADMIN is implicit, not stored
      if (roleModules[roleKey]?.has(mod.key)) {
        visibleToRoles.push(roleKey);
      }
    }

    return {
      navItemKey: mod.key,
      visibleToRoles,
      // Preserve per-person overrides
      grantedEmployeeIds: existing?.grantedEmployeeIds ?? [],
      revokedEmployeeIds: existing?.revokedEmployeeIds ?? []
    };
  });
}

function groupByCategory(
  moduleKeys: string[],
  tDynamic: (key: string) => string
): Map<string, { categoryLabel: string; modules: ModuleDef[] }> {
  const groups = new Map<string, { categoryLabel: string; modules: ModuleDef[] }>();
  for (const catKey of CATEGORY_KEYS) {
    groups.set(catKey, { categoryLabel: tDynamic(catKey), modules: [] });
  }
  for (const key of moduleKeys) {
    const mod = MODULE_BY_KEY.get(key);
    if (!mod) continue;
    const group = groups.get(mod.categoryKey);
    if (group) group.modules.push(mod);
  }
  return groups;
}

/* ── Component ── */

export function AccessControlAdminClient() {
  const t = useTranslations("accessControl");
  const tCommon = useTranslations("common");
  const td = t as (key: string, params?: Record<string, unknown>) => string;

  // Full API data (nav + widget records), kept in sync with saves
  const navRecordsRef = useRef<NavigationAccessConfigRecord[]>([]);
  const widgetRecordsRef = useRef<DashboardWidgetConfigRecord[]>([]);

  // Role → enabled module keys (derived from nav config on load, updated on edit)
  const [roleModules, setRoleModules] = useState<Record<string, Set<string>>>(() => {
    const initial: Record<string, Set<string>> = {};
    for (const r of ROLES) {
      initial[r.role] = new Set<string>();
    }
    return initial;
  });

  const [editingRole, setEditingRole] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  /* Fetch real access config on mount */
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch("/api/v1/admin/access-config");
        if (!res.ok) return;

        const json = (await res.json()) as {
          data?: AdminAccessConfigResponseData | null;
        };

        if (!json?.data || cancelled) return;

        const { navigation, widgets } = json.data;

        navRecordsRef.current = navigation;
        widgetRecordsRef.current = widgets;

        const derived = deriveRoleModulesFromNavConfig(navigation);
        setRoleModules(derived);
        setLoaded(true);
      } catch {
        /* Use empty state on failure */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const startEditing = useCallback(
    (role: string) => {
      setEditingRole(role);
      setEditDraft(new Set(roleModules[role] ?? []));
    },
    [roleModules]
  );

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
      // Apply the edit to the role→modules state
      const updatedRoleModules = {
        ...roleModules,
        [editingRole]: new Set(editDraft)
      };

      // Build full navigation payload from role-centric state
      const navigationPayload = buildNavigationPayload(
        updatedRoleModules,
        navRecordsRef.current
      );

      // Build widget payload (pass through unchanged)
      const widgetPayload = widgetRecordsRef.current.map((w) => ({
        widgetKey: w.widgetKey,
        visibleToRoles: w.visibleToRoles
      }));

      const res = await fetch("/api/v1/admin/access-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          navigation: navigationPayload,
          widgets: widgetPayload
        })
      });

      if (!res.ok) {
        throw new Error("Save failed");
      }

      const json = (await res.json()) as {
        data?: AdminAccessConfigResponseData | null;
      };

      if (json?.data) {
        // Update refs with fresh server data
        navRecordsRef.current = json.data.navigation;
        widgetRecordsRef.current = json.data.widgets;

        // Re-derive role modules from server response
        const derived = deriveRoleModulesFromNavConfig(json.data.navigation);
        setRoleModules(derived);
      } else {
        // Optimistic update if server didn't return fresh data
        setRoleModules(updatedRoleModules);
      }

      setEditingRole(null);
      setEditDraft(new Set());
    } catch {
      /* Stay in edit mode on failure */
    } finally {
      setSaving(false);
    }
  }, [editingRole, editDraft, roleModules]);

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />

      <div className="rac-page">
        {/* ── Role Permission Cards ── */}
        <section className="rac-section">
          <div className="rac-section-header">
            <h3 className="rac-section-title">{t("rolePermissions")}</h3>
            <p className="rac-section-subtitle">
              {t.rich("rolePermissionsDescription", {
                strong: (chunks) => <strong>{chunks}</strong>
              })}
            </p>
          </div>

          <div className="rac-role-grid">
            {ROLES.map((roleDef) => {
              const isEditing = editingRole === roleDef.role;
              const isSuperAdmin = roleDef.role === "SUPER_ADMIN";
              const modules = roleModules[roleDef.role] ?? new Set<string>();
              const grouped = groupByCategory(Array.from(modules), td);
              const totalModules = modules.size;

              return (
                <article
                  key={roleDef.role}
                  className={`rac-card ${isEditing ? "rac-card-editing" : ""}`}
                  style={
                    {
                      "--rac-accent": roleDef.accent,
                      "--rac-accent-light": roleDef.accentLight
                    } as React.CSSProperties
                  }
                >
                  <div className="rac-card-accent" />

                  <div className="rac-card-content">
                    {/* Header */}
                    <div className="rac-card-header">
                      <div className="rac-card-icon-wrap">
                        <NavIcon name={roleDef.icon} size={22} />
                      </div>
                      <div className="rac-card-header-text">
                        <h4 className="rac-card-name">{td(roleDef.labelKey)}</h4>
                        <p className="rac-card-desc">
                          {td(roleDef.descriptionKey)}
                        </p>
                      </div>
                      {!isSuperAdmin && !isEditing && loaded ? (
                        <button
                          type="button"
                          className="rac-edit-btn"
                          onClick={() => startEditing(roleDef.role)}
                          aria-label={t("editPermissions", {
                            role: td(roleDef.labelKey)
                          })}
                        >
                          <NavIcon name="Pencil" size={14} />
                          {t("edit")}
                        </button>
                      ) : null}
                    </div>

                    {/* Module list — read mode */}
                    {!isEditing ? (
                      <div className="rac-card-modules">
                        {isSuperAdmin ? (
                          <div className="rac-super-admin-badge">
                            <NavIcon name="Crown" size={16} />
                            <span>
                              {t("fullAccess", { count: ALL_MODULES.length })}
                            </span>
                          </div>
                        ) : (
                          Array.from(grouped.entries()).map(
                            ([categoryKey, { categoryLabel, modules: mods }]) => {
                              if (mods.length === 0) return null;
                              return (
                                <div
                                  key={categoryKey}
                                  className="rac-module-group"
                                >
                                  <span className="rac-module-group-label">
                                    {categoryLabel}
                                  </span>
                                  <div className="rac-module-list">
                                    {mods.map((mod) => (
                                      <span
                                        key={mod.key}
                                        className="rac-module-pill"
                                      >
                                        <NavIcon name={mod.icon} size={13} />
                                        {td(mod.labelKey)}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              );
                            }
                          )
                        )}
                      </div>
                    ) : null}

                    {/* Module list — edit mode */}
                    {isEditing ? (
                      <div className="rac-card-edit">
                        {CATEGORY_KEYS.map((categoryKey) => {
                          const catModules = ALL_MODULES.filter(
                            (m) => m.categoryKey === categoryKey
                          );
                          return (
                            <div key={categoryKey} className="rac-edit-group">
                              <span className="rac-module-group-label">
                                {td(categoryKey)}
                              </span>
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
                                      <span>{td(mod.labelKey)}</span>
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
                            {saving ? t("saving") : t("saveChanges")}
                          </button>
                          <button
                            type="button"
                            className="rac-cancel-btn"
                            onClick={cancelEditing}
                          >
                            {tCommon("cancel")}
                          </button>
                        </div>
                      </div>
                    ) : null}

                    {/* Footer */}
                    {!isEditing ? (
                      <div className="rac-card-footer">
                        <span className="rac-module-count">
                          {isSuperAdmin
                            ? t("unrestricted")
                            : t("moduleCount", { count: totalModules })}
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
            <h3 className="rac-section-title">{t("overridesTitle")}</h3>
            <p className="rac-section-subtitle">{t("overridesDescription")}</p>
          </div>

          <div className="rac-overrides-empty">
            <div className="rac-overrides-empty-icon">
              <NavIcon name="ShieldOff" size={28} />
            </div>
            <p className="rac-overrides-empty-title">{t("noOverrides")}</p>
            <p className="rac-overrides-empty-desc">
              {t("noOverridesDescription")}
            </p>
          </div>
        </section>
      </div>
    </>
  );
}
