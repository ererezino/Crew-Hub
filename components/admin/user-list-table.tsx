"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { StatusBadge } from "../shared/status-badge";
import { formatDateTimeTooltip, formatRelativeTime } from "../../lib/datetime";
import { formatProfileStatus } from "../../lib/format-labels";
import { USER_ROLES } from "../../lib/navigation";
import type { AppRole } from "../../types/auth";
import type { PersonRecord } from "../../types/people";

type UserListTableProps = {
  people: PersonRecord[];
  onEdit: (person: PersonRecord) => void;
  onDeactivate: (person: PersonRecord) => void;
};

function getRoleLabel(role: AppRole, t: ReturnType<typeof useTranslations<"adminUsers">>): string {
  switch (role) {
    case "EMPLOYEE": return t("directory.roleEmployee");
    case "TEAM_LEAD": return t("directory.roleTeamLead");
    case "MANAGER": return t("directory.roleManager");
    case "HR_ADMIN": return t("directory.roleHrAdmin");
    case "FINANCE_ADMIN": return t("directory.roleFinanceAdmin");
    case "SUPER_ADMIN": return t("directory.roleSuperAdmin");
  }
}

function toneForProfileStatus(status: PersonRecord["status"]) {
  if (status === "active") return "success" as const;
  if (status === "onboarding") return "processing" as const;
  if (status === "offboarding") return "warning" as const;
  return "draft" as const;
}

export function UserListTable({
  people,
  onEdit,
  onDeactivate
}: UserListTableProps) {
  const t = useTranslations("adminUsers");
  const [searchQuery, setSearchQuery] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("all");
  const [roleFilter, setRoleFilter] = useState<"all" | AppRole>("all");

  const departmentOptions = useMemo(
    () =>
      [...new Set(people.map((person) => person.department).filter((department): department is string => Boolean(department)))]
        .sort((left, right) => left.localeCompare(right)),
    [people]
  );

  const filteredPeople = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    return people
      .filter((person) => {
        if (departmentFilter !== "all" && person.department !== departmentFilter) {
          return false;
        }

        if (roleFilter !== "all" && !person.roles.includes(roleFilter)) {
          return false;
        }

        if (!query) {
          return true;
        }

        const searchable = `${person.fullName} ${person.email} ${person.department ?? ""}`.toLowerCase();
        return searchable.includes(query);
      })
      .sort((left, right) => left.fullName.localeCompare(right.fullName));
  }, [departmentFilter, people, roleFilter, searchQuery]);

  return (
    <section className="settings-card">
      <div>
        <h3 className="section-title">{t('directory.title')}</h3>
        <p className="settings-card-description">
          {t('directory.description')}
        </p>
      </div>

      <div className="admin-users-filters">
        <label className="form-field" htmlFor="admin-users-search">
          <span className="form-label">{t('directory.searchLabel')}</span>
          <input
            id="admin-users-search"
            className="form-input"
            placeholder={t('directory.searchPlaceholder')}
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.currentTarget.value)}
          />
        </label>

        <label className="form-field" htmlFor="admin-users-filter-department">
          <span className="form-label">{t('directory.departmentLabel')}</span>
          <select
            id="admin-users-filter-department"
            className="form-input"
            value={departmentFilter}
            onChange={(event) => setDepartmentFilter(event.currentTarget.value)}
          >
            <option value="all">{t('directory.allDepartments')}</option>
            {departmentOptions.map((department) => (
              <option key={department} value={department}>
                {department}
              </option>
            ))}
          </select>
        </label>

        <label className="form-field" htmlFor="admin-users-filter-role">
          <span className="form-label">{t('directory.roleLabel')}</span>
          <select
            id="admin-users-filter-role"
            className="form-input"
            value={roleFilter}
            onChange={(event) => setRoleFilter(event.currentTarget.value as "all" | AppRole)}
          >
            <option value="all">{t('directory.allRoles')}</option>
            {USER_ROLES.map((role) => (
              <option key={role} value={role}>
                {getRoleLabel(role, t)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="data-table-container">
        <table className="data-table" aria-label={t('directory.tableAriaLabel')}>
          <thead>
            <tr>
              <th>{t('directory.colName')}</th>
              <th>{t('directory.colEmail')}</th>
              <th>{t('directory.colDepartment')}</th>
              <th>{t('directory.colRoles')}</th>
              <th>{t('directory.colStatus')}</th>
              <th>{t('directory.colCreated')}</th>
              <th className="table-action-column">{t('directory.colActions')}</th>
            </tr>
          </thead>
          <tbody>
            {filteredPeople.length === 0 ? (
              <tr className="data-table-row">
                <td colSpan={7}>{t('directory.noResults')}</td>
              </tr>
            ) : (
              filteredPeople.map((person) => (
                <tr key={person.id} className="data-table-row">
                  <td>{person.fullName}</td>
                  <td>{person.email}</td>
                  <td>{person.department ?? "--"}</td>
                  <td>
                    <div className="people-role-badges">
                      {person.roles.map((role) => (
                        <StatusBadge key={`${person.id}-${role}`} tone="info">
                          {getRoleLabel(role, t)}
                        </StatusBadge>
                      ))}
                    </div>
                  </td>
                  <td>
                    <StatusBadge tone={toneForProfileStatus(person.status)}>
                      {formatProfileStatus(person.status)}
                    </StatusBadge>
                  </td>
                  <td>
                    <time
                      dateTime={person.createdAt}
                      title={formatDateTimeTooltip(person.createdAt)}
                    >
                      {formatRelativeTime(person.createdAt)}
                    </time>
                  </td>
                  <td className="table-row-action-cell">
                    <div className="admin-users-row-actions">
                      <button
                        type="button"
                        className="table-row-action"
                        onClick={() => onEdit(person)}
                      >
                        {t('directory.edit')}
                      </button>
                      {person.status !== "inactive" ? (
                        <button
                          type="button"
                          className="table-row-action"
                          onClick={() => onDeactivate(person)}
                        >
                          {t('directory.deactivate')}
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
