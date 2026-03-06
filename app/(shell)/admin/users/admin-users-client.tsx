"use client";

import { useEffect, useMemo, useState } from "react";

import { AccessChecklist, type AccessChecklistItem } from "../../../../components/admin/access-checklist";
import { InviteForm } from "../../../../components/admin/invite-form";
import { UserListTable } from "../../../../components/admin/user-list-table";
import { ErrorState } from "../../../../components/shared/error-state";
import { PageHeader } from "../../../../components/shared/page-header";
import { SlidePanel } from "../../../../components/shared/slide-panel";
import { usePeople } from "../../../../hooks/use-people";
import {
  getNavigationDefinitions,
  isNavItemVisibleForUser
} from "../../../../lib/access-control";
import {
  buildAccessOverridesFromSelected,
  resolveDefaultAccessForRoles
} from "../../../../lib/auth/default-role-access";
import { DEPARTMENTS } from "../../../../lib/departments";
import { USER_ROLES } from "../../../../lib/navigation";
import type { AppRole } from "../../../../types/auth";
import type {
  AdminAccessConfigResponse,
  NavigationAccessConfigRecord
} from "../../../../types/access-control";
import type {
  PeoplePasswordResetResponse,
  PeopleUpdateResponse,
  PersonRecord,
  ProfileStatus
} from "../../../../types/people";

type ActiveTab = "invite" | "users";

type AdminUsersClientProps = {
  currentUserId: string;
};

type EditValues = {
  id: string;
  fullName: string;
  roles: AppRole[];
  department: string;
  title: string;
  managerId: string;
  status: ProfileStatus;
  selectedAccessKeys: string[];
};

const roleLabels: Record<AppRole, string> = {
  EMPLOYEE: "Employee",
  TEAM_LEAD: "Team Lead",
  MANAGER: "Manager",
  HR_ADMIN: "HR Admin",
  FINANCE_ADMIN: "Finance Admin",
  SUPER_ADMIN: "Super Admin"
};

function copyToClipboard(value: string) {
  void navigator.clipboard?.writeText(value);
}

function fallbackAccessItems(): AccessChecklistItem[] {
  return getNavigationDefinitions()
    .filter((item) => item.key !== "/login")
    .map((item) => ({
      key: item.key,
      label: item.label,
      description: item.description,
      groupLabel: item.groupLabel
    }))
    .sort((left, right) => left.key.localeCompare(right.key));
}

function resolveEffectiveAccessKeysForPerson({
  person,
  navRows,
  accessItems
}: {
  person: PersonRecord;
  navRows: NavigationAccessConfigRecord[];
  accessItems: AccessChecklistItem[];
}): string[] {
  if (person.roles.includes("SUPER_ADMIN")) {
    return accessItems.map((item) => item.key);
  }

  const navRowByKey = new Map(navRows.map((row) => [row.navItemKey, row] as const));
  const fallbackDefault = new Set(resolveDefaultAccessForRoles(person.roles));

  return accessItems
    .map((item) => {
      const row = navRowByKey.get(item.key);

      if (!row) {
        return fallbackDefault.has(item.key) ? item.key : null;
      }

      const isVisible = isNavItemVisibleForUser({
        userId: person.id,
        userRoles: person.roles,
        visibleToRoles: row.visibleToRoles,
        grantedEmployeeIds: row.grantedEmployeeIds,
        revokedEmployeeIds: row.revokedEmployeeIds
      });

      return isVisible ? item.key : null;
    })
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => left.localeCompare(right));
}

