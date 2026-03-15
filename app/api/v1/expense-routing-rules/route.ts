import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../lib/auth/session";
import { hasRole } from "../../../../lib/roles";
import { createSupabaseServiceRoleClient } from "../../../../lib/supabase/service-role";
import type { ApiResponse } from "../../../../types/auth";
import { EXPENSE_CATEGORIES } from "../../../../types/expenses";
import type { UserRole } from "../../../../lib/navigation";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildMeta() {
  return { timestamp: new Date().toISOString() };
}

function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return NextResponse.json(payload, { status });
}

function isExpenseAdmin(roles: readonly UserRole[]): boolean {
  return (
    hasRole(roles, "HR_ADMIN") ||
    hasRole(roles, "FINANCE_ADMIN") ||
    hasRole(roles, "SUPER_ADMIN")
  );
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const approverTypeSchema = z.enum(["department_owner", "specific_person"]);
const expenseCategorySchema = z.enum(EXPENSE_CATEGORIES);

const createRuleSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(200, "Name is too long"),
    department: z.string().trim().max(200).nullable().optional(),
    min_amount: z.number().int().min(0).nullable().optional(),
    max_amount: z.number().int().min(0).nullable().optional(),
    category: expenseCategorySchema.nullable().optional(),
    approver_type: approverTypeSchema,
    approver_id: z.string().uuid().nullable().optional(),
    priority: z.number().int().min(0).optional(),
    is_active: z.boolean().default(true),
  })
  .refine(
    (data) =>
      data.approver_type !== "specific_person" || (data.approver_id != null),
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
// GET  /api/v1/expense-routing-rules
// ---------------------------------------------------------------------------

export async function GET() {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: { code: "UNAUTHORIZED", message: "You must be logged in." },
      meta: buildMeta(),
    });
  }

  if (!isExpenseAdmin(session.profile.roles)) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "Only Super Admin, HR Admin, or Finance Admin can manage routing rules.",
      },
      meta: buildMeta(),
    });
  }

  const supabase = createSupabaseServiceRoleClient();

  const { data: rules, error: rulesError } = await supabase
    .from("expense_routing_rules")
    .select(RULE_SELECT_COLUMNS)
    .eq("org_id", session.profile.org_id)
    .is("deleted_at", null)
    .order("priority", { ascending: true });

  if (rulesError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "RULES_FETCH_FAILED",
        message: "Unable to load routing rules.",
      },
      meta: buildMeta(),
    });
  }

  // Resolve approver names
  const approverIdSet = new Set(
    (rules ?? [])
      .map((r: Record<string, unknown>) => r.approver_id as string | null)
      .filter((id): id is string => Boolean(id))
  );
  const approverIds = Array.from(approverIdSet);

  let approverMap = new Map<string, string>();

  if (approverIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .eq("org_id", session.profile.org_id)
      .is("deleted_at", null)
      .in("id", approverIds);

    if (profiles) {
      approverMap = new Map(
        profiles.map((p: { id: string; full_name: string }) => [p.id, p.full_name])
      );
    }
  }

  const enrichedRules = (rules ?? []).map((rule: Record<string, unknown>) => ({
    ...rule,
    approver_name: rule.approver_id
      ? approverMap.get(rule.approver_id as string) ?? null
      : null,
  }));

  return jsonResponse(200, {
    data: { rules: enrichedRules },
    error: null,
    meta: buildMeta(),
  });
}

// ---------------------------------------------------------------------------
// POST  /api/v1/expense-routing-rules
// ---------------------------------------------------------------------------

export async function POST(request: Request) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: { code: "UNAUTHORIZED", message: "You must be logged in." },
      meta: buildMeta(),
    });
  }

  if (!isExpenseAdmin(session.profile.roles)) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "Only Super Admin, HR Admin, or Finance Admin can manage routing rules.",
      },
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

  const parsed = createRuleSchema.safeParse(body);

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
  const supabase = createSupabaseServiceRoleClient();

  // If no priority supplied, default to max(priority) + 1
  let priority = payload.priority;

  if (priority == null) {
    const { data: maxRow } = await supabase
      .from("expense_routing_rules")
      .select("priority")
      .eq("org_id", session.profile.org_id)
      .is("deleted_at", null)
      .order("priority", { ascending: false })
      .limit(1)
      .maybeSingle();

    priority = maxRow?.priority != null ? (maxRow.priority as number) + 1 : 0;
  }

  const insertPayload = {
    org_id: session.profile.org_id,
    name: payload.name,
    department: payload.department ?? null,
    min_amount: payload.min_amount ?? null,
    max_amount: payload.max_amount ?? null,
    category: payload.category ?? null,
    approver_type: payload.approver_type,
    approver_id: payload.approver_id ?? null,
    priority,
    is_active: payload.is_active,
  };

  const { data: inserted, error: insertError } = await supabase
    .from("expense_routing_rules")
    .insert(insertPayload)
    .select(RULE_SELECT_COLUMNS)
    .single();

  if (insertError || !inserted) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "RULE_CREATE_FAILED",
        message: "Unable to create routing rule.",
      },
      meta: buildMeta(),
    });
  }

  // Resolve approver name for the response
  let approver_name: string | null = null;

  if (inserted.approver_id) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", inserted.approver_id as string)
      .eq("org_id", session.profile.org_id)
      .is("deleted_at", null)
      .maybeSingle();

    approver_name = (profile?.full_name as string) ?? null;
  }

  return jsonResponse(201, {
    data: { rule: { ...inserted, approver_name } },
    error: null,
    meta: buildMeta(),
  });
}
