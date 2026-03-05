"use client";

import { useEffect, useMemo, useState } from "react";

import { EmptyState } from "../../../../components/shared/empty-state";
import { PageHeader } from "../../../../components/shared/page-header";
import { StatusBadge } from "../../../../components/shared/status-badge";
import { getRoleLabel } from "../../../../lib/access-control";
import { USER_ROLES, type UserRole } from "../../../../lib/navigation";
import type { ApiResponse } from "../../../../types/auth";
import type {
  AccessConfigUpdatePayload,
  AdminAccessConfigResponseData,
  AdminAccessConfigResponse,
  DashboardWidgetConfigRecord,
  NavigationAccessConfigRecord
} from "../../../../types/access-control";

type ActiveTab = "navigation" | "widgets";
type SaveState = "idle" | "success" | "error";

function accessControlSkeleton() {
  return (
    <div className="table-skeleton" aria-hidden="true">
      <div className="table-skeleton-header" />
      {Array.from({ length: 8 }, (_, index) => (
        <div key={`access-control-skeleton-${index}`} className="table-skeleton-row" />
      ))}
    </div>
  );
}

function sortRoles(values: readonly UserRole[]): UserRole[] {
  const roleOrder = new Map(USER_ROLES.map((role, index) => [role, index] as const));
  return [...values].sort((left, right) => (roleOrder.get(left) ?? 0) - (roleOrder.get(right) ?? 0));
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

async function fetchAccessConfig(): Promise<AdminAccessConfigResponseData> {
  const response = await fetch("/api/v1/admin/access-config", {
    method: "GET"
  });

  const payload = (await response.json()) as AdminAccessConfigResponse;

  if (!response.ok || !payload.data) {
    throw new Error(payload.error?.message ?? "Unable to load access control configuration.");
  }

  return payload.data;
}

async function persistAccessConfig(payload: AccessConfigUpdatePayload): Promise<AdminAccessConfigResponseData> {
  const response = await fetch("/api/v1/admin/access-config", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const body = (await response.json()) as ApiResponse<AdminAccessConfigResponseData>;

  if (!response.ok || !body.data) {
    throw new Error(body.error?.message ?? "Unable to save access control configuration.");
  }

  return body.data;
}

export function AccessControlAdminClient() {
  const [activeTab, setActiveTab] = useState<ActiveTab>("navigation");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [data, setData] = useState<AdminAccessConfigResponseData | null>(null);
  const [navigationRows, setNavigationRows] = useState<NavigationAccessConfigRecord[]>([]);
  const [widgetRows, setWidgetRows] = useState<DashboardWidgetConfigRecord[]>([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>("");
  const [employeeSearch, setEmployeeSearch] = useState("");

  useEffect(() => {
    let isMounted = true;

    const load = async () => {
      setIsLoading(true);
      setErrorMessage(null);

      try {
        const responseData = await fetchAccessConfig();

        if (!isMounted) {
          return;
        }

        setData(responseData);
        setNavigationRows(responseData.navigation);
        setWidgetRows(responseData.widgets);
      } catch (error) {
        if (!isMounted) {
          return;
        }

        setErrorMessage(error instanceof Error ? error.message : "Unable to load access control configuration.");
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    void load();

    return () => {
      isMounted = false;
    };
  }, []);

  const navRowByKey = useMemo(
    () => new Map(navigationRows.map((row) => [row.navItemKey, row] as const)),
    [navigationRows]
  );

  const widgetRowByKey = useMemo(
    () => new Map(widgetRows.map((row) => [row.widgetKey, row] as const)),
    [widgetRows]
  );

  const filteredEmployees = useMemo(() => {
    const rows = data?.employees ?? [];
    const query = employeeSearch.trim().toLowerCase();

    if (!query) {
      return rows;
    }

    return rows.filter((row) => {
      const haystack = `${row.fullName} ${row.email} ${row.department ?? ""}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [data?.employees, employeeSearch]);

  const selectedEmployee = useMemo(
    () => data?.employees.find((employee) => employee.id === selectedEmployeeId) ?? null,
    [data?.employees, selectedEmployeeId]
  );

  const toggleNavRole = (navItemKey: string, role: UserRole) => {
    setNavigationRows((currentRows) =>
      currentRows.map((row) => {
        if (row.navItemKey !== navItemKey) {
          return row;
        }

        const nextRoles = row.visibleToRoles.includes(role)
          ? row.visibleToRoles.filter((existingRole) => existingRole !== role)
          : [...row.visibleToRoles, role];

        if (nextRoles.length === 0) {
          return row;
        }

        return {
          ...row,
          visibleToRoles: sortRoles(nextRoles)
        };
      })
    );
  };

  const toggleWidgetRole = (widgetKey: DashboardWidgetConfigRecord["widgetKey"], role: UserRole) => {
    setWidgetRows((currentRows) =>
      currentRows.map((row) => {
        if (row.widgetKey !== widgetKey) {
          return row;
        }

        const nextRoles = row.visibleToRoles.includes(role)
          ? row.visibleToRoles.filter((existingRole) => existingRole !== role)
          : [...row.visibleToRoles, role];

        if (nextRoles.length === 0) {
          return row;
        }

        return {
          ...row,
          visibleToRoles: sortRoles(nextRoles)
        };
      })
    );
  };

  const toggleEmployeeOverride = ({
    navItemKey,
    mode,
    checked
  }: {
    navItemKey: string;
    mode: "grant" | "revoke";
    checked: boolean;
  }) => {
    if (!selectedEmployeeId) {
      return;
    }

    setNavigationRows((currentRows) =>
      currentRows.map((row) => {
        if (row.navItemKey !== navItemKey) {
          return row;
        }

        const granted = new Set(row.grantedEmployeeIds);
        const revoked = new Set(row.revokedEmployeeIds);

        if (mode === "grant") {
          if (checked) {
            granted.add(selectedEmployeeId);
            revoked.delete(selectedEmployeeId);
          } else {
            granted.delete(selectedEmployeeId);
          }
        }

        if (mode === "revoke") {
          if (checked) {
            revoked.add(selectedEmployeeId);
            granted.delete(selectedEmployeeId);
          } else {
            revoked.delete(selectedEmployeeId);
          }
        }

        return {
          ...row,
          grantedEmployeeIds: uniqueStrings([...granted]),
          revokedEmployeeIds: uniqueStrings([...revoked])
        };
      })
    );
  };

  const handleSave = async () => {
    setIsSaving(true);
    setSaveState("idle");

    try {
      const responseData = await persistAccessConfig({
        navigation: navigationRows.map((row) => ({
          navItemKey: row.navItemKey,
          visibleToRoles: row.visibleToRoles,
          grantedEmployeeIds: row.grantedEmployeeIds,
          revokedEmployeeIds: row.revokedEmployeeIds
        })),
        widgets: widgetRows.map((row) => ({
          widgetKey: row.widgetKey,
          visibleToRoles: row.visibleToRoles
        }))
      });

      setData(responseData);
      setNavigationRows(responseData.navigation);
      setWidgetRows(responseData.widgets);
      setSaveState("success");
    } catch (error) {
      setSaveState("error");
      setErrorMessage(error instanceof Error ? error.message : "Unable to save access control configuration.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Access Control"
        description="Control sidebar visibility and dashboard widgets per role with optional per-employee overrides."
      />

      <section className="settings-card">
        <div className="settings-card-header">
          <div>
            <h2 className="section-title">Rules</h2>
            <p className="settings-card-description">
              Super Admin always has full access and cannot be locked out by configuration.
            </p>
          </div>
          <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center" }}>
            {saveState === "success" ? <StatusBadge tone="success">Saved</StatusBadge> : null}
            {saveState === "error" ? <StatusBadge tone="error">Save failed</StatusBadge> : null}
            <button type="button" className="button button-accent" onClick={handleSave} disabled={isSaving || isLoading}>
              {isSaving ? "Saving..." : "Save access rules"}
            </button>
          </div>
        </div>
      </section>

      <section className="settings-card">
        <div className="page-tabs" role="tablist" aria-label="Access control tabs">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "navigation"}
            className={activeTab === "navigation" ? "button button-accent" : "button"}
            onClick={() => setActiveTab("navigation")}
          >
            Navigation Access
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "widgets"}
            className={activeTab === "widgets" ? "button button-accent" : "button"}
            onClick={() => setActiveTab("widgets")}
          >
            Dashboard Widgets
          </button>
        </div>
      </section>

      {isLoading ? accessControlSkeleton() : null}

      {!isLoading && errorMessage ? (
        <section className="error-state">
          <EmptyState
            title="Access control is unavailable"
            description={errorMessage}
            ctaLabel="Back to dashboard"
            ctaHref="/dashboard"
          />
        </section>
      ) : null}

      {!isLoading && !errorMessage && data && activeTab === "navigation" ? (
        <>
          <section className="settings-card" aria-label="Navigation access matrix">
            <div className="settings-card-header">
              <div>
                <h2 className="section-title">Navigation by Role</h2>
                <p className="settings-card-description">
                  Enable or disable each sidebar destination by role.
                </p>
              </div>
            </div>

            <div className="data-table-container">
              <table className="data-table" aria-label="Navigation access matrix">
                <thead>
                  <tr>
                    <th>Navigation Item</th>
                    {USER_ROLES.map((role) => (
                      <th key={`nav-role-${role}`}>{getRoleLabel(role)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.navDefinitions.map((definition) => {
                    const row = navRowByKey.get(definition.key);

                    if (!row) {
                      return null;
                    }

                    return (
                      <tr key={definition.key} className="data-table-row">
                        <td>
                          <div className="documents-cell-copy">
                            <p className="documents-cell-title">{definition.label}</p>
                            <p className="documents-cell-description">{definition.groupLabel} • {definition.key}</p>
                          </div>
                        </td>
                        {USER_ROLES.map((role) => {
                          const isChecked = row.visibleToRoles.includes(role);

                          return (
                            <td key={`${definition.key}-${role}`}>
                              <label className="settings-checkbox" style={{ justifyContent: "center" }}>
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={() => toggleNavRole(definition.key, role)}
                                />
                                <span className="sr-only">Toggle {definition.label} for {role}</span>
                              </label>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section className="settings-card" aria-label="Employee override settings">
            <div className="settings-card-header">
              <div>
                <h2 className="section-title">Per-Employee Overrides</h2>
                <p className="settings-card-description">
                  Select an employee to grant or revoke specific navigation items.
                </p>
              </div>
            </div>

            <div className="settings-grid settings-grid-two">
              <label className="settings-field">
                <span className="settings-label">Search employee</span>
                <input
                  className="input"
                  value={employeeSearch}
                  onChange={(event) => setEmployeeSearch(event.target.value)}
                  placeholder="Type name, email, or department"
                />
              </label>
              <label className="settings-field">
                <span className="settings-label">Employee</span>
                <select
                  className="input"
                  value={selectedEmployeeId}
                  onChange={(event) => setSelectedEmployeeId(event.target.value)}
                >
                  <option value="">Select employee</option>
                  {filteredEmployees.map((employee) => (
                    <option key={employee.id} value={employee.id}>
                      {employee.fullName} ({employee.email})
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {selectedEmployee ? (
              <>
                <p className="settings-card-description">
                  Editing overrides for <strong>{selectedEmployee.fullName}</strong>
                </p>
                <div className="data-table-container">
                  <table className="data-table" aria-label="Employee navigation overrides">
                    <thead>
                      <tr>
                        <th>Navigation Item</th>
                        <th>Grant</th>
                        <th>Revoke</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.navDefinitions.map((definition) => {
                        const row = navRowByKey.get(definition.key);

                        if (!row) {
                          return null;
                        }

                        const grantChecked = row.grantedEmployeeIds.includes(selectedEmployee.id);
                        const revokeChecked = row.revokedEmployeeIds.includes(selectedEmployee.id);

                        return (
                          <tr key={`override-${definition.key}`} className="data-table-row">
                            <td>
                              <div className="documents-cell-copy">
                                <p className="documents-cell-title">{definition.label}</p>
                                <p className="documents-cell-description">{definition.key}</p>
                              </div>
                            </td>
                            <td>
                              <label className="settings-checkbox" style={{ justifyContent: "center" }}>
                                <input
                                  type="checkbox"
                                  checked={grantChecked}
                                  onChange={(event) =>
                                    toggleEmployeeOverride({
                                      navItemKey: definition.key,
                                      mode: "grant",
                                      checked: event.currentTarget.checked
                                    })
                                  }
                                />
                                <span className="sr-only">Grant {definition.label}</span>
                              </label>
                            </td>
                            <td>
                              <label className="settings-checkbox" style={{ justifyContent: "center" }}>
                                <input
                                  type="checkbox"
                                  checked={revokeChecked}
                                  onChange={(event) =>
                                    toggleEmployeeOverride({
                                      navItemKey: definition.key,
                                      mode: "revoke",
                                      checked: event.currentTarget.checked
                                    })
                                  }
                                />
                                <span className="sr-only">Revoke {definition.label}</span>
                              </label>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <EmptyState
                title="Select an employee"
                description="Choose an employee above to edit grant/revoke overrides for navigation items."
                ctaLabel="Open people"
                ctaHref="/people"
              />
            )}
          </section>
        </>
      ) : null}

      {!isLoading && !errorMessage && data && activeTab === "widgets" ? (
        <section className="settings-card" aria-label="Dashboard widget matrix">
          <div className="settings-card-header">
            <div>
              <h2 className="section-title">Dashboard Widgets by Role</h2>
              <p className="settings-card-description">
                Control which dashboard sections each role can view.
              </p>
            </div>
          </div>

          <div className="data-table-container">
            <table className="data-table" aria-label="Widget access matrix">
              <thead>
                <tr>
                  <th>Widget</th>
                  {USER_ROLES.map((role) => (
                    <th key={`widget-role-${role}`}>{getRoleLabel(role)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.widgetDefinitions.map((definition) => {
                  const row = widgetRowByKey.get(definition.key);

                  if (!row) {
                    return null;
                  }

                  return (
                    <tr key={definition.key} className="data-table-row">
                      <td>
                        <div className="documents-cell-copy">
                          <p className="documents-cell-title">{definition.label}</p>
                          <p className="documents-cell-description">{definition.description}</p>
                        </div>
                      </td>
                      {USER_ROLES.map((role) => {
                        const isChecked = row.visibleToRoles.includes(role);

                        return (
                          <td key={`${definition.key}-${role}`}>
                            <label className="settings-checkbox" style={{ justifyContent: "center" }}>
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => toggleWidgetRole(definition.key, role)}
                              />
                              <span className="sr-only">Toggle {definition.label} for {role}</span>
                            </label>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </>
  );
}
