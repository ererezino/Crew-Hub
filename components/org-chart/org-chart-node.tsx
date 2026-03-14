"use client";

import Image from "next/image";
import type { OrgChartPerson } from "../../lib/org-chart/types";

type OrgChartNodeProps = {
  person: OrgChartPerson;
  isSelected: boolean;
  onSelect: (personId: string) => void;
  directReportCount: number;
};

function getInitials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

function formatRoleLabel(role: string): string | null {
  switch (role) {
    case "SUPER_ADMIN":
      return "Super Admin";
    case "HR_ADMIN":
      return "HR Admin";
    case "FINANCE_ADMIN":
      return "Finance";
    case "MANAGER":
      return "Manager";
    case "TEAM_LEAD":
      return "Team Lead";
    default:
      return null;
  }
}

function getPrimaryRoleLabel(roles: string[]): string | null {
  // Show the highest-privilege non-EMPLOYEE role
  const roleOrder = ["SUPER_ADMIN", "HR_ADMIN", "FINANCE_ADMIN", "MANAGER", "TEAM_LEAD"];
  for (const role of roleOrder) {
    if (roles.includes(role)) {
      return formatRoleLabel(role);
    }
  }
  return null;
}

export function OrgChartNode({ person, isSelected, onSelect, directReportCount }: OrgChartNodeProps) {
  const roleLabel = getPrimaryRoleLabel(person.roles);
  const isInactive = person.status === "inactive" || person.status === "offboarding";

  return (
    <button
      type="button"
      onClick={() => onSelect(person.id)}
      className={[
        "org-chart-node",
        isSelected ? "org-chart-node-selected" : "",
        isInactive ? "org-chart-node-inactive" : ""
      ]
        .filter(Boolean)
        .join(" ")}
      aria-label={`${person.fullName}${roleLabel ? `, ${roleLabel}` : ""}`}
    >
      <div className="org-chart-node-avatar">
        {person.avatarUrl ? (
          <Image
            src={person.avatarUrl}
            alt=""
            width={36}
            height={36}
            className="org-chart-node-avatar-img"
          />
        ) : (
          <span className="org-chart-node-avatar-initials">{getInitials(person.fullName)}</span>
        )}
      </div>

      <div className="org-chart-node-info">
        <span className="org-chart-node-name">{person.fullName}</span>
        {person.title ? (
          <span className="org-chart-node-title">{person.title}</span>
        ) : null}
      </div>

      <div className="org-chart-node-meta">
        {person.department ? (
          <span className="org-chart-node-dept">{person.department}</span>
        ) : null}
        {roleLabel ? (
          <span className="org-chart-node-role">{roleLabel}</span>
        ) : null}
      </div>

      {directReportCount > 0 ? (
        <span className="org-chart-node-reports" aria-label={`${directReportCount} direct reports`}>
          {directReportCount}
        </span>
      ) : null}
    </button>
  );
}
