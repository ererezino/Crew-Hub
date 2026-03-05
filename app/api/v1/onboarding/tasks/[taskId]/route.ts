import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../../lib/auth/session";
import { hasRole } from "../../../../../../lib/roles";
import { createSupabaseServerClient } from "../../../../../../lib/supabase/server";
import type { ApiResponse } from "../../../../../../types/auth";
import { ONBOARDING_TASK_STATUSES } from "../../../../../../types/onboarding";

/* ── Helpers ── */

function buildMeta() {
  return { timestamp: new Date().toISOString() };
}

function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return NextResponse.json(payload, { status });
}

/* ── Schemas ── */

const paramsSchema = z.object({
  taskId: z.string().uuid()
});

const patchBodySchema = z.object({
  status: z.enum(ONBOARDING_TASK_STATUSES),
  notes: z.string().max(2000).optional()
});

/* ── PATCH /api/v1/onboarding/tasks/:taskId ── */

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ taskId: string }> }
) {
  try {
    const session = await getAuthenticatedSession();

    if (!session?.profile) {
      return jsonResponse<null>(401, {
        data: null,
        error: { code: "UNAUTHORIZED", message: "Authentication required." },
        meta: buildMeta()
      });
    }

    const profile = session.profile;
    const parsedParams = paramsSchema.safeParse(await context.params);

    if (!parsedParams.success) {
      return jsonResponse<null>(400, {
        data: null,
        error: { code: "INVALID_PARAMS", message: "Invalid task id." },
        meta: buildMeta()
      });
    }

    const { taskId } = parsedParams.data;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonResponse<null>(400, {
        data: null,
        error: { code: "INVALID_BODY", message: "Request body must be valid JSON." },
        meta: buildMeta()
      });
    }

    const parsedBody = patchBodySchema.safeParse(body);

    if (!parsedBody.success) {
      return jsonResponse<null>(400, {
        data: null,
        error: {
          code: "VALIDATION_ERROR",
          message: parsedBody.error.issues.map((i) => i.message).join("; ")
        },
        meta: buildMeta()
      });
    }

    const supabase = await createSupabaseServerClient();

    // Fetch the task with its instance to verify ownership
    const { data: task, error: taskError } = await supabase
      .from("onboarding_tasks")
      .select("id, instance_id, status, assigned_to")
      .eq("id", taskId)
      .eq("org_id", profile.org_id)
      .is("deleted_at", null)
      .single();

    if (taskError || !task) {
      return jsonResponse<null>(404, {
        data: null,
        error: { code: "NOT_FOUND", message: "Onboarding task not found." },
        meta: buildMeta()
      });
    }

    // Verify the instance belongs to this employee or user is admin
    const { data: instance } = await supabase
      .from("onboarding_instances")
      .select("employee_id")
      .eq("id", task.instance_id)
      .single();

    const isOwner = instance?.employee_id === profile.id;
    const isAssignee = task.assigned_to === profile.id;
    const isAdmin =
      hasRole(profile.roles, "HR_ADMIN") ||
      hasRole(profile.roles, "SUPER_ADMIN");

    if (!isOwner && !isAssignee && !isAdmin) {
      return jsonResponse<null>(403, {
        data: null,
        error: { code: "FORBIDDEN", message: "You cannot update this task." },
        meta: buildMeta()
      });
    }

    // Build update payload
    const updatePayload: Record<string, unknown> = {
      status: parsedBody.data.status
    };

    if (parsedBody.data.notes !== undefined) {
      updatePayload.notes = parsedBody.data.notes;
    }

    const newStatus = parsedBody.data.status;
    if (newStatus === "completed") {
      updatePayload.completed_at = new Date().toISOString();
      updatePayload.completed_by = profile.id;
    } else if (task.status === "completed") {
      // Un-completing: clear completion fields
      updatePayload.completed_at = null;
      updatePayload.completed_by = null;
    }

    const { error: updateError } = await supabase
      .from("onboarding_tasks")
      .update(updatePayload)
      .eq("id", taskId);

    if (updateError) {
      return jsonResponse<null>(500, {
        data: null,
        error: { code: "UPDATE_FAILED", message: "Unable to update onboarding task." },
        meta: buildMeta()
      });
    }

    return jsonResponse<{ taskId: string; status: string }>(200, {
      data: { taskId, status: parsedBody.data.status },
      error: null,
      meta: buildMeta()
    });
  } catch (error) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "INTERNAL_ERROR",
        message: error instanceof Error ? error.message : "Unexpected error."
      },
      meta: buildMeta()
    });
  }
}
