import { z } from "zod";

import { logAudit } from "../../../../../../lib/audit";
import { getAuthenticatedSession } from "../../../../../../lib/auth/session";
import { normalizeUserRoles } from "../../../../../../lib/navigation";
import { hasRole } from "../../../../../../lib/roles";
import { createSupabaseServerClient } from "../../../../../../lib/supabase/server";
import type { ApiResponse } from "../../../../../../types/auth";
import type { GoalMutationResponseData, GoalRecord, GoalStatus } from "../../../../../../types/performance";

const updateGoalSchema = z.object({
  title: z.string().trim().min(1).max(500).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  dueDate: z.string().nullable().optional(),
  status: z.enum(["active", "completed", "cancelled"]).optional()
});

const goalRowSchema = z.object({
  id: z.string().uuid(),
  org_id: z.string().uuid(),
  employee_id: z.string().uuid(),
  cycle_id: z.string().uuid().nullable(),
  title: z.string(),
  description: z.string().nullable(),
  due_date: z.string().nullable(),
  status: z.string(),
  progress_pct: z.number(),
  created_by: z.string().uuid().nullable(),
  created_at: z.string(),
  updated_at: z.string()
});

const profileRowSchema = z.object({
  id: z.string().uuid(),
  full_name: z.string()
});

const cycleRowSchema = z.object({
  id: z.string().uuid(),
  name: z.string()
});

const goalSelectColumns =
  "id, org_id, employee_id, cycle_id, title, description, due_date, status, progress_pct, created_by, created_at, updated_at";

function buildMeta() {
  return { timestamp: new Date().toISOString() };
}

function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return Response.json(payload, { status });
}

function isGoalStatus(value: string): value is GoalStatus {
  return value === "active" || value === "completed" || value === "cancelled";
}

