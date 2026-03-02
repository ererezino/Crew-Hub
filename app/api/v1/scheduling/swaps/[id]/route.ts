import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../../lib/auth/session";
import { logAudit } from "../../../../../../lib/audit";
import { createNotification } from "../../../../../../lib/notifications/service";
import {
  areTimeRangesOverlapping,
  isSchedulingManager
} from "../../../../../../lib/scheduling";
import { createSupabaseServerClient } from "../../../../../../lib/supabase/server";
import type { ApiResponse } from "../../../../../../types/auth";
import {
  SHIFT_SWAP_STATUSES,
  type SchedulingSwapMutationResponseData,
  type ShiftSwapRecord
} from "../../../../../../types/scheduling";

const updateSwapSchema = z.object({
  action: z.enum(["accept", "reject", "cancel", "approve"]),
  reason: z.string().trim().max(500).optional()
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
  org_id: z.string().uuid(),
  employee_id: z.string().uuid().nullable(),
  shift_date: z.string(),
  start_time: z.string(),
  end_time: z.string(),
  status: z.string()
});

const profileRowSchema = z.object({
  id: z.string().uuid(),
  full_name: z.string()
});

function buildMeta() {
  return { timestamp: new Date().toISOString() };
}

function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return NextResponse.json(payload, { status });
}

