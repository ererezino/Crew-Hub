"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { AccessChecklist, type AccessChecklistItem } from "../../../../components/admin/access-checklist";
import { InviteForm } from "../../../../components/admin/invite-form";
import { UserListTable } from "../../../../components/admin/user-list-table";
import { ConfirmDialog } from "../../../../components/shared/confirm-dialog";
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
  const t = useTranslations('adminUsers');
  const tCommon = useTranslations('common');
  const td = tCommon as (key: string, params?: Record<string, unknown>) => string;

  const [activeTab, setActiveTab] = useState<ActiveTab>("invite");
  const [accessItems, setAccessItems] = useState<AccessChecklistItem[]>(fallbackAccessItems);
  const [navRows, setNavRows] = useState<NavigationAccessConfigRecord[]>([]);
  const [isAccessLoading, setIsAccessLoading] = useState(true);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<EditValues | null>(null);
  const [editMessage, setEditMessage] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [isResettingAuthenticator, setIsResettingAuthenticator] = useState(false);

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
    setEditError(null);
    setEditMessage(null);
  };

  const closeEditPanel = () => {
    if (isSavingEdit || isResettingAuthenticator) {
      return;
    }

    setEditValues(null);
    setEditError(null);
    setEditMessage(null);
  };

  const loadAccessConfig = useCallback(async () => {
    setIsAccessLoading(true);
    setAccessError(null);

    try {
      const response = await fetch("/api/v1/admin/access-config", {
        method: "GET"
      });
      const payload = (await response.json()) as AdminAccessConfigResponse;

      if (!response.ok || !payload.data) {
        throw new Error(payload.error?.message ?? t('errorAccessConfig'));
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
      setAccessError(error instanceof Error ? error.message : t('errorAccessConfig'));
      setAccessItems(fallbackAccessItems());
      setNavRows([]);
    } finally {
      setIsAccessLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- t is a stable ref from useTranslations
  }, []);

  useEffect(() => {
    void loadAccessConfig();
  }, [loadAccessConfig]);

  const handleCreated = (person: PersonRecord) => {
    setPeople((currentPeople) => {
      const withoutPerson = currentPeople.filter((row) => row.id !== person.id);
      return [person, ...withoutPerson];
    });
    void loadAccessConfig();
    refresh();
    setActiveTab("users");
  };

  const [deactivateTarget, setDeactivateTarget] = useState<PersonRecord | null>(null);

  const handleDeactivate = (person: PersonRecord) => {
    setDeactivateTarget(person);
  };

  const executeDeactivate = async () => {
    if (!deactivateTarget) return;

    const person = deactivateTarget;
    setDeactivateTarget(null);

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
      setEditError(payload.error?.message ?? t('errorDeactivate'));
      return;
    }

    const updatedPerson = payload.data.person;
    setPeople((currentPeople) =>
      currentPeople.map((row) => (row.id === person.id ? updatedPerson : row))
    );
    setEditMessage(t('deactivatedMessage', { name: updatedPerson.fullName }));
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
        setEditError(payload.error?.message ?? t('errorUpdate'));
        return;
      }

      const updatedPerson = payload.data.person;
      setPeople((currentPeople) =>
        currentPeople.map((row) => (row.id === updatedPerson.id ? updatedPerson : row))
      );

      setEditMessage(t('userUpdated'));
      await loadAccessConfig();
    } catch (error) {
      setEditError(error instanceof Error ? error.message : t('errorUpdate'));
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleResetAuthenticator = async () => {
    if (!editValues) {
      return;
    }

    setIsResettingAuthenticator(true);
    setEditError(null);
    setEditMessage(null);

    try {
      const response = await fetch(`/api/v1/people/${editValues.id}/reset-password`, {
        method: "POST"
      });
      const payload = (await response.json()) as PeoplePasswordResetResponse;

      if (!response.ok || !payload.data?.resetInitiated) {
        setEditError(payload.error?.message ?? t('errorResetAuth'));
        return;
      }

      setEditMessage(t('authenticatorResetMessage'));
    } catch (error) {
      setEditError(error instanceof Error ? error.message : t('errorResetAuth'));
    } finally {
      setIsResettingAuthenticator(false);
    }
  };

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('description')}
      />

      <div className="page-tabs" role="tablist" aria-label={t('tabsAriaLabel')}>
        <button
          type="button"
          className={activeTab === "invite" ? "page-tab page-tab-active" : "page-tab"}
          onClick={() => setActiveTab("invite")}
          role="tab"
          aria-selected={activeTab === "invite"}
        >
          {t('tabInvite')}
        </button>
        <button
          type="button"
          className={activeTab === "users" ? "page-tab page-tab-active" : "page-tab"}
          onClick={() => setActiveTab("users")}
          role="tab"
          aria-selected={activeTab === "users"}
        >
          {t('tabUsers')}
        </button>
      </div>

      {accessError ? <p className="form-submit-error">{accessError}</p> : null}

      {activeTab === "invite" ? (
        isLoading || isAccessLoading ? (
          <section className="settings-card">
            <p className="settings-card-description">{t('loadingInvite')}</p>
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
            <p className="settings-card-description">{t('loadingUsers')}</p>
          </section>
        ) : errorMessage ? (
          <ErrorState
            title={t('errorLoadUsers')}
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
        title={t('editTitle')}
        description={t('editDescription')}
        onClose={closeEditPanel}
      >
        {editValues ? (
          <div className="slide-panel-form-wrapper">
            <label className="form-field" htmlFor="edit-user-name">
              <span className="form-label">{t('fullNameLabel')}</span>
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
              <legend className="form-label">{t('rolesLabel')}</legend>
              <div className="admin-users-role-grid">
                {USER_ROLES.map((role) => (
                  <label key={role} className="settings-checkbox">
                    <input
                      type="checkbox"
                      checked={editValues.roles.includes(role)}
                      disabled={role === "EMPLOYEE" || role === "SUPER_ADMIN" && editValues.id === currentUserId}
                      onChange={(event) => toggleEditRole(role, event.currentTarget.checked)}
                    />
                    <span>{td('role.' + role)}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <label className="form-field" htmlFor="edit-user-department">
              <span className="form-label">{t('departmentLabel')}</span>
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
                <option value="">{t('noDepartment')}</option>
                {DEPARTMENTS.map((department) => (
                  <option key={department} value={department}>
                    {department}
                  </option>
                ))}
              </select>
            </label>

            <label className="form-field" htmlFor="edit-user-title">
              <span className="form-label">{t('titleLabel')}</span>
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
              <span className="form-label">{t('managerLabel')}</span>
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
                <option value="">{t('noManager')}</option>
                {managerOptions.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.fullName} ({person.department ?? ""})
                  </option>
                ))}
              </select>
            </label>

            <label className="form-field" htmlFor="edit-user-status">
              <span className="form-label">{t('statusLabel')}</span>
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
                <option value="active">{t('statusActive')}</option>
                <option value="inactive">{t('statusInactive')}</option>
                <option value="onboarding">{t('statusOnboarding')}</option>
                <option value="offboarding">{t('statusOffboarding')}</option>
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
                {isSavingEdit ? t('saving') : t('saveChanges')}
              </button>
              <button
                type="button"
                className="button button-ghost"
                onClick={handleResetAuthenticator}
                disabled={isResettingAuthenticator}
              >
                {isResettingAuthenticator ? t('resetting') : t('resetAuthenticator')}
              </button>
            </div>

            {editError ? <p className="form-submit-error">{editError}</p> : null}
            {editMessage ? <p className="settings-feedback">{editMessage}</p> : null}
          </div>
        ) : null}
      </SlidePanel>

      <ConfirmDialog
        isOpen={deactivateTarget !== null}
        title={t('deactivateTitle', { name: deactivateTarget?.fullName ?? "" })}
        description={t('deactivateDescription')}
        confirmLabel={t('deactivateConfirmLabel')}
        tone="danger"
        onConfirm={() => void executeDeactivate()}
        onCancel={() => setDeactivateTarget(null)}
      />
    </>
  );
}
