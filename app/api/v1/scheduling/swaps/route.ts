import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../lib/auth/session";
import { logAudit } from "../../../../../lib/audit";
import { createNotification } from "../../../../../lib/notifications/service";
import { areTimeRangesOverlapping, canViewTeamSchedules } from "../../../../../lib/scheduling";
import { isDepartmentScopedTeamLead } from "../../../../../lib/roles";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import type { ApiResponse } from "../../../../../types/auth";
import {
  SHIFT_SWAP_STATUSES,
  type SchedulingSwapMutationResponseData,
  type SchedulingSwapsResponseData,
  type ShiftSwapRecord
} from "../../../../../types/scheduling";

const querySchema = z.object({
  scope: z.enum(["mine", "team"]).default("mine"),
  status: z.enum(SHIFT_SWAP_STATUSES).optional(),
  sortDir: z.enum(["asc", "desc"]).default("desc"),
  limit: z.coerce.number().int().min(1).max(300).default(150)
});

const createSwapSchema = z.object({
  shiftId: z.string().uuid("shiftId must be a valid UUID."),
  targetId: z.string().uuid("targetId must be a valid UUID.").optional(),
  reason: z.string().trim().max(2000).optional()
});

const swapRowSchema = z.object({
  id: z.string().uuid(),
  org_id: z.string().uuid(),
  shift_id: z.string().uuid(),
  requester_id: z.string().uuid(),
  target_id: z.string().uuid().nullable(),
  reason: z.string().nullable(),
  status: z.enum(SHIFT_SWAP_STATUSES),
  approved_by: z.string().uuid().nullable(),
  approved_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string()
});

const shiftRowSchema = z.object({
  id: z.string().uuid(),
  employee_id: z.string().uuid().nullable(),
  shift_date: z.string(),
  start_time: z.string(),
  end_time: z.string(),
  status: z.string()
});

const profileRowSchema = z.object({
  id: z.string().uuid(),
  full_name: z.string(),
  manager_id: z.string().uuid().nullable()
});

function buildMeta() {
  return { timestamp: new Date().toISOString() };
}

function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return NextResponse.json(payload, { status });
}