async function mapSwap({
  supabase,
  row,
  orgId
}: {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  row: z.infer<typeof swapRowSchema>;
  orgId: string;
}): Promise<ShiftSwapRecord> {
  const [shiftResult, profileResult] = await Promise.all([
    supabase
      .from("shifts")
      .select("id, shift_date, start_time, end_time")
      .eq("org_id", orgId)
      .is("deleted_at", null)
      .eq("id", row.shift_id)
      .maybeSingle(),
    supabase
      .from("profiles")
      .select("id, full_name")
      .eq("org_id", orgId)
      .is("deleted_at", null)
      .in(
        "id",
        [...new Set([row.requester_id, row.target_id, row.approved_by].filter((value): value is string => Boolean(value)))]
      )
  ]);

  if (shiftResult.error || profileResult.error) {
    throw new Error("Unable to resolve swap metadata.");
  }

  const shiftRow = shiftResult.data
    ? z
        .object({
          id: z.string().uuid(),
          shift_date: z.string(),
          start_time: z.string(),
          end_time: z.string()
        })
        .safeParse(shiftResult.data)
    : null;
  const profileRows = z.array(profileRowSchema).safeParse(profileResult.data ?? []);

  if ((shiftRow && !shiftRow.success) || !profileRows.success) {
    throw new Error("Swap metadata is not in the expected shape.");
  }

  const profileNameById = new Map(
    profileRows.data.map((profileRow) => [profileRow.id, profileRow.full_name] as const)
  );

  return {
    id: row.id,
    orgId: row.org_id,
    shiftId: row.shift_id,
    shiftDate: shiftRow?.success ? shiftRow.data.shift_date : "",
    shiftStartTime: shiftRow?.success ? shiftRow.data.start_time : "",
    shiftEndTime: shiftRow?.success ? shiftRow.data.end_time : "",
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
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to update shift swaps."
      },
      meta: buildMeta()
    });
  }

  const params = await context.params;
  const swapId = params.id;

  if (!z.string().uuid().safeParse(swapId).success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: "Swap id must be a valid UUID."
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

  const parsedBody = updateSwapSchema.safeParse(body);

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

  const action = parsedBody.data.action;
  const isManager = isSchedulingManager(session.profile.roles);
  const supabase = await createSupabaseServerClient();

  const { data: rawSwapRow, error: swapError } = await supabase
    .from("shift_swaps")
    .select(
      "id, org_id, shift_id, requester_id, target_id, reason, status, approved_by, approved_at, created_at, updated_at"
    )
    .eq("id", swapId)
    .eq("org_id", session.profile.org_id)
    .is("deleted_at", null)
    .maybeSingle();

  if (swapError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "SHIFT_SWAP_FETCH_FAILED",
        message: "Unable to load shift swap request."
      },
      meta: buildMeta()
    });
  }

  if (!rawSwapRow) {
    return jsonResponse<null>(404, {
      data: null,
      error: {
        code: "SHIFT_SWAP_NOT_FOUND",
        message: "Shift swap request was not found."
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
        message: "Shift swap data is not in the expected shape."
      },
      meta: buildMeta()
    });
  }

  const swap = parsedSwapRow.data;
  const isRequester = swap.requester_id === session.profile.id;
  const isTarget = swap.target_id === session.profile.id;

  if (swap.status === "cancelled" || swap.status === "rejected") {
    return jsonResponse<null>(409, {
      data: null,
      error: {
        code: "SHIFT_SWAP_FINALIZED",
        message: "This swap request has already been finalized."
      },
      meta: buildMeta()
    });
  }

  const { data: rawShiftRow, error: shiftError } = await supabase
    .from("shifts")
    .select("id, org_id, employee_id, shift_date, start_time, end_time, status")
    .eq("id", swap.shift_id)
    .eq("org_id", session.profile.org_id)
    .is("deleted_at", null)
    .maybeSingle();

  if (shiftError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "SHIFT_FETCH_FAILED",
        message: "Unable to load linked shift."
      },
      meta: buildMeta()
    });
  }

  if (!rawShiftRow) {
    return jsonResponse<null>(404, {
      data: null,
      error: {
        code: "SHIFT_NOT_FOUND",
        message: "Linked shift was not found."
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
        message: "Linked shift data is not in the expected shape."
      },
      meta: buildMeta()
    });
  }

  const shift = parsedShiftRow.data;
  const requiresTargetApproval = action === "accept" || action === "approve";

  if (requiresTargetApproval && !swap.target_id) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "SHIFT_SWAP_TARGET_REQUIRED",
        message: "A specific target employee is required for approval."
      },
      meta: buildMeta()
    });
  }

  if (action === "cancel" && !isRequester) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "Only the requester can cancel this swap."
      },
      meta: buildMeta()
    });
  }

  if (action === "reject" && !(isTarget || isManager)) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "Only the target employee or a manager can reject this swap."
      },
      meta: buildMeta()
    });
  }

  if (action === "accept" && !(isTarget || isManager)) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "Only the target employee or a manager can accept this swap."
      },
      meta: buildMeta()
    });
  }

  if (action === "approve" && !isManager) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "Only managers and admins can approve shift swaps."
      },
      meta: buildMeta()
    });
  }

  let nextStatus: ShiftSwapRecord["status"] = swap.status;
  let nextApprovedBy: string | null = swap.approved_by;
  let nextApprovedAt: string | null = swap.approved_at;
  let shouldTransferShift = false;
  let shiftStatusOverride: string | null = null;

  if (action === "cancel") {
    nextStatus = "cancelled";
    shiftStatusOverride = "scheduled";
  } else if (action === "reject") {
    nextStatus = "rejected";
    shiftStatusOverride = "scheduled";
  } else if (action === "accept") {
    nextStatus = "accepted";

    if (isManager) {
      nextApprovedBy = session.profile.id;
      nextApprovedAt = new Date().toISOString();
      shouldTransferShift = true;
      shiftStatusOverride = "swapped";
    }
  } else if (action === "approve") {
    if (swap.status !== "accepted" && swap.status !== "pending") {
      return jsonResponse<null>(409, {
        data: null,
        error: {
          code: "SHIFT_SWAP_INVALID_STATE",
          message: "Only pending or accepted swaps can be approved."
        },
        meta: buildMeta()
      });
    }

    nextStatus = "accepted";
    nextApprovedBy = session.profile.id;
    nextApprovedAt = new Date().toISOString();
    shouldTransferShift = true;
    shiftStatusOverride = "swapped";
  }

  if (shouldTransferShift && swap.target_id) {
    const { data: targetShiftsRows, error: targetShiftsError } = await supabase
      .from("shifts")
      .select("id, start_time, end_time")
      .eq("org_id", session.profile.org_id)
      .eq("employee_id", swap.target_id)
      .eq("shift_date", shift.shift_date)
      .is("deleted_at", null)
      .neq("status", "cancelled")
      .neq("id", shift.id);

    if (targetShiftsError) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "SHIFT_SWAP_TARGET_CONFLICT_CHECK_FAILED",
          message: "Unable to validate target shift conflicts."
        },
        meta: buildMeta()
      });
    }

    for (const targetShiftRow of targetShiftsRows ?? []) {
      const targetStart =
        typeof targetShiftRow.start_time === "string" ? targetShiftRow.start_time : null;
      const targetEnd = typeof targetShiftRow.end_time === "string" ? targetShiftRow.end_time : null;

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

    const { error: shiftUpdateError } = await supabase
      .from("shifts")
      .update({
        employee_id: swap.target_id,
        status: shiftStatusOverride ?? "swapped",
        notes:
          parsedBody.data.reason?.trim() && parsedBody.data.reason.trim().length > 0
            ? [shift.status === "swap_requested" ? null : shift.status, `Swap: ${parsedBody.data.reason.trim()}`]
                .filter(Boolean)
                .join("\n")
            : undefined
      })
      .eq("id", shift.id)
      .eq("org_id", session.profile.org_id);

    if (shiftUpdateError) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "SHIFT_SWAP_SHIFT_UPDATE_FAILED",
          message: "Unable to assign shift to target employee."
        },
        meta: buildMeta()
      });
    }
  } else if (shiftStatusOverride) {
    const { error: shiftResetError } = await supabase
      .from("shifts")
      .update({
        status: shiftStatusOverride
      })
      .eq("id", shift.id)
      .eq("org_id", session.profile.org_id);

    if (shiftResetError) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "SHIFT_SWAP_SHIFT_RESET_FAILED",
          message: "Unable to reset shift status."
        },
        meta: buildMeta()
      });
    }
  }

  const { data: rawUpdatedSwap, error: updateSwapError } = await supabase
    .from("shift_swaps")
    .update({
      status: nextStatus,
      approved_by: nextApprovedBy,
      approved_at: nextApprovedAt
    })
    .eq("id", swap.id)
    .eq("org_id", session.profile.org_id)
    .select(
      "id, org_id, shift_id, requester_id, target_id, reason, status, approved_by, approved_at, created_at, updated_at"
    )
    .single();

  if (updateSwapError || !rawUpdatedSwap) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "SHIFT_SWAP_UPDATE_FAILED",
        message: "Unable to update shift swap request."
      },
      meta: buildMeta()
    });
  }

  const parsedUpdatedSwap = swapRowSchema.safeParse(rawUpdatedSwap);

  if (!parsedUpdatedSwap.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "SHIFT_SWAP_UPDATED_PARSE_FAILED",
        message: "Updated swap data is not in the expected shape."
      },
      meta: buildMeta()
    });
  }

  let updatedSwap: ShiftSwapRecord;

  try {
    updatedSwap = await mapSwap({
      supabase,
      row: parsedUpdatedSwap.data,
      orgId: session.profile.org_id
    });
  } catch {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "SHIFT_SWAP_METADATA_FAILED",
        message: "Unable to resolve updated shift swap metadata."
      },
      meta: buildMeta()
    });
  }

  const targetNotificationUserId = swap.requester_id === session.profile.id ? swap.target_id : swap.requester_id;

  if (targetNotificationUserId) {
    void createNotification({
      orgId: session.profile.org_id,
      userId: targetNotificationUserId,
      type: "shift_swap_updated",
      title: "Shift swap updated",
      body: `${session.profile.full_name} ${action}ed a shift swap request.`,
      link: "/scheduling/swaps"
    });
  }

  void logAudit({
    action: "updated",
    tableName: "shift_swaps",
    recordId: swap.id,
    oldValue: {
      status: swap.status,
      approved_by: swap.approved_by
    },
    newValue: {
      status: parsedUpdatedSwap.data.status,
      approved_by: parsedUpdatedSwap.data.approved_by
    }
  });

  return jsonResponse<SchedulingSwapMutationResponseData>(200, {
    data: {
      swap: updatedSwap
    },
    error: null,
    meta: buildMeta()
  });
}
