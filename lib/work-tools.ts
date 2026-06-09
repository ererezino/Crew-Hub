import { z } from "zod";

import { hasRole } from "./roles";
import { createSupabaseServiceRoleClient } from "./supabase/service-role";
import type { AppRole } from "../types/auth";
import {
  WORK_TOOL_ISSUE_TYPES,
  WORK_TOOL_REQUEST_KINDS,
  WORK_TOOL_REQUEST_STATUSES,
  WORK_TOOL_STATUSES,
  WORK_TOOL_TYPES,
  type WorkToolIssueType,
  type WorkToolRecord,
  type WorkToolRequestRecord,
  type WorkToolStatus,
  type WorkToolType
} from "../types/work-tools";

export function canManageWorkTools(roles: readonly AppRole[]): boolean {
  return hasRole(roles, "HR_ADMIN") || hasRole(roles, "SUPER_ADMIN");
}

export function canViewWorkToolsForPerson(
  roles: readonly AppRole[],
  viewerId: string,
  employeeId: string
): boolean {
  return viewerId === employeeId || canManageWorkTools(roles);
}

export function isWorkToolOutstanding(status: WorkToolStatus): boolean {
  return status === "assigned" || status === "maintenance";
}

export function getWorkToolDisplayLabel(
  tool: Pick<WorkToolRecord, "itemName" | "serialNumber">
): string {
  if (tool.serialNumber && tool.serialNumber.trim().length > 0) {
    return `${tool.itemName} (${tool.serialNumber.trim()})`;
  }

  return tool.itemName;
}

export const workToolRowSchema = z.object({
  id: z.string().uuid(),
  org_id: z.string().uuid(),
  employee_id: z.string().uuid().nullable(),
  item_type: z.enum(WORK_TOOL_TYPES),
  item_name: z.string(),
  serial_number: z.string().nullable(),
  transaction_currency: z.string().nullable(),
  cost_amount: z.union([z.number(), z.string()]).nullable(),
  status: z.enum(WORK_TOOL_STATUSES),
  assigned_at: z.string().nullable(),
  returned_at: z.string().nullable(),
  notes: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  employee_name: z.string().nullable().optional().default(null)
});

export const workToolRequestRowSchema = z.object({
  id: z.string().uuid(),
  org_id: z.string().uuid(),
  employee_id: z.string().uuid(),
  tool_id: z.string().uuid().nullable(),
  request_kind: z.enum(WORK_TOOL_REQUEST_KINDS),
  requested_item_type: z.enum(WORK_TOOL_TYPES).nullable(),
  issue_type: z.enum(WORK_TOOL_ISSUE_TYPES).nullable(),
  details: z.string(),
  status: z.enum(WORK_TOOL_REQUEST_STATUSES),
  hr_notes: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  resolved_at: z.string().nullable(),
  employee_name: z.string().nullable().optional().default(null),
  tool_label: z.string().nullable().optional().default(null)
});

function parseMoney(value: number | string | null): number | null {
  if (value === null) {
    return null;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

export function mapWorkToolRow(
  row: z.infer<typeof workToolRowSchema>
): WorkToolRecord {
  return {
    id: row.id,
    orgId: row.org_id,
    employeeId: row.employee_id,
    employeeName: row.employee_name ?? null,
    itemType: row.item_type,
    itemName: row.item_name,
    serialNumber: row.serial_number ?? null,
    transactionCurrency: row.transaction_currency ?? null,
    costAmount: parseMoney(row.cost_amount),
    status: row.status,
    assignedAt: row.assigned_at ?? null,
    returnedAt: row.returned_at ?? null,
    notes: row.notes ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function mapWorkToolRequestRow(
  row: z.infer<typeof workToolRequestRowSchema>
): WorkToolRequestRecord {
  return {
    id: row.id,
    orgId: row.org_id,
    employeeId: row.employee_id,
    employeeName: row.employee_name ?? null,
    toolId: row.tool_id ?? null,
    toolLabel: row.tool_label ?? null,
    requestKind: row.request_kind,
    requestedItemType: row.requested_item_type ?? null,
    issueType: row.issue_type ?? null,
    details: row.details,
    status: row.status,
    hrNotes: row.hr_notes ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resolvedAt: row.resolved_at ?? null
  };
}

export async function getHrAdminRecipientIds(
  supabase: ReturnType<typeof createSupabaseServiceRoleClient>,
  orgId: string
): Promise<string[]> {
  const { data } = await supabase
    .from("profiles")
    .select("id")
    .eq("org_id", orgId)
    .contains("roles", ["HR_ADMIN"])
    .is("deleted_at", null);

  return (data ?? [])
    .map((row) => row.id)
    .filter((value): value is string => typeof value === "string");
}

export function getWorkToolRequestTitle(params: {
  requestKind: (typeof WORK_TOOL_REQUEST_KINDS)[number];
  requestedItemType: WorkToolType | null;
  issueType: WorkToolIssueType | null;
  toolLabel: string | null;
}): string {
  if (params.requestKind === "tool_request") {
    return params.requestedItemType
      ? `Work tool request: ${params.requestedItemType}`
      : "Work tool request";
  }

  if (params.issueType === "not_in_possession") {
    return `Assignment dispute: ${params.toolLabel ?? "tool"}`;
  }

  if (params.issueType === "spec_mismatch") {
    return `Spec correction: ${params.toolLabel ?? "tool"}`;
  }

  if (params.issueType === "faulty") {
    return `Faulty work tool: ${params.toolLabel ?? "tool"}`;
  }

  if (params.issueType === "stolen") {
    return `Stolen work tool: ${params.toolLabel ?? "tool"}`;
  }

  return "Work tool issue reported";
}
