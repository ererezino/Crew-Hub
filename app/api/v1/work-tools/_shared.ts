import { NextResponse } from "next/server";
import { z } from "zod";

import { createSupabaseServiceRoleClient } from "../../../../lib/supabase/service-role";
import {
  getWorkToolDisplayLabel,
  mapWorkToolRequestRow,
  mapWorkToolRow,
  workToolRequestRowSchema,
  workToolRowSchema
} from "../../../../lib/work-tools";
import type { ApiResponse } from "../../../../types/auth";
import {
  WORK_TOOL_ISSUE_TYPES,
  WORK_TOOL_REQUEST_KINDS,
  WORK_TOOL_REQUEST_STATUSES,
  WORK_TOOL_STATUSES,
  WORK_TOOL_TYPES,
  type WorkToolRecord,
  type WorkToolRequestRecord
} from "../../../../types/work-tools";

export const WORK_TOOL_SELECT =
  "id, org_id, employee_id, item_type, item_name, serial_number, transaction_currency, cost_amount, status, assigned_at, returned_at, notes, created_at, updated_at";

export const WORK_TOOL_REQUEST_SELECT =
  "id, org_id, employee_id, tool_id, request_kind, requested_item_type, issue_type, details, status, hr_notes, created_at, updated_at, resolved_at";

const optionalIsoDateish = z
  .string()
  .trim()
  .refine(
    (value) =>
      value.length === 0 ||
      /^\d{4}-\d{2}-\d{2}$/.test(value) ||
      !Number.isNaN(Date.parse(value)),
    "Date must be a valid ISO date."
  )
  .optional();

const optionalNullableIsoDateish = optionalIsoDateish.nullable();

export const workToolCreateSchema = z
  .object({
    employeeId: z.string().uuid().nullable().optional(),
    itemType: z.enum(WORK_TOOL_TYPES),
    itemName: z.string().trim().min(1, "Item name is required.").max(200, "Item name is too long."),
    serialNumber: z.string().trim().max(200, "Serial number is too long.").nullable().optional(),
    transactionCurrency: z.string().trim().max(10, "Currency code is too long.").nullable().optional(),
    costAmount: z.union([z.number(), z.string()]).nullable().optional(),
    status: z.enum(WORK_TOOL_STATUSES).optional().default("assigned"),
    assignedAt: optionalNullableIsoDateish,
    notes: z.string().trim().max(1000, "Notes are too long.").nullable().optional()
  })
  .superRefine((value, ctx) => {
    if ((value.status === "assigned" || value.status === "maintenance") && !value.employeeId) {
      ctx.addIssue({
        code: "custom",
        path: ["employeeId"],
        message: "Select an employee for tools that are currently in use."
      });
    }
  });

export const workToolUpdateSchema = z
  .object({
    employeeId: z.string().uuid().nullable().optional(),
    itemType: z.enum(WORK_TOOL_TYPES).optional(),
    itemName: z.string().trim().min(1, "Item name is required.").max(200, "Item name is too long.").optional(),
    serialNumber: z.string().trim().max(200, "Serial number is too long.").nullable().optional(),
    transactionCurrency: z.string().trim().max(10, "Currency code is too long.").nullable().optional(),
    costAmount: z.union([z.number(), z.string()]).nullable().optional(),
    status: z.enum(WORK_TOOL_STATUSES).optional(),
    assignedAt: optionalNullableIsoDateish,
    returnedAt: optionalNullableIsoDateish,
    notes: z.string().trim().max(1000, "Notes are too long.").nullable().optional()
  })
  .superRefine((value, ctx) => {
    if ((value.status === "assigned" || value.status === "maintenance") && value.employeeId === null) {
      ctx.addIssue({
        code: "custom",
        path: ["employeeId"],
        message: "Assigned tools must still have a current holder."
      });
    }
  });

