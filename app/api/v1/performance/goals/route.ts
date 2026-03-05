import { z } from "zod";

import { logAudit } from "../../../../../lib/audit";
import { getAuthenticatedSession } from "../../../../../lib/auth/session";
import { normalizeUserRoles } from "../../../../../lib/navigation";
import { hasRole } from "../../../../../lib/roles";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import type { ApiResponse } from "../../../../../types/auth";
import type {
  GoalRecord,
  GoalStatus,
  GoalsListResponseData,
  GoalMutationResponseData
} from "../../../../../types/performance";

const createGoalSchema = z.object({
  employeeId: z.string().min(1),
  cycleId: z.string().uuid().nullable().optional(),
  title: z.string().trim().min(1).max(500),
  description: z.string().trim().max(2000).nullable().optional(),
  dueDate: z.string().nullable().optional()
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

export async function GET(request: Request) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: { code: "UNAUTHORIZED", message: "You must be logged in to view goals." },
      meta: buildMeta()
    });
  }

  const supabase = await createSupabaseServerClient();
  const orgId = session.profile.org_id;
  const userRoles = normalizeUserRoles(session.profile.roles);
  const isAdmin = hasRole(userRoles, "HR_ADMIN") || hasRole(userRoles, "SUPER_ADMIN");
  const isManager = hasRole(userRoles, "MANAGER");

  const url = new URL(request.url);
  const employeeIdParam = url.searchParams.get("employeeId");
  const statusParam = url.searchParams.get("status");
  const cycleIdParam = url.searchParams.get("cycleId");

  let goalsQuery = supabase
    .from("performance_goals")
    .select(goalSelectColumns)
    .eq("org_id", orgId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (employeeIdParam) {
    goalsQuery = goalsQuery.eq("employee_id", employeeIdParam);
  } else if (isAdmin) {
    // Admin sees all
  } else if (isManager) {
    // Manager sees own + direct reports
    const { data: reports } = await supabase
      .from("profiles")
      .select("id")
      .eq("org_id", orgId)
      .eq("manager_id", session.profile.id)
      .is("deleted_at", null);

    const reportIds = (reports ?? []).map((r) => r.id).filter((id): id is string => typeof id === "string");
    goalsQuery = goalsQuery.in("employee_id", [session.profile.id, ...reportIds]);
  } else {
    goalsQuery = goalsQuery.eq("employee_id", session.profile.id);
  }

  if (statusParam && isGoalStatus(statusParam)) {
    goalsQuery = goalsQuery.eq("status", statusParam);
  }

  if (cycleIdParam) {
    goalsQuery = goalsQuery.eq("cycle_id", cycleIdParam);
  }

  const { data: rawGoals, error: goalsError } = await goalsQuery;

  if (goalsError) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "GOALS_FETCH_FAILED", message: "Unable to load goals." },
      meta: buildMeta()
    });
  }

  const parsedGoals = z.array(goalRowSchema).safeParse(rawGoals ?? []);

  if (!parsedGoals.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "GOALS_PARSE_FAILED", message: "Goals data is not in the expected shape." },
      meta: buildMeta()
    });
  }

  // Collect profile IDs and cycle IDs for enrichment
  const profileIds = new Set<string>();
  const cycleIds = new Set<string>();

  for (const goal of parsedGoals.data) {
    profileIds.add(goal.employee_id);
    if (goal.created_by) profileIds.add(goal.created_by);
    if (goal.cycle_id) cycleIds.add(goal.cycle_id);
  }

  const [profilesResult, cyclesResult] = await Promise.all([
    profileIds.size > 0
      ? supabase
          .from("profiles")
          .select("id, full_name")
          .eq("org_id", orgId)
          .in("id", [...profileIds])
      : Promise.resolve({ data: [], error: null }),
    cycleIds.size > 0
      ? supabase
          .from("review_cycles")
          .select("id, name")
          .eq("org_id", orgId)
          .in("id", [...cycleIds])
      : Promise.resolve({ data: [], error: null })
  ]);

  const profilesById = new Map(
    z
      .array(profileRowSchema)
      .parse(profilesResult.data ?? [])
      .map((p) => [p.id, p] as const)
  );

  const cyclesById = new Map(
    z
      .array(cycleRowSchema)
      .parse(cyclesResult.data ?? [])
      .map((c) => [c.id, c] as const)
  );

  const goals: GoalRecord[] = [];
  for (const row of parsedGoals.data) {
    const mapped = mapGoalRow(row, profilesById, cyclesById);
    if (mapped) goals.push(mapped);
  }

  return jsonResponse<GoalsListResponseData>(200, {
    data: { goals },
    error: null,
    meta: buildMeta()
  });
}