export function AdminUsersClient({ currentUserId }: AdminUsersClientProps) {
  const [activeTab, setActiveTab] = useState<ActiveTab>("invite");
  const [accessItems, setAccessItems] = useState<AccessChecklistItem[]>(fallbackAccessItems);
  const [navRows, setNavRows] = useState<NavigationAccessConfigRecord[]>([]);
  const [isAccessLoading, setIsAccessLoading] = useState(true);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<EditValues | null>(null);
  const [editMessage, setEditMessage] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [isResettingPassword, setIsResettingPassword] = useState(false);
  const [resetPasswordValue, setResetPasswordValue] = useState<string | null>(null);

  const { people, isLoading, errorMessage, refresh, setPeople } = usePeople({
    scope: "all"
  });

  const managerOptions = useMemo(
    () =>
      people
        .filter((person) => person.id !== editValues?.id)
        .sort((left, right) => left.fullName.localeCompare(right.fullName)),
    [editValues?.id, people]
  );

  const openEditPanel = (person: PersonRecord) => {
    const selectedAccessKeys = resolveEffectiveAccessKeysForPerson({
      person,
      navRows,
      accessItems
    });

    setEditValues({
      id: person.id,
      fullName: person.fullName,
      roles: [...person.roles],
      department: person.department ?? "",
      title: person.title ?? "",
      managerId: person.managerId ?? "",
      status: person.status,
      selectedAccessKeys
    });
    setResetPasswordValue(null);
    setEditError(null);
    setEditMessage(null);
  };

  const closeEditPanel = () => {
    if (isSavingEdit || isResettingPassword) {
      return;
    }

    setEditValues(null);
    setResetPasswordValue(null);
    setEditError(null);
    setEditMessage(null);
  };

  const loadAccessConfig = async () => {
    setIsAccessLoading(true);
    setAccessError(null);

    try {
      const response = await fetch("/api/v1/admin/access-config", {
        method: "GET"
      });
      const payload = (await response.json()) as AdminAccessConfigResponse;

      if (!response.ok || !payload.data) {
        throw new Error(payload.error?.message ?? "Unable to load access config.");
      }

      setNavRows(payload.data.navigation);
      setAccessItems(
        payload.data.navDefinitions
          .filter((definition) => definition.key !== "/login")
          .map((definition) => ({
            key: definition.key,
            label: definition.label,
            description: definition.description,
            groupLabel: definition.groupLabel
          }))
      );
    } catch (error) {
      setAccessError(error instanceof Error ? error.message : "Unable to load access config.");
      setAccessItems(fallbackAccessItems());
      setNavRows([]);
    } finally {
      setIsAccessLoading(false);
    }
  };

  useEffect(() => {
    void loadAccessConfig();
  }, []);

  const handleCreated = (person: PersonRecord) => {
    setPeople((currentPeople) => {
      const withoutPerson = currentPeople.filter((row) => row.id !== person.id);
      return [person, ...withoutPerson];
    });
    void loadAccessConfig();
    refresh();
    setActiveTab("users");
  };

  const handleDeactivate = async (person: PersonRecord) => {
    const confirmed = window.confirm(
      `Deactivate ${person.fullName}? They will lose active access until reactivated.`
    );

    if (!confirmed) {
      return;
    }

    const response = await fetch(`/api/v1/people/${person.id}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        status: "inactive"
      })
    });

    const payload = (await response.json()) as PeopleUpdateResponse;

    if (!response.ok || !payload.data?.person) {
      setEditError(payload.error?.message ?? "Unable to deactivate user.");
      return;
    }

    const updatedPerson = payload.data.person;
    setPeople((currentPeople) =>
      currentPeople.map((row) => (row.id === person.id ? updatedPerson : row))
    );
    setEditMessage(`${updatedPerson.fullName} is now inactive.`);
  };

  const toggleEditRole = (role: AppRole, checked: boolean) => {
    if (!editValues || role === "EMPLOYEE") {
      return;
    }

    const nextRoles: AppRole[] = checked
      ? [...new Set(["EMPLOYEE", ...editValues.roles, role] as AppRole[])]
      : [...new Set(["EMPLOYEE", ...editValues.roles.filter((value) => value !== role)] as AppRole[])];

    setEditValues((currentValues) =>
      currentValues
        ? {
            ...currentValues,
            roles: nextRoles
          }
        : currentValues
    );
  };

  const toggleEditAccess = (navItemKey: string, checked: boolean) => {
    setEditValues((currentValues) => {
      if (!currentValues) {
        return currentValues;
      }

      const nextSet = new Set(currentValues.selectedAccessKeys);

      if (checked) {
        nextSet.add(navItemKey);
      } else {
        nextSet.delete(navItemKey);
      }

      return {
        ...currentValues,
        selectedAccessKeys: [...nextSet].sort((left, right) => left.localeCompare(right))
      };
    });
  };

  const handleSaveEdit = async () => {
    if (!editValues) {
      return;
    }

    setIsSavingEdit(true);
    setEditError(null);
    setEditMessage(null);

    try {
      const defaultAccess = resolveDefaultAccessForRoles(editValues.roles);
      const accessOverrides = buildAccessOverridesFromSelected({
        selectedNavItemKeys: editValues.selectedAccessKeys,
        defaultNavItemKeys: defaultAccess
      });

      const response = await fetch(`/api/v1/people/${editValues.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          fullName: editValues.fullName.trim(),
          roles: editValues.roles,
          department: editValues.department.trim() || null,
          title: editValues.title.trim() || null,
          managerId: editValues.managerId.trim() || null,
          status: editValues.status,
          accessOverrides
        })
      });

      const payload = (await response.json()) as PeopleUpdateResponse;

      if (!response.ok || !payload.data?.person) {
        setEditError(payload.error?.message ?? "Unable to update user.");
        return;
      }

      const updatedPerson = payload.data.person;
      setPeople((currentPeople) =>
        currentPeople.map((row) => (row.id === updatedPerson.id ? updatedPerson : row))
      );

      setEditMessage("User updated.");
      await loadAccessConfig();
    } catch (error) {
      setEditError(error instanceof Error ? error.message : "Unable to update user.");
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleResetPassword = async () => {
    if (!editValues) {
      return;
    }

    setIsResettingPassword(true);
    setEditError(null);
    setEditMessage(null);

    try {
      const response = await fetch(`/api/v1/people/${editValues.id}/reset-password`, {
        method: "POST"
      });
      const payload = (await response.json()) as PeoplePasswordResetResponse;

      if (!response.ok || !payload.data?.temporaryPassword) {
        setEditError(payload.error?.message ?? "Unable to reset password.");
        return;
      }

      setResetPasswordValue(payload.data.temporaryPassword);
      setEditMessage("Password reset complete. Share the temporary password securely.");
    } catch (error) {
      setEditError(error instanceof Error ? error.message : "Unable to reset password.");
    } finally {
      setIsResettingPassword(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Admin Users"
        description="Invite, configure, and manage employee accounts."
      />

      <div className="page-tabs" role="tablist" aria-label="Admin users tabs">
        <button
          type="button"
          className={activeTab === "invite" ? "page-tab page-tab-active" : "page-tab"}
          onClick={() => setActiveTab("invite")}
          role="tab"
          aria-selected={activeTab === "invite"}
        >
          Invite User
        </button>
        <button
          type="button"
          className={activeTab === "users" ? "page-tab page-tab-active" : "page-tab"}
          onClick={() => setActiveTab("users")}
          role="tab"
          aria-selected={activeTab === "users"}
        >
          User List
        </button>
      </div>

      {accessError ? <p className="form-submit-error">{accessError}</p> : null}

      {activeTab === "invite" ? (
        isLoading || isAccessLoading ? (
          <section className="settings-card">
            <p className="settings-card-description">Loading invite form...</p>
          </section>
        ) : (
          <InviteForm
            people={people}
            accessItems={accessItems}
            onCreated={handleCreated}
          />
        )
      ) : null}

      {activeTab === "users" ? (
        isLoading ? (
          <section className="settings-card">
            <p className="settings-card-description">Loading users...</p>
          </section>
        ) : errorMessage ? (
          <ErrorState
            title="Unable to load users"
            message={errorMessage}
            onRetry={refresh}
          />
        ) : (
          <UserListTable
            people={people}
            onEdit={openEditPanel}
            onDeactivate={handleDeactivate}
          />
        )
      ) : null}

      {editMessage ? <p className="settings-feedback">{editMessage}</p> : null}

      <SlidePanel
        isOpen={Boolean(editValues)}
        title="Edit User"
        description="Update role assignment, profile status, and tab access."
        onClose={closeEditPanel}
      >
        {editValues ? (
          <div className="slide-panel-form-wrapper">
            <label className="form-field" htmlFor="edit-user-name">
              <span className="form-label">Full name</span>
              <input
                id="edit-user-name"
                className="form-input"
                value={editValues.fullName}
                onChange={(event) =>
                  setEditValues((currentValues) =>
                    currentValues
                      ? { ...currentValues, fullName: event.currentTarget.value }
                      : currentValues
                  )
                }
              />
            </label>

            <fieldset className="form-field">
              <legend className="form-label">Roles</legend>
              <div className="admin-users-role-grid">
                {USER_ROLES.map((role) => (
                  <label key={role} className="settings-checkbox">
                    <input
                      type="checkbox"
                      checked={editValues.roles.includes(role)}
                      disabled={role === "EMPLOYEE" || role === "SUPER_ADMIN" && editValues.id === currentUserId}
                      onChange={(event) => toggleEditRole(role, event.currentTarget.checked)}
                    />
                    <span>{roleLabels[role]}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <label className="form-field" htmlFor="edit-user-department">
              <span className="form-label">Department</span>
              <select
                id="edit-user-department"
                className="form-input"
                value={editValues.department}
                onChange={(event) =>
                  setEditValues((currentValues) =>
                    currentValues
                      ? {
                          ...currentValues,
                          department: event.currentTarget.value
                        }
                      : currentValues
                  )
                }
              >
                <option value="">No department</option>
                {DEPARTMENTS.map((department) => (
                  <option key={department} value={department}>
                    {department}
                  </option>
                ))}
              </select>
            </label>

            <label className="form-field" htmlFor="edit-user-title">
              <span className="form-label">Title</span>
              <input
                id="edit-user-title"
                className="form-input"
                value={editValues.title}
                onChange={(event) =>
                  setEditValues((currentValues) =>
                    currentValues
                      ? { ...currentValues, title: event.currentTarget.value }
                      : currentValues
                  )
                }
              />
            </label>

            <label className="form-field" htmlFor="edit-user-manager">
              <span className="form-label">Manager</span>
              <select
                id="edit-user-manager"
                className="form-input"
                value={editValues.managerId}
                onChange={(event) =>
                  setEditValues((currentValues) =>
                    currentValues
                      ? { ...currentValues, managerId: event.currentTarget.value }
                      : currentValues
                  )
                }
              >
                <option value="">No manager</option>
                {managerOptions.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.fullName} ({person.department ?? ""})
                  </option>
                ))}
              </select>
            </label>

            <label className="form-field" htmlFor="edit-user-status">
              <span className="form-label">Status</span>
              <select
                id="edit-user-status"
                className="form-input"
                value={editValues.status}
                onChange={(event) =>
                  setEditValues((currentValues) =>
                    currentValues
                      ? {
                          ...currentValues,
                          status: event.currentTarget.value as ProfileStatus
                        }
                      : currentValues
                  )
                }
              >
                <option value="active">active</option>
                <option value="inactive">inactive</option>
                <option value="onboarding">onboarding</option>
                <option value="offboarding">offboarding</option>
              </select>
            </label>

            <AccessChecklist
              items={accessItems}
              selectedKeys={editValues.selectedAccessKeys}
              onToggle={toggleEditAccess}
            />

            <div className="settings-actions">
              <button
                type="button"
                className="button button-accent"
                onClick={handleSaveEdit}
                disabled={isSavingEdit}
              >
                {isSavingEdit ? "Saving..." : "Save changes"}
              </button>
              <button
                type="button"
                className="button button-ghost"
                onClick={handleResetPassword}
                disabled={isResettingPassword}
              >
                {isResettingPassword ? "Resetting..." : "Reset Password"}
              </button>
            </div>

            {resetPasswordValue ? (
              <div className="admin-users-password-box">
                <p className="form-label">Temporary password</p>
                <code className="admin-users-password-value">{resetPasswordValue}</code>
                <button
                  type="button"
                  className="table-row-action"
                  onClick={() => copyToClipboard(resetPasswordValue)}
                >
                  Copy password
                </button>
              </div>
            ) : null}

            {editError ? <p className="form-submit-error">{editError}</p> : null}
            {editMessage ? <p className="settings-feedback">{editMessage}</p> : null}
          </div>
        ) : null}
      </SlidePanel>
    </>
  );
}
