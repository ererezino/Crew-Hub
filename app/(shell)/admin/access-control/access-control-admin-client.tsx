"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { NavIcon } from "../../../../components/shared/nav-icon";
import { PageHeader } from "../../../../components/shared/page-header";
import type {
  AccessControlProfileOption,
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
  { key: "/me/documents", labelKey: "modDocuments", icon: "FileText", categoryKey: "catMyWork" },
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
  { key: "/documents", labelKey: "modDocumentManagement", icon: "FolderOpen", categoryKey: "catOperations" },
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

/* ── Override types ── */

type OverrideEntry = {
  moduleKey: string;
  employeeId: string;
  type: "grant" | "revoke";
};

/* ── Helpers ── */

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

  result["SUPER_ADMIN"] = new Set(ALL_MODULES.map((m) => m.key));

  return result;
}

function buildNavigationPayload(
  roleModules: Record<string, Set<string>>,
  existingNavigation: NavigationAccessConfigRecord[]
) {
  const existingByKey = new Map(
    existingNavigation.map((row) => [row.navItemKey, row] as const)
  );

  return ALL_MODULES.map((mod) => {
    const existing = existingByKey.get(mod.key);

    const visibleToRoles: string[] = [];
    for (const roleKey of ALL_ROLE_KEYS) {
      if (roleKey === "SUPER_ADMIN") continue;
      if (roleModules[roleKey]?.has(mod.key)) {
        visibleToRoles.push(roleKey);
      }
    }

    return {
      navItemKey: mod.key,
      visibleToRoles,
      grantedEmployeeIds: existing?.grantedEmployeeIds ?? [],
      revokedEmployeeIds: existing?.revokedEmployeeIds ?? []
    };
  });
}

