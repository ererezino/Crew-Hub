import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../lib/auth/session";
import { hasRole } from "../../../../../lib/roles";
import { createSupabaseServiceRoleClient } from "../../../../../lib/supabase/service-role";
import type { ApiResponse } from "../../../../../types/auth";
import { EXPENSE_CATEGORIES } from "../../../../../types/expenses";
import type { UserRole } from "../../../../../lib/navigation";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildMeta() {
  return { timestamp: new Date().toISOString() };
}

function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return NextResponse.json(payload, { status });
}

function canManageRoutingRules(roles: readonly UserRole[]): boolean {
  return hasRole(roles, "SUPER_ADMIN");
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const approverTypeSchema = z.enum(["department_owner", "specific_person"]);
const expenseCategorySchema = z.enum(EXPENSE_CATEGORIES);

const updateRuleSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(200, "Name is too long").optional(),
    department: z.string().trim().max(200).nullable().optional(),
    min_amount: z.number().int().min(0).nullable().optional(),
    max_amount: z.number().int().min(0).nullable().optional(),
    category: expenseCategorySchema.nullable().optional(),
    approver_type: approverTypeSchema.optional(),
    approver_id: z.string().uuid().nullable().optional(),
    priority: z.number().int().min(0).optional(),
    is_active: z.boolean().optional(),
  })
  .refine(
    (data) => {
      // If approver_type is being set to specific_person, approver_id must be provided
      if (data.approver_type === "specific_person" && data.approver_id == null) {
        return false;
      }
      return true;
    },
    {
      message: "approver_id is required when approver_type is 'specific_person'.",
      path: ["approver_id"],
    }
  );

// ---------------------------------------------------------------------------
// Columns to select
// ---------------------------------------------------------------------------

const RULE_SELECT_COLUMNS =
  "id, name, department, min_amount, max_amount, category, approver_type, approver_id, priority, is_active, created_at, updated_at";