export async function POST(request: Request) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: { code: "UNAUTHORIZED", message: "You must be logged in to create goals." },
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

  const parsed = createGoalSchema.safeParse(body);

  if (!parsed.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsed.error.issues[0]?.message ?? "Invalid goal payload."
      },
      meta: buildMeta()
    });
  }

  const payload = parsed.data;
  const supabase = await createSupabaseServerClient();
  const orgId = session.profile.org_id;
  const userRoles = normalizeUserRoles(session.profile.roles);
  const isAdmin = hasRole(userRoles, "HR_ADMIN") || hasRole(userRoles, "SUPER_ADMIN");

  // Map __self__ to the current user's ID
  const targetEmployeeId = payload.employeeId === "__self__" ? session.profile.id : payload.employeeId;

  // Authorization: employee creates own, manager creates for direct reports, admin creates for anyone
  if (targetEmployeeId !== session.profile.id && !isAdmin) {
    const { data: reportCheck } = await supabase
      .from("profiles")
      .select("id")
      .eq("org_id", orgId)
      .eq("id", targetEmployeeId)
      .eq("manager_id", session.profile.id)
      .is("deleted_at", null)
      .maybeSingle();

    if (!reportCheck) {
      return jsonResponse<null>(403, {
        data: null,
        error: {
          code: "FORBIDDEN",
          message: "You can only create goals for yourself or your direct reports."
        },
        meta: buildMeta()
      });
    }
  }

  const { data: rawGoal, error: insertError } = await supabase
    .from("performance_goals")
    .insert({
      org_id: orgId,
      employee_id: targetEmployeeId,
      cycle_id: payload.cycleId ?? null,
      title: payload.title,
      description: payload.description ?? null,
      due_date: payload.dueDate ?? null,
      created_by: session.profile.id
    })
    .select(goalSelectColumns)
    .single();

  if (insertError || !rawGoal) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "GOAL_CREATE_FAILED", message: "Unable to create goal." },
      meta: buildMeta()
    });
  }

  const parsedGoal = goalRowSchema.safeParse(rawGoal);

  if (!parsedGoal.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "GOAL_CREATE_FAILED", message: "Created goal data is invalid." },
      meta: buildMeta()
    });
  }

  void logAudit({
    action: "created",
    tableName: "performance_goals",
    recordId: parsedGoal.data.id,
    newValue: {
      employee_id: parsedGoal.data.employee_id,
      title: parsedGoal.data.title,
      cycle_id: parsedGoal.data.cycle_id
    }
  });

  // Enrich
  const profileIds = new Set<string>([parsedGoal.data.employee_id]);
  if (parsedGoal.data.created_by) profileIds.add(parsedGoal.data.created_by);

  const [profilesResult, cyclesResult] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name")
      .eq("org_id", orgId)
      .in("id", [...profileIds]),
    parsedGoal.data.cycle_id
      ? supabase
          .from("review_cycles")
          .select("id, name")
          .eq("id", parsedGoal.data.cycle_id)
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

  const goal = mapGoalRow(parsedGoal.data, profilesById, cyclesById);

  if (!goal) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "GOAL_CREATE_FAILED", message: "Unable to map created goal." },
      meta: buildMeta()
    });
  }

  return jsonResponse<GoalMutationResponseData>(201, {
    data: { goal },
    error: null,
    meta: buildMeta()
  });
}