async function mapSwapRows({
  supabase,
  rows,
  orgId
}: {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  rows: z.infer<typeof swapRowSchema>[];
  orgId: string;
}): Promise<ShiftSwapRecord[]> {
  if (rows.length === 0) {
    return [];
  }

  const shiftIds = [...new Set(rows.map((row) => row.shift_id))];
  const profileIds = [
    ...new Set(
      rows
        .flatMap((row) => [row.requester_id, row.target_id, row.approved_by])
        .filter((value): value is string => Boolean(value))
    )
  ];

  const [shiftsResult, profilesResult] = await Promise.all([
    supabase
      .from("shifts")
      .select("id, shift_date, start_time, end_time")
      .eq("org_id", orgId)
      .is("deleted_at", null)
      .in("id", shiftIds),
    profilesResultQuery({
      supabase,
      orgId,
      profileIds
    })
  ]);

  if (shiftsResult.error || profilesResult.error) {
    throw new Error("Unable to resolve swap metadata.");
  }

  const parsedShiftRows = z.array(
    z.object({
      id: z.string().uuid(),
      shift_date: z.string(),
      start_time: z.string(),
      end_time: z.string()
    })
  ).safeParse(shiftsResult.data ?? []);
  const parsedProfileRows = z.array(profileRowSchema).safeParse(profilesResult.data ?? []);

  if (!parsedShiftRows.success || !parsedProfileRows.success) {
    throw new Error("Swap metadata is not in the expected shape.");
  }

  const shiftById = new Map(parsedShiftRows.data.map((shiftRow) => [shiftRow.id, shiftRow] as const));
  const profileNameById = new Map(parsedProfileRows.data.map((profileRow) => [profileRow.id, profileRow.full_name] as const));

  return rows.map((row) => {
    const shift = shiftById.get(row.shift_id);

    return {
      id: row.id,
      orgId: row.org_id,
      shiftId: row.shift_id,
      shiftDate: shift?.shift_date ?? "",
      shiftStartTime: shift?.start_time ?? "",
      shiftEndTime: shift?.end_time ?? "",
      requesterId: row.requester_id,
      requesterName: profileNameById.get(row.requester_id) ?? "Unknown user",
      targetId: row.target_id,
      targetName: row.target_id ? profileNameById.get(row.target_id) ?? null : null,
      reason: row.reason,
      status: row.status,
      approvedBy: row.approved_by,
      approvedByName: row.approved_by ? profileNameById.get(row.approved_by) ?? null : null,
      approvedAt: row.approved_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  });
}

function profilesResultQuery({
  supabase,
  orgId,
  profileIds
}: {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  orgId: string;
  profileIds: string[];
}) {
  if (profileIds.length === 0) {
    return Promise.resolve({ data: [], error: null });
  }

  return supabase
    .from("profiles")
    .select("id, full_name, manager_id")
    .eq("org_id", orgId)
    .is("deleted_at", null)
    .in("id", profileIds);
}

export async function GET(request: Request) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to view shift swaps."
      },
      meta: buildMeta()
    });
  }

  const parsedQuery = querySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams.entries())
  );

  if (!parsedQuery.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsedQuery.error.issues[0]?.message ?? "Invalid shift swap query."
      },
      meta: buildMeta()
    });
  }

  const query = parsedQuery.data;
  const canViewTeam = canViewTeamSchedules(session.profile.roles);
  const scope = query.scope === "team" && canViewTeam ? "team" : "mine";
  const isScopedTeamLead = isDepartmentScopedTeamLead(session.profile.roles);
  const supabase = await createSupabaseServerClient();

  if (scope === "team" && isScopedTeamLead && !session.profile.department) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "TEAM_LEAD_DEPARTMENT_REQUIRED",
        message: "Team lead scheduling requires a department on your profile."
      },
      meta: buildMeta()
    });
  }

  let swapsQuery = supabase
    .from("shift_swaps")
    .select(
      "id, org_id, shift_id, requester_id, target_id, reason, status, approved_by, approved_at, created_at, updated_at"
    )
    .eq("org_id", session.profile.org_id)
    .is("deleted_at", null)
    .order("created_at", { ascending: query.sortDir === "asc" })
    .limit(query.limit);

  if (query.status) {
    swapsQuery = swapsQuery.eq("status", query.status);
  }

  if (scope === "mine") {
    swapsQuery = swapsQuery.or(
      `requester_id.eq.${session.profile.id},target_id.eq.${session.profile.id}`
    );
  } else if (scope === "team" && isScopedTeamLead) {
    const { data: scheduleRows, error: schedulesError } = await supabase
      .from("schedules")
      .select("id")
      .eq("org_id", session.profile.org_id)
      .ilike("department", session.profile.department as string)
      .is("deleted_at", null);

    if (schedulesError) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "SHIFT_SWAP_SCOPE_FETCH_FAILED",
          message: "Unable to resolve team lead scope for shift swaps."
        },
        meta: buildMeta()
      });
    }

    const scheduleIds = (scheduleRows ?? [])
      .map((row) => row.id)
      .filter((value): value is string => typeof value === "string");

    if (scheduleIds.length === 0) {
      return jsonResponse<SchedulingSwapsResponseData>(200, {
        data: { swaps: [] },
        error: null,
        meta: buildMeta()
      });
    }

    const shiftQueryResult = await supabase
      .from("shifts")
      .select("id")
      .eq("org_id", session.profile.org_id)
      .in("schedule_id", scheduleIds)
      .is("deleted_at", null);

    if (shiftQueryResult.error || !shiftQueryResult.data) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "SHIFT_SWAP_SCOPE_FETCH_FAILED",
          message: "Unable to resolve team lead scope for shift swaps."
        },
        meta: buildMeta()
      });
    }

    const scopedShiftIds = shiftQueryResult.data
      .map((row) => row.id)
      .filter((value): value is string => typeof value === "string");

    if (scopedShiftIds.length === 0) {
      return jsonResponse<SchedulingSwapsResponseData>(200, {
        data: { swaps: [] },
        error: null,
        meta: buildMeta()
      });
    }

    swapsQuery = swapsQuery.in("shift_id", scopedShiftIds);
  }

  const { data: rawRows, error } = await swapsQuery;

  if (error) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "SHIFT_SWAPS_FETCH_FAILED",
        message: "Unable to load shift swap requests."
      },
      meta: buildMeta()
    });
  }

  const parsedRows = z.array(swapRowSchema).safeParse(rawRows ?? []);

  if (!parsedRows.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "SHIFT_SWAPS_PARSE_FAILED",
        message: "Shift swap data is not in the expected shape."
      },
      meta: buildMeta()
    });
  }

  try {
    const swaps = await mapSwapRows({
      supabase,
      rows: parsedRows.data,
      orgId: session.profile.org_id
    });

    return jsonResponse<SchedulingSwapsResponseData>(200, {
      data: {
        swaps
      },
      error: null,
      meta: buildMeta()
    });
  } catch {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "SHIFT_SWAPS_METADATA_FAILED",
        message: "Unable to resolve shift swap metadata."
      },
      meta: buildMeta()
    });
  }
}

