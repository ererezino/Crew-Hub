/**
 * Shared display label formatting for enums, statuses, and roles.
 * Every raw enum value shown to a user must go through one of these functions.
 */

/* ─── Roles ─── */

const ROLE_LABELS: Record<string, string> = {
  EMPLOYEE: "Employee",
  TEAM_LEAD: "Team lead",
  MANAGER: "Manager",
  HR_ADMIN: "HR admin",
  FINANCE_ADMIN: "Finance admin",
  SUPER_ADMIN: "Super admin"
};

export function formatRoleLabel(role: string): string {
  return ROLE_LABELS[role] ?? toSentenceCase(role);
}

/* ─── Employment type ─── */

const EMPLOYMENT_TYPE_LABELS: Record<string, string> = {
  full_time: "Full time",
  part_time: "Part time",
  contractor: "Contractor"
};

export function formatEmploymentType(type: string): string {
  return EMPLOYMENT_TYPE_LABELS[type] ?? toSentenceCase(type);
}

/* ─── Profile status ─── */

const PROFILE_STATUS_LABELS: Record<string, string> = {
  active: "Active",
  inactive: "Inactive",
  onboarding: "Onboarding",
  offboarding: "Offboarding",
  suspended: "Suspended",
  terminated: "Terminated"
};

export function formatProfileStatus(status: string): string {
  return PROFILE_STATUS_LABELS[status] ?? toSentenceCase(status);
}

/* ─── Leave request status ─── */

const LEAVE_STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  cancelled: "Cancelled"
};

export function formatLeaveStatus(status: string): string {
  return LEAVE_STATUS_LABELS[status] ?? toSentenceCase(status);
}

/* ─── Shift / schedule / swap statuses ─── */

const SHIFT_STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  published: "Published",
  locked: "Locked",
  open: "Open",
  assigned: "Assigned",
  cancelled: "Cancelled",
  pending: "Pending",
  accepted: "Accepted",
  rejected: "Rejected",
  completed: "Completed"
};

export function formatShiftStatus(status: string): string {
  return SHIFT_STATUS_LABELS[status] ?? toSentenceCase(status);
}

export function formatScheduleStatus(status: string): string {
  return SHIFT_STATUS_LABELS[status] ?? toSentenceCase(status);
}

export function formatSwapStatus(status: string): string {
  return SHIFT_STATUS_LABELS[status] ?? toSentenceCase(status);
}

/* ─── Generic sentence case utility ─── */

/**
 * Converts SCREAMING_SNAKE_CASE or snake_case to "Sentence case".
 * Used as a fallback when no explicit label mapping exists.
 */
export function toSentenceCase(value: string): string {
  return value
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/^\w/, (c) => c.toUpperCase());
}
