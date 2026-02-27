import type { UserRole } from "./navigation";
import { hasRole } from "./roles";
import type { ComplianceCadence, ComplianceStatus, ComplianceUrgency } from "../types/compliance";

export function canManageCompliance(userRoles: readonly UserRole[]): boolean {
  return (
    hasRole(userRoles, "HR_ADMIN") ||
    hasRole(userRoles, "FINANCE_ADMIN") ||
    hasRole(userRoles, "SUPER_ADMIN")
  );
}

export function isComplianceCadence(value: string): value is ComplianceCadence {
  return (
    value === "monthly" ||
    value === "quarterly" ||
    value === "annual" ||
    value === "ongoing" ||
    value === "one_time"
  );
}

export function isComplianceStatus(value: string): value is ComplianceStatus {
  return (
    value === "pending" ||
    value === "in_progress" ||
    value === "completed" ||
    value === "overdue"
  );
}

export function complianceUrgency({
  status,
  dueDate,
  referenceDate = new Date()
}: {
  status: ComplianceStatus;
  dueDate: string;
  referenceDate?: Date;
}): ComplianceUrgency {
  if (status === "completed") {
    return "completed";
  }

  const due = new Date(`${dueDate}T00:00:00.000Z`);
  const today = new Date(referenceDate);
  today.setUTCHours(0, 0, 0, 0);

  if (Number.isNaN(due.getTime())) {
    return "upcoming";
  }

  if (due.getTime() < today.getTime()) {
    return "overdue";
  }

  const dueSoon = new Date(today);
  dueSoon.setUTCDate(dueSoon.getUTCDate() + 7);

  if (due.getTime() <= dueSoon.getTime()) {
    return "due_soon";
  }

  return "upcoming";
}

export function labelForComplianceCadence(value: ComplianceCadence): string {
  switch (value) {
    case "one_time":
      return "One-time";
    case "ongoing":
      return "Ongoing";
    default:
      return value.charAt(0).toUpperCase() + value.slice(1);
  }
}

export function labelForComplianceStatus(value: ComplianceStatus): string {
  switch (value) {
    case "in_progress":
      return "In Progress";
    default:
      return value.charAt(0).toUpperCase() + value.slice(1);
  }
}

export function toneForComplianceStatus(
  value: ComplianceStatus
): "pending" | "processing" | "success" | "error" {
  switch (value) {
    case "in_progress":
      return "processing";
    case "completed":
      return "success";
    case "overdue":
      return "error";
    default:
      return "pending";
  }
}