export async function POST(request: Request) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to request a shift swap."
      },
      meta: buildMeta()
    });
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return jsonResponse<null>(400, {
      data: null,
      error: {
        code: "BAD_REQUEST",
        message: "Request body must be valid JSON."
      },
      meta: buildMeta()
    });
  }

  const parsedBody = createSwapSchema.safeParse(body);

  if (!parsedBody.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsedBody.error.issues[0]?.message ?? "Invalid shift swap payload."
      },
      meta: buildMeta()
    });
  }

  const supabase = await createSupabaseServerClient();

  const { data: rawShiftRow, error: shiftError } = await supabase
    .from("shifts")
    .select("id, employee_id, shift_date, start_time, end_time, status")
    .eq("id", parsedBody.data.shiftId)
    .eq("org_id", session.profile.org_id)
    .is("deleted_at", null)
    .maybeSingle();

  if (shiftError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "SHIFT_FETCH_FAILED",
        message: "Unable to load target shift."
      },
      meta: buildMeta()
    });
  }

  if (!rawShiftRow) {
    return jsonResponse<null>(404, {
      data: null,
      error: {
        code: "SHIFT_NOT_FOUND",
        message: "Target shift was not found."
      },
      meta: buildMeta()
    });
  }

  const parsedShiftRow = shiftRowSchema.safeParse(rawShiftRow);

  if (!parsedShiftRow.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "SHIFT_PARSE_FAILED",
        message: "Target shift data is not in the expected shape."
      },
      meta: buildMeta()
    });
  }

  const shift = parsedShiftRow.data;

  if (shift.employee_id !== session.profile.id) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "You can only request swaps for your own shifts."
      },
      meta: buildMeta()
    });
  }

  if (shift.status === "cancelled") {
    return jsonResponse<null>(409, {
      data: null,
      error: {
        code: "SHIFT_CANCELLED",
        message: "Cancelled shifts cannot be swapped."
      },
      meta: buildMeta()
    });
  }

  const { data: existingSwapRows, error: existingSwapError } = await supabase
    .from("shift_swaps")
    .select("id")
    .eq("org_id", session.profile.org_id)
    .eq("shift_id", shift.id)
    .eq("status", "pending")
    .is("deleted_at", null)
    .limit(1);

  if (existingSwapError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "SHIFT_SWAP_DUPLICATE_CHECK_FAILED",
        message: "Unable to validate existing swap requests."
      },
      meta: buildMeta()
    });
  }

  if ((existingSwapRows ?? []).length > 0) {
    return jsonResponse<null>(409, {
      data: null,
      error: {
        code: "SHIFT_SWAP_ALREADY_PENDING",
        message: "A pending swap request already exists for this shift."
      },
      meta: buildMeta()
    });
  }

  if (parsedBody.data.targetId) {
    const { data: rawTargetRows, error: targetError } = await supabase
      .from("shifts")
      .select("id, start_time, end_time")
      .eq("org_id", session.profile.org_id)
      .eq("employee_id", parsedBody.data.targetId)
      .eq("shift_date", shift.shift_date)
      .is("deleted_at", null)
      .neq("status", "cancelled");

    if (targetError) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "SHIFT_SWAP_TARGET_CONFLICT_CHECK_FAILED",
          message: "Unable to validate target availability."
        },
        meta: buildMeta()
      });
    }

    for (const targetRow of rawTargetRows ?? []) {
      const targetStart = typeof targetRow.start_time === "string" ? targetRow.start_time : null;
      const targetEnd = typeof targetRow.end_time === "string" ? targetRow.end_time : null;

      if (!targetStart || !targetEnd) {
        continue;
      }

      if (
        areTimeRangesOverlapping({
          startA: shift.start_time,
          endA: shift.end_time,
          startB: targetStart,
          endB: targetEnd
        })
      ) {
        return jsonResponse<null>(409, {
          data: null,
          error: {
            code: "SHIFT_SWAP_TARGET_CONFLICT",
            message: "Target employee has an overlapping shift."
          },
          meta: buildMeta()
        });
      }
    }
  }

  const { data: rawSwapRow, error: swapInsertError } = await supabase
    .from("shift_swaps")
    .insert({
      org_id: session.profile.org_id,
      shift_id: shift.id,
      requester_id: session.profile.id,
      target_id: parsedBody.data.targetId ?? null,
      reason: parsedBody.data.reason?.trim() || null,
      status: "pending"
    })
    .select(
      "id, org_id, shift_id, requester_id, target_id, reason, status, approved_by, approved_at, created_at, updated_at"
    )
    .single();

  if (swapInsertError || !rawSwapRow) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "SHIFT_SWAP_CREATE_FAILED",
        message: "Unable to create shift swap request."
      },
      meta: buildMeta()
    });
  }

  const parsedSwapRow = swapRowSchema.safeParse(rawSwapRow);

  if (!parsedSwapRow.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "SHIFT_SWAP_PARSE_FAILED",
        message: "Created swap data is not in the expected shape."
      },
      meta: buildMeta()
    });
  }

  const { error: shiftUpdateError } = await supabase
    .from("shifts")
    .update({
      status: "swap_requested"
    })
    .eq("id", shift.id)
    .eq("org_id", session.profile.org_id);

  if (shiftUpdateError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "SHIFT_SWAP_SHIFT_UPDATE_FAILED",
        message: "Swap request was created but shift status could not be updated."
      },
      meta: buildMeta()
    });
  }

  if (parsedBody.data.targetId) {
    void createNotification({
      orgId: session.profile.org_id,
      userId: parsedBody.data.targetId,
      type: "shift_swap_requested",
      title: "Shift swap request",
      body: `${session.profile.full_name} wants to swap their ${shift.shift_date} shift with yours.`,
      link: "/scheduling?tab=swaps"
    });
  } else {
    const { data: requesterProfile } = await supabase
      .from("profiles")
      .select("id, manager_id")
      .eq("org_id", session.profile.org_id)
      .eq("id", session.profile.id)
      .is("deleted_at", null)
      .maybeSingle();

    if (requesterProfile && typeof requesterProfile.manager_id === "string") {
      void createNotification({
        orgId: session.profile.org_id,
        userId: requesterProfile.manager_id,
        type: "shift_swap_requested",
        title: "Open shift swap request",
        body: `${session.profile.full_name} wants to swap their ${shift.shift_date} shift.`,
        link: "/scheduling?tab=swaps"
      });
    }
  }

  void logAudit({
    action: "submitted",
    tableName: "shift_swaps",
    recordId: parsedSwapRow.data.id,
    oldValue: null,
    newValue: {
      shift_id: parsedSwapRow.data.shift_id,
      requester_id: parsedSwapRow.data.requester_id,
      target_id: parsedSwapRow.data.target_id
    }
  });

  let createdSwap: ShiftSwapRecord;

  try {
    const mappedRows = await mapSwapRows({
      supabase,
      rows: [parsedSwapRow.data],
      orgId: session.profile.org_id
    });
    createdSwap = mappedRows[0] as ShiftSwapRecord;
  } catch {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "SHIFT_SWAP_METADATA_FAILED",
        message: "Unable to resolve created shift swap metadata."
      },
      meta: buildMeta()
    });
  }

  return jsonResponse<SchedulingSwapMutationResponseData>(201, {
    data: {
      swap: createdSwap
    },
    error: null,
    meta: buildMeta()
  });
}