function mapGoalRow(
  row: z.infer<typeof goalRowSchema>,
  profilesById: ReadonlyMap<string, z.infer<typeof profileRowSchema>>,
  cyclesById: ReadonlyMap<string, z.infer<typeof cycleRowSchema>>
): GoalRecord | null {
  if (!isGoalStatus(row.status)) return null;

  const employee = profilesById.get(row.employee_id);
  const creator = row.created_by ? profilesById.get(row.created_by) : null;
  const cycle = row.cycle_id ? cyclesById.get(row.cycle_id) : null;

  return {
    id: row.id,
    orgId: row.org_id,
    employeeId: row.employee_id,
    employeeName: employee?.full_name ?? "Unknown user",
    cycleId: row.cycle_id,
    cycleName: cycle?.name ?? null,
    title: row.title,
    description: row.description,
    dueDate: row.due_date,
    status: row.status,
    progressPct: row.progress_pct,
    createdBy: row.created_by,
    createdByName: creator?.full_name ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: { code: "UNAUTHORIZED", message: "You must be logged in to update goals." },
      meta: buildMeta()
    });
  }

  const { id: goalId } = await params;

  if (!goalId) {
    return jsonResponse<null>(400, {
      data: null,
      error: { code: "BAD_REQUEST", message: "Goal id is required." },
      meta: buildMeta()
    });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse<null>(400, {
      data: null,
      error: { code: "BAD_REQUEST", message: "Request body must be valid JSON." },
      meta: buildMeta()
    });
  }

  const parsed = updateGoalSchema.safeParse(body);

  if (!parsed.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsed.error.issues[0]?.message ?? "Invalid goal update payload."
      },
      meta: buildMeta()
    });
  }

  const payload = parsed.data;
  const supabase = await createSupabaseServerClient();
  const orgId = session.profile.org_id;

  // Fetch existing goal
  const { data: rawGoal, error: fetchError } = await supabase
    .from("performance_goals")
    .select(goalSelectColumns)
    .eq("id", goalId)
    .eq("org_id", orgId)
    .is("deleted_at", null)
    .maybeSingle();

  if (fetchError) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "GOAL_UPDATE_FAILED", message: "Unable to load goal." },
      meta: buildMeta()
    });
  }

  const parsedExisting = goalRowSchema.safeParse(rawGoal);

  if (!parsedExisting.success) {
    return jsonResponse<null>(404, {
      data: null,
      error: { code: "NOT_FOUND", message: "Goal was not found." },
      meta: buildMeta()
    });
  }

  // Authorization: owner or manager
  const userRoles = normalizeUserRoles(session.profile.roles);
  const isAdmin = hasRole(userRoles, "HR_ADMIN") || hasRole(userRoles, "SUPER_ADMIN");
  const isOwner = parsedExisting.data.employee_id === session.profile.id;

  if (!isOwner && !isAdmin) {
    const { data: reportCheck } = await supabase
      .from("profiles")
      .select("id")
      .eq("org_id", orgId)
      .eq("id", parsedExisting.data.employee_id)
      .eq("manager_id", session.profile.id)
      .is("deleted_at", null)
      .maybeSingle();

    if (!reportCheck) {
      return jsonResponse<null>(403, {
        data: null,
        error: {
          code: "FORBIDDEN",
          message: "Only the goal owner or their manager can update this goal."
        },
        meta: buildMeta()
      });
    }
  }

  const updateFields: Record<string, unknown> = {};
  if (payload.title !== undefined) updateFields.title = payload.title;
  if (payload.description !== undefined) updateFields.description = payload.description;
  if (payload.dueDate !== undefined) updateFields.due_date = payload.dueDate;
  if (payload.status !== undefined) updateFields.status = payload.status;

  if (Object.keys(updateFields).length === 0) {
    return jsonResponse<null>(422, {
      data: null,
      error: { code: "VALIDATION_ERROR", message: "No fields to update." },
      meta: buildMeta()
    });
  }

  const { data: rawUpdated, error: updateError } = await supabase
    .from("performance_goals")
    .update(updateFields)
    .eq("id", goalId)
    .eq("org_id", orgId)
    .select(goalSelectColumns)
    .single();

  if (updateError || !rawUpdated) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "GOAL_UPDATE_FAILED", message: "Unable to update goal." },
      meta: buildMeta()
    });
  }

  const parsedUpdated = goalRowSchema.safeParse(rawUpdated);

  if (!parsedUpdated.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "GOAL_UPDATE_FAILED", message: "Updated goal data is invalid." },
      meta: buildMeta()
    });
  }

  void logAudit({
    action: "updated",
    tableName: "performance_goals",
    recordId: goalId,
    oldValue: {
      title: parsedExisting.data.title,
      description: parsedExisting.data.description,
      due_date: parsedExisting.data.due_date,
      status: parsedExisting.data.status
    },
    newValue: updateFields
  });

  // Enrich
  const profileIds = new Set<string>([parsedUpdated.data.employee_id]);
  if (parsedUpdated.data.created_by) profileIds.add(parsedUpdated.data.created_by);

  const [profilesResult, cyclesResult] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name")
      .eq("org_id", orgId)
      .in("id", [...profileIds]),
    parsedUpdated.data.cycle_id
      ? supabase
          .from("review_cycles")
          .select("id, name")
          .eq("id", parsedUpdated.data.cycle_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null })
  ]);

  const profilesById = new Map(
    z
      .array(profileRowSchema)
      .parse(profilesResult.data ?? [])
      .map((p) => [p.id, p] as const)
  );

  const cyclesById = new Map<string, z.infer<typeof cycleRowSchema>>();
  if (cyclesResult.data) {
    const parsedCycle = cycleRowSchema.safeParse(cyclesResult.data);
    if (parsedCycle.success) cyclesById.set(parsedCycle.data.id, parsedCycle.data);
  }

  const goal = mapGoalRow(parsedUpdated.data, profilesById, cyclesById);

  if (!goal) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "GOAL_UPDATE_FAILED", message: "Unable to map updated goal." },
      meta: buildMeta()
    });
  }

  return jsonResponse<GoalMutationResponseData>(200, {
    data: { goal },
    error: null,
    meta: buildMeta()
  });
}