export const workToolRequestCreateSchema = z
  .object({
    requestKind: z.enum(WORK_TOOL_REQUEST_KINDS),
    requestedItemType: z.enum(WORK_TOOL_TYPES).nullable().optional(),
    toolId: z.string().uuid().nullable().optional(),
    issueType: z.enum(WORK_TOOL_ISSUE_TYPES).nullable().optional(),
    details: z.string().trim().min(5, "Please add a little more detail.").max(2000, "Details are too long.")
  })
  .superRefine((value, ctx) => {
    if (value.requestKind === "tool_request") {
      if (!value.requestedItemType) {
        ctx.addIssue({
          code: "custom",
          path: ["requestedItemType"],
          message: "Choose the tool you need."
        });
      }
      return;
    }

    if (!value.toolId) {
      ctx.addIssue({
        code: "custom",
        path: ["toolId"],
        message: "Choose the tool you are reporting."
      });
    }

    if (!value.issueType) {
      ctx.addIssue({
        code: "custom",
        path: ["issueType"],
        message: "Choose the issue you need help with."
      });
    }
  });

export const workToolRequestUpdateSchema = z.object({
  status: z.enum(WORK_TOOL_REQUEST_STATUSES),
  hrNotes: z.string().trim().max(2000, "Notes are too long.").nullable().optional()
});

export function buildMeta() {
  return { timestamp: new Date().toISOString() };
}

export function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return NextResponse.json(payload, { status });
}

function normalizeIds(values: readonly (string | null | undefined)[]): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

async function loadProfileNameMap(
  supabase: ReturnType<typeof createSupabaseServiceRoleClient>,
  orgId: string,
  profileIds: readonly (string | null | undefined)[]
): Promise<Map<string, string>> {
  const ids = normalizeIds(profileIds);

  if (ids.length === 0) {
    return new Map();
  }

  const { data } = await supabase
    .from("profiles")
    .select("id, full_name")
    .eq("org_id", orgId)
    .is("deleted_at", null)
    .in("id", ids);

  return new Map(
    (data ?? [])
      .filter(
        (row): row is { id: string; full_name: string } =>
          typeof row?.id === "string" && typeof row?.full_name === "string"
      )
      .map((row) => [row.id, row.full_name])
  );
}

async function loadToolLabelMap(
  supabase: ReturnType<typeof createSupabaseServiceRoleClient>,
  orgId: string,
  toolIds: readonly (string | null | undefined)[]
): Promise<Map<string, string>> {
  const ids = normalizeIds(toolIds);

  if (ids.length === 0) {
    return new Map();
  }

  const { data } = await supabase
    .from("work_tools")
    .select("id, item_name, serial_number")
    .eq("org_id", orgId)
    .is("deleted_at", null)
    .in("id", ids);

  return new Map(
    (data ?? [])
      .filter(
        (row): row is { id: string; item_name: string; serial_number: string | null } =>
          typeof row?.id === "string" && typeof row?.item_name === "string"
      )
      .map((row) => [
        row.id,
        getWorkToolDisplayLabel({
          itemName: row.item_name,
          serialNumber: row.serial_number ?? null
        })
      ])
  );
}

export async function hydrateWorkTools(
  supabase: ReturnType<typeof createSupabaseServiceRoleClient>,
  orgId: string,
  rows: unknown[]
): Promise<WorkToolRecord[]> {
  const parsedRows = z.array(workToolRowSchema).safeParse(rows);

  if (!parsedRows.success) {
    throw new Error("Unable to parse work tool rows.");
  }

  const nameById = await loadProfileNameMap(
    supabase,
    orgId,
    parsedRows.data.map((row) => row.employee_id)
  );

  return parsedRows.data.map((row) =>
    mapWorkToolRow({
      ...row,
      employee_name: row.employee_id ? nameById.get(row.employee_id) ?? null : null
    })
  );
}

export async function hydrateWorkToolRequests(
  supabase: ReturnType<typeof createSupabaseServiceRoleClient>,
  orgId: string,
  rows: unknown[]
): Promise<WorkToolRequestRecord[]> {
  const parsedRows = z.array(workToolRequestRowSchema).safeParse(rows);

  if (!parsedRows.success) {
    throw new Error("Unable to parse work tool request rows.");
  }

  const [nameById, toolLabelById] = await Promise.all([
    loadProfileNameMap(
      supabase,
      orgId,
      parsedRows.data.map((row) => row.employee_id)
    ),
    loadToolLabelMap(
      supabase,
      orgId,
      parsedRows.data.map((row) => row.tool_id)
    )
  ]);

  return parsedRows.data.map((row) =>
    mapWorkToolRequestRow({
      ...row,
      employee_name: nameById.get(row.employee_id) ?? null,
      tool_label: row.tool_id ? toolLabelById.get(row.tool_id) ?? null : null
    })
  );
}