function buildNavigationPayloadWithOverrides(
  roleModules: Record<string, Set<string>>,
  existingNavigation: NavigationAccessConfigRecord[],
  overrideEdits: {
    grants: Map<string, Set<string>>;
    revokes: Map<string, Set<string>>;
  }
) {
  const existingByKey = new Map(
    existingNavigation.map((row) => [row.navItemKey, row] as const)
  );

  return ALL_MODULES.map((mod) => {
    const existing = existingByKey.get(mod.key);

    const visibleToRoles: string[] = [];
    for (const roleKey of ALL_ROLE_KEYS) {
      if (roleKey === "SUPER_ADMIN") continue;
      if (roleModules[roleKey]?.has(mod.key)) {
        visibleToRoles.push(roleKey);
      }
    }

    return {
      navItemKey: mod.key,
      visibleToRoles,
      grantedEmployeeIds: Array.from(overrideEdits.grants.get(mod.key) ?? existing?.grantedEmployeeIds ?? []),
      revokedEmployeeIds: Array.from(overrideEdits.revokes.get(mod.key) ?? existing?.revokedEmployeeIds ?? [])
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

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]![0]?.toUpperCase() ?? "?";
  return `${parts[0]![0] ?? ""}${parts[parts.length - 1]![0] ?? ""}`.toUpperCase();
}

function deriveOverrides(
  navigation: NavigationAccessConfigRecord[]
): OverrideEntry[] {
  const entries: OverrideEntry[] = [];
  for (const nav of navigation) {
    if (!MODULE_KEYS_SET.has(nav.navItemKey)) continue;
    for (const empId of nav.grantedEmployeeIds) {
      entries.push({ moduleKey: nav.navItemKey, employeeId: empId, type: "grant" });
    }
    for (const empId of nav.revokedEmployeeIds) {
      entries.push({ moduleKey: nav.navItemKey, employeeId: empId, type: "revoke" });
    }
  }
  return entries;
}

/* ── Component ── */

export function AccessControlAdminClient() {
  const t = useTranslations("accessControl");
  const tCommon = useTranslations("common");
  const td = t as (key: string, params?: Record<string, unknown>) => string;

  const navRecordsRef = useRef<NavigationAccessConfigRecord[]>([]);
  const widgetRecordsRef = useRef<DashboardWidgetConfigRecord[]>([]);
  const [employees, setEmployees] = useState<AccessControlProfileOption[]>([]);

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

  // Override UI state
  const [overrides, setOverrides] = useState<OverrideEntry[]>([]);
  const [addingOverride, setAddingOverride] = useState(false);
  const [overrideType, setOverrideType] = useState<"grant" | "revoke">("grant");
  const [overrideModule, setOverrideModule] = useState("");
  const [overrideSearch, setOverrideSearch] = useState("");
  const [overrideSelectedIds, setOverrideSelectedIds] = useState<Set<string>>(new Set());
  const [overrideSaving, setOverrideSaving] = useState(false);
  const [overrideToast, setOverrideToast] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const employeeById = useMemo(() => {
    const map = new Map<string, AccessControlProfileOption>();
    for (const emp of employees) {
      map.set(emp.id, emp);
    }
    return map;
  }, [employees]);

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
        setEmployees(json.data.employees);

        const derived = deriveRoleModulesFromNavConfig(navigation);
        setRoleModules(derived);
        setOverrides(deriveOverrides(navigation));
        setLoaded(true);
      } catch {
        /* Use empty state on failure */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Auto-clear toast
  useEffect(() => {
    if (!overrideToast) return;
    const timer = setTimeout(() => setOverrideToast(null), 3000);
    return () => clearTimeout(timer);
  }, [overrideToast]);

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
      const updatedRoleModules = {
        ...roleModules,
        [editingRole]: new Set(editDraft)
      };

      const navigationPayload = buildNavigationPayload(
        updatedRoleModules,
        navRecordsRef.current
      );

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
        navRecordsRef.current = json.data.navigation;
        widgetRecordsRef.current = json.data.widgets;
        setEmployees(json.data.employees);

        const derived = deriveRoleModulesFromNavConfig(json.data.navigation);
        setRoleModules(derived);
        setOverrides(deriveOverrides(json.data.navigation));
      } else {
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

  /* ── Override management ── */

  const grantOverrides = useMemo(() => overrides.filter((o) => o.type === "grant"), [overrides]);
  const revokeOverrides = useMemo(() => overrides.filter((o) => o.type === "revoke"), [overrides]);
  const hasOverrides = overrides.length > 0;

  // Group overrides by module for display
  const grantsByModule = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const o of grantOverrides) {
      const list = map.get(o.moduleKey) ?? [];
      list.push(o.employeeId);
      map.set(o.moduleKey, list);
    }
    return map;
  }, [grantOverrides]);

  const revokesByModule = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const o of revokeOverrides) {
      const list = map.get(o.moduleKey) ?? [];
      list.push(o.employeeId);
      map.set(o.moduleKey, list);
    }
    return map;
  }, [revokeOverrides]);

  // Employees already in the selected module+type
  const existingIdsForSelection = useMemo(() => {
    if (!overrideModule) return new Set<string>();
    const source = overrideType === "grant" ? grantsByModule : revokesByModule;
    return new Set(source.get(overrideModule) ?? []);
  }, [overrideModule, overrideType, grantsByModule, revokesByModule]);

  // Filtered employees for the add-override search
  const filteredEmployees = useMemo(() => {
    if (!overrideModule) return [];
    const query = overrideSearch.trim().toLowerCase();
    return employees.filter((emp) => {
      // Don't show employees already in this override
      if (existingIdsForSelection.has(emp.id)) return false;
      // Don't show already-selected
      if (overrideSelectedIds.has(emp.id)) return false;
      if (!query) return true;
      return (
        emp.fullName.toLowerCase().includes(query) ||
        emp.email.toLowerCase().includes(query) ||
        (emp.department?.toLowerCase().includes(query) ?? false)
      );
    });
  }, [employees, overrideModule, overrideSearch, existingIdsForSelection, overrideSelectedIds]);

  const resetAddForm = useCallback(() => {
    setAddingOverride(false);
    setOverrideType("grant");
    setOverrideModule("");
    setOverrideSearch("");
    setOverrideSelectedIds(new Set());
  }, []);

  const saveOverride = useCallback(async () => {
    if (!overrideModule || overrideSelectedIds.size === 0) return;
    setOverrideSaving(true);

    try {
      // Build updated grants/revokes maps from current nav records
      const grants = new Map<string, Set<string>>();
      const revokes = new Map<string, Set<string>>();

      for (const nav of navRecordsRef.current) {
        if (!MODULE_KEYS_SET.has(nav.navItemKey)) continue;
        grants.set(nav.navItemKey, new Set(nav.grantedEmployeeIds));
        revokes.set(nav.navItemKey, new Set(nav.revokedEmployeeIds));
      }

      // Apply the new overrides
      const targetMap = overrideType === "grant" ? grants : revokes;
      const oppositeMap = overrideType === "grant" ? revokes : grants;
      const existing = targetMap.get(overrideModule) ?? new Set<string>();
      const opposite = oppositeMap.get(overrideModule) ?? new Set<string>();

      for (const empId of overrideSelectedIds) {
        existing.add(empId);
        // Remove from the opposite list if present
        opposite.delete(empId);
      }

      targetMap.set(overrideModule, existing);
      oppositeMap.set(overrideModule, opposite);

      const navigationPayload = buildNavigationPayloadWithOverrides(
        roleModules,
        navRecordsRef.current,
        { grants, revokes }
      );

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

      if (!res.ok) throw new Error("Save failed");

      const json = (await res.json()) as {
        data?: AdminAccessConfigResponseData | null;
      };

      if (json?.data) {
        navRecordsRef.current = json.data.navigation;
        widgetRecordsRef.current = json.data.widgets;
        setEmployees(json.data.employees);
        const derived = deriveRoleModulesFromNavConfig(json.data.navigation);
        setRoleModules(derived);
        setOverrides(deriveOverrides(json.data.navigation));
      }

      resetAddForm();
      setOverrideToast({ type: "success", message: td("overrideSaved") });
    } catch {
      setOverrideToast({ type: "error", message: td("overrideSaveFailed") });
    } finally {
      setOverrideSaving(false);
    }
  }, [overrideModule, overrideSelectedIds, overrideType, roleModules, resetAddForm, td]);

  const removeOverride = useCallback(async (entry: OverrideEntry) => {
    setOverrideSaving(true);

    try {
      const grants = new Map<string, Set<string>>();
      const revokes = new Map<string, Set<string>>();

      for (const nav of navRecordsRef.current) {
        if (!MODULE_KEYS_SET.has(nav.navItemKey)) continue;
        grants.set(nav.navItemKey, new Set(nav.grantedEmployeeIds));
        revokes.set(nav.navItemKey, new Set(nav.revokedEmployeeIds));
      }

      const targetMap = entry.type === "grant" ? grants : revokes;
      const existing = targetMap.get(entry.moduleKey);
      if (existing) {
        existing.delete(entry.employeeId);
      }

      const navigationPayload = buildNavigationPayloadWithOverrides(
        roleModules,
        navRecordsRef.current,
        { grants, revokes }
      );

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

      if (!res.ok) throw new Error("Save failed");

      const json = (await res.json()) as {
        data?: AdminAccessConfigResponseData | null;
      };

      if (json?.data) {
        navRecordsRef.current = json.data.navigation;
        widgetRecordsRef.current = json.data.widgets;
        setEmployees(json.data.employees);
        const derived = deriveRoleModulesFromNavConfig(json.data.navigation);
        setRoleModules(derived);
        setOverrides(deriveOverrides(json.data.navigation));
      }

      setOverrideToast({ type: "success", message: td("overrideRemoved") });
    } catch {
      setOverrideToast({ type: "error", message: td("overrideSaveFailed") });
    } finally {
      setOverrideSaving(false);
    }
  }, [roleModules, td]);

  const renderOverrideGroup = (
    type: "grant" | "revoke",
    groupMap: Map<string, string[]>,
    sectionTitle: string,
    sectionDesc: string,
    icon: string,
    badgeClass: string
  ) => {
    if (groupMap.size === 0) return null;

    return (
      <div className="rac-override-group">
        <div className="rac-override-group-header">
          <NavIcon name={icon} size={16} />
          <div>
            <h4 className="rac-override-group-title">{sectionTitle}</h4>
            <p className="rac-override-group-desc">{sectionDesc}</p>
          </div>
        </div>

        {Array.from(groupMap.entries()).map(([moduleKey, empIds]) => {
          const mod = MODULE_BY_KEY.get(moduleKey);
          if (!mod) return null;

          return (
            <div key={moduleKey} className="rac-override-module-block">
              <div className="rac-override-module-label">
                <NavIcon name={mod.icon} size={14} />
                <span>{td(mod.labelKey)}</span>
              </div>
              <div className="rac-override-people">
                {empIds.map((empId) => {
                  const emp = employeeById.get(empId);
                  if (!emp) return null;
                  return (
                    <div key={empId} className={`rac-override-person ${badgeClass}`}>
                      <span className="rac-override-person-avatar">
                        {getInitials(emp.fullName)}
                      </span>
                      <div className="rac-override-person-info">
                        <span className="rac-override-person-name">{emp.fullName}</span>
                        <span className="rac-override-person-meta">
                          {emp.department ?? emp.email}
                        </span>
                      </div>
                      <button
                        type="button"
                        className="rac-override-remove-btn"
                        onClick={() => {
                          void removeOverride({ moduleKey, employeeId: empId, type });
                        }}
                        disabled={overrideSaving}
                        aria-label={`${td("removeOverride")} ${emp.fullName}`}
                      >
                        <NavIcon name="X" size={14} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

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

                    {/* Module list -- read mode */}
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

                    {/* Module list -- edit mode */}
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
            <div className="rac-section-header-row">
              <div>
                <h3 className="rac-section-title">{t("overridesTitle")}</h3>
                <p className="rac-section-subtitle">{t("overridesDescription")}</p>
              </div>
              {loaded && !addingOverride ? (
                <button
                  type="button"
                  className="rac-save-btn"
                  onClick={() => setAddingOverride(true)}
                >
                  <NavIcon name="Plus" size={14} />
                  {t("addGrant")}
                </button>
              ) : null}
            </div>
          </div>

          {/* Toast */}
          {overrideToast ? (
            <div className={`rac-override-toast rac-override-toast-${overrideToast.type}`}>
              <NavIcon name={overrideToast.type === "success" ? "Check" : "AlertCircle"} size={16} />
              <span>{overrideToast.message}</span>
            </div>
          ) : null}

          {/* Add override form */}
          {addingOverride ? (
            <div className="rac-override-add-form">
              <div className="rac-override-add-header">
                <h4 className="rac-override-add-title">
                  {overrideType === "grant" ? t("addGrant") : t("addRevoke")}
                </h4>
              </div>

              {/* Type toggle */}
              <div className="rac-override-type-toggle">
                <button
                  type="button"
                  className={`rac-override-type-btn ${overrideType === "grant" ? "active" : ""}`}
                  onClick={() => {
                    setOverrideType("grant");
                    setOverrideSelectedIds(new Set());
                  }}
                >
                  <NavIcon name="UserPlus" size={14} />
                  {t("addGrant")}
                </button>
                <button
                  type="button"
                  className={`rac-override-type-btn ${overrideType === "revoke" ? "active" : ""}`}
                  onClick={() => {
                    setOverrideType("revoke");
                    setOverrideSelectedIds(new Set());
                  }}
                >
                  <NavIcon name="UserMinus" size={14} />
                  {t("addRevoke")}
                </button>
              </div>

              {/* Module selector */}
              <div className="rac-override-field">
                <label className="rac-override-field-label">{t("selectModule")}</label>
                <select
                  className="form-input"
                  value={overrideModule}
                  onChange={(e) => {
                    setOverrideModule(e.target.value);
                    setOverrideSelectedIds(new Set());
                    setOverrideSearch("");
                  }}
                >
                  <option value="">{t("selectModule")}</option>
                  {ALL_MODULES.map((mod) => (
                    <option key={mod.key} value={mod.key}>{td(mod.labelKey)}</option>
                  ))}
                </select>
              </div>

              {/* Person search + selection */}
              {overrideModule ? (
                <div className="rac-override-field">
                  <label className="rac-override-field-label">{t("selectPerson")}</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder={td("selectPerson")}
                    value={overrideSearch}
                    onChange={(e) => setOverrideSearch(e.target.value)}
                  />

                  {/* Selected people */}
                  {overrideSelectedIds.size > 0 ? (
                    <div className="rac-override-selected-list">
                      {Array.from(overrideSelectedIds).map((empId) => {
                        const emp = employeeById.get(empId);
                        if (!emp) return null;
                        return (
                          <span key={empId} className="rac-override-selected-badge">
                            <span className="rac-override-selected-badge-avatar">
                              {getInitials(emp.fullName)}
                            </span>
                            {emp.fullName}
                            <button
                              type="button"
                              className="rac-override-selected-badge-remove"
                              onClick={() => {
                                setOverrideSelectedIds((prev) => {
                                  const next = new Set(prev);
                                  next.delete(empId);
                                  return next;
                                });
                              }}
                              aria-label={`Remove ${emp.fullName}`}
                            >
                              <NavIcon name="X" size={12} />
                            </button>
                          </span>
                        );
                      })}
                    </div>
                  ) : null}

                  {/* Search results */}
                  {(overrideSearch.trim() || overrideSelectedIds.size === 0) ? (
                    <div className="rac-override-search-results">
                      {filteredEmployees.slice(0, 8).map((emp) => (
                        <button
                          key={emp.id}
                          type="button"
                          className="rac-override-search-result"
                          onClick={() => {
                            setOverrideSelectedIds((prev) => new Set([...prev, emp.id]));
                            setOverrideSearch("");
                          }}
                        >
                          <span className="rac-override-search-avatar">
                            {getInitials(emp.fullName)}
                          </span>
                          <div className="rac-override-search-info">
                            <span className="rac-override-search-name">{emp.fullName}</span>
                            <span className="rac-override-search-meta">
                              {emp.department ? `${emp.department} · ` : ""}{emp.roles.join(", ")}
                            </span>
                          </div>
                        </button>
                      ))}
                      {filteredEmployees.length === 0 && overrideSearch.trim() ? (
                        <p className="rac-override-no-results">{t("noMatchingMembers")}</p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {/* Form actions */}
              <div className="rac-edit-actions">
                <button
                  type="button"
                  className="rac-save-btn"
                  onClick={() => { void saveOverride(); }}
                  disabled={overrideSaving || !overrideModule || overrideSelectedIds.size === 0}
                >
                  <NavIcon name="Check" size={14} />
                  {overrideSaving ? t("saving") : t("saveChanges")}
                </button>
                <button
                  type="button"
                  className="rac-cancel-btn"
                  onClick={resetAddForm}
                >
                  {tCommon("cancel")}
                </button>
              </div>
            </div>
          ) : null}

          {/* Existing overrides display */}
          {hasOverrides ? (
            <div className="rac-override-list">
              {renderOverrideGroup(
                "grant",
                grantsByModule,
                td("grantedSection"),
                td("grantedDescription"),
                "UserPlus",
                "rac-override-person-grant"
              )}
              {renderOverrideGroup(
                "revoke",
                revokesByModule,
                td("revokedSection"),
                td("revokedDescription"),
                "UserMinus",
                "rac-override-person-revoke"
              )}
            </div>
          ) : !addingOverride ? (
            <div className="rac-overrides-empty">
              <div className="rac-overrides-empty-icon">
                <NavIcon name="ShieldOff" size={28} />
              </div>
              <p className="rac-overrides-empty-title">{t("noOverrides")}</p>
              <p className="rac-overrides-empty-desc">
                {t("noOverridesDescription")}
              </p>
            </div>
          ) : null}
        </section>
      </div>
    </>
  );
}
