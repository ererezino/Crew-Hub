import type { UserRole } from "./navigation";
import type { LearningAssignmentStatus } from "../types/learning";

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

export function parseInteger(value: number | string): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
}

export function parseDecimal(value: number | string): number {
  const parsed = typeof value === "number" ? value : Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function isIsoDate(value: string): boolean {
  return isoDatePattern.test(value);
}

export function normalizeCourseCategory(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

export function normalizeNullableString(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

export function isLearningAdmin(userRoles: readonly UserRole[]): boolean {
  return userRoles.includes("HR_ADMIN") || userRoles.includes("SUPER_ADMIN");
}

export function canViewLearningReports(userRoles: readonly UserRole[]): boolean {
  return isLearningAdmin(userRoles);
}

export function canManageLearningAssignments(userRoles: readonly UserRole[]): boolean {
  return isLearningAdmin(userRoles);
}

export function determineAssignmentStatus({
  status,
  dueDate,
  completedAt
}: {
  status: LearningAssignmentStatus;
  dueDate: string | null;
  completedAt: string | null;
}): LearningAssignmentStatus {
  if (completedAt) {
    return "completed";
  }

  if (status === "failed") {
    return "failed";
  }

  if (!dueDate || !isIsoDate(dueDate)) {
    return status;
  }

  const dueDateTime = new Date(`${dueDate}T23:59:59.999Z`).getTime();

  if (!Number.isFinite(dueDateTime)) {
    return status;
  }

  if (Date.now() > dueDateTime && status !== "completed") {
    return "overdue";
  }

  return status;
}
