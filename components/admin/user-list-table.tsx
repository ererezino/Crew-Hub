"use client";

import { useMemo, useState } from "react";

import { getRoleLabel } from "../../lib/access-control";
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
        <h3 className="section-title">User Directory</h3>
        <p className="settings-card-description">
          Search and manage all users in your organization.
        </p>
      </div>

      <div className="admin-users-filters">
        <label className="form-field" htmlFor="admin-users-search">
          <span className="form-label">Search</span>
          <input
            id="admin-users-search"
            className="form-input"
            placeholder="Search by name or email"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.currentTarget.value)}
          />
        </label>

        <label className="form-field" htmlFor="admin-users-filter-department">
          <span className="form-label">Department</span>
          <select
            id="admin-users-filter-department"
            className="form-input"
            value={departmentFilter}
            onChange={(event) => setDepartmentFilter(event.currentTarget.value)}
          >
            <option value="all">All departments</option>
            {departmentOptions.map((department) => (
              <option key={department} value={department}>
                {department}
              </option>
            ))}
          </select>
        </label>

        <label className="form-field" htmlFor="admin-users-filter-role">
          <span className="form-label">Role</span>
          <select
            id="admin-users-filter-role"
            className="form-input"
            value={roleFilter}
            onChange={(event) => setRoleFilter(event.currentTarget.value as "all" | AppRole)}
          >
            <option value="all">All roles</option>
            {USER_ROLES.map((role) => (
              <option key={role} value={role}>
                {getRoleLabel(role)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="data-table-container">
        <table className="data-table" aria-label="Admin users table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Department</th>
              <th>Role(s)</th>
              <th>Status</th>
              <th>Created</th>
              <th className="table-action-column">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredPeople.length === 0 ? (
              <tr className="data-table-row">
                <td colSpan={7}>No users matched your filters.</td>
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
                          {getRoleLabel(role)}
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
                        Edit
                      </button>
                      {person.status !== "inactive" ? (
                        <button
                          type="button"
                          className="table-row-action"
                          onClick={() => onDeactivate(person)}
                        >
                          Deactivate
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