// ---------------------------------------------------------------------------
// PATCH  /api/v1/expense-routing-rules/[id]
// ---------------------------------------------------------------------------

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: { code: "UNAUTHORIZED", message: "You must be logged in." },
      meta: buildMeta(),
    });
  }

  if (!canManageRoutingRules(session.profile.roles)) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "Only Super Admin can manage expense routing rules.",
      },
      meta: buildMeta(),
    });
  }

  const { id: ruleId } = await params;

  if (!ruleId) {
    return jsonResponse<null>(400, {
      data: null,
      error: { code: "BAD_REQUEST", message: "Rule id is required." },
      meta: buildMeta(),
    });
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return jsonResponse<null>(400, {
      data: null,
      error: { code: "BAD_REQUEST", message: "Request body must be valid JSON." },
      meta: buildMeta(),
    });
  }

  const parsed = updateRuleSchema.safeParse(body);

  if (!parsed.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsed.error.issues[0]?.message ?? "Invalid routing rule payload.",
      },
      meta: buildMeta(),
    });
  }

  const payload = parsed.data;

  // Nothing to update
  if (Object.keys(payload).length === 0) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: "At least one field must be provided for update.",
      },
      meta: buildMeta(),
    });
  }

  const supabase = createSupabaseServiceRoleClient();

  // Verify the rule exists and belongs to this org
  const { data: existing, error: fetchError } = await supabase
    .from("expense_routing_rules")
    .select("id")
    .eq("id", ruleId)
    .eq("org_id", session.profile.org_id)
    .is("deleted_at", null)
    .maybeSingle();

  if (fetchError) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "RULE_FETCH_FAILED", message: "Unable to load routing rule." },
      meta: buildMeta(),
    });
  }

  if (!existing) {
    return jsonResponse<null>(404, {
      data: null,
      error: { code: "NOT_FOUND", message: "Routing rule was not found." },
      meta: buildMeta(),
    });
  }

  // If approver_type is being changed to specific_person, also need to check
  // that the existing record would still be valid when combined with the update.
  // The zod refine handles the case where approver_type is set in this payload.
  // But if only approver_id is being set to null and current type is specific_person,
  // we need to guard that separately.
  if (payload.approver_id === null && payload.approver_type === undefined) {
    const { data: currentRule } = await supabase
      .from("expense_routing_rules")
      .select("approver_type")
      .eq("id", ruleId)
      .single();

    if (currentRule?.approver_type === "specific_person") {
      return jsonResponse<null>(422, {
        data: null,
        error: {
          code: "VALIDATION_ERROR",
          message:
            "Cannot remove approver_id while approver_type is 'specific_person'.",
        },
        meta: buildMeta(),
      });
    }
  }

  const updatePayload: Record<string, unknown> = {};

  if (payload.name !== undefined) updatePayload.name = payload.name;
  if (payload.department !== undefined) updatePayload.department = payload.department;
  if (payload.min_amount !== undefined) updatePayload.min_amount = payload.min_amount;
  if (payload.max_amount !== undefined) updatePayload.max_amount = payload.max_amount;
  if (payload.category !== undefined) updatePayload.category = payload.category;
  if (payload.approver_type !== undefined) updatePayload.approver_type = payload.approver_type;
  if (payload.approver_id !== undefined) updatePayload.approver_id = payload.approver_id;
  if (payload.priority !== undefined) updatePayload.priority = payload.priority;
  if (payload.is_active !== undefined) updatePayload.is_active = payload.is_active;

  const { data: updated, error: updateError } = await supabase
    .from("expense_routing_rules")
    .update(updatePayload)
    .eq("id", ruleId)
    .eq("org_id", session.profile.org_id)
    .is("deleted_at", null)
    .select(RULE_SELECT_COLUMNS)
    .single();

  if (updateError || !updated) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "RULE_UPDATE_FAILED", message: "Unable to update routing rule." },
      meta: buildMeta(),
    });
  }

  // Resolve approver name
  let approver_name: string | null = null;

  if (updated.approver_id) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", updated.approver_id as string)
      .eq("org_id", session.profile.org_id)
      .is("deleted_at", null)
      .maybeSingle();

    approver_name = (profile?.full_name as string) ?? null;
  }

  return jsonResponse(200, {
    data: { rule: { ...updated, approver_name } },
    error: null,
    meta: buildMeta(),
  });
}

// ---------------------------------------------------------------------------
// DELETE  /api/v1/expense-routing-rules/[id]  (soft delete)
// ---------------------------------------------------------------------------

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: { code: "UNAUTHORIZED", message: "You must be logged in." },
      meta: buildMeta(),
    });
  }

  if (!canManageRoutingRules(session.profile.roles)) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "Only Super Admin can manage expense routing rules.",
      },
      meta: buildMeta(),
    });
  }

  const { id: ruleId } = await params;

  if (!ruleId) {
    return jsonResponse<null>(400, {
      data: null,
      error: { code: "BAD_REQUEST", message: "Rule id is required." },
      meta: buildMeta(),
    });
  }

  const supabase = createSupabaseServiceRoleClient();

  // Verify rule exists and belongs to org
  const { data: existing, error: fetchError } = await supabase
    .from("expense_routing_rules")
    .select("id")
    .eq("id", ruleId)
    .eq("org_id", session.profile.org_id)
    .is("deleted_at", null)
    .maybeSingle();

  if (fetchError) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "RULE_FETCH_FAILED", message: "Unable to load routing rule." },
      meta: buildMeta(),
    });
  }

  if (!existing) {
    return jsonResponse<null>(404, {
      data: null,
      error: { code: "NOT_FOUND", message: "Routing rule was not found." },
      meta: buildMeta(),
    });
  }

  const { error: deleteError } = await supabase
    .from("expense_routing_rules")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", ruleId)
    .eq("org_id", session.profile.org_id);

  if (deleteError) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "RULE_DELETE_FAILED", message: "Unable to delete routing rule." },
      meta: buildMeta(),
    });
  }

  return jsonResponse(200, {
    data: { success: true },
    error: null,
    meta: buildMeta(),
  });
}
