import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../../../../../lib/auth/session";
import { logAudit } from "../../../../../../../../../lib/audit";
import { logger } from "../../../../../../../../../lib/logger";
import { hasRole } from "../../../../../../../../../lib/roles";
import { createSupabaseServerClient } from "../../../../../../../../../lib/supabase/server";
import { createSupabaseServiceRoleClient } from "../../../../../../../../../lib/supabase/service-role";
import type { ApiResponse } from "../../../../../../../../../types/auth";

const paramsSchema = z.object({
  instanceId: z.string().uuid(),
  taskId: z.string().uuid()
});

const bodySchema = z.object({
  action: z.enum(["complete", "undo"])
});

function buildMeta() {
  return { timestamp: new Date().toISOString() };
}

function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return NextResponse.json(payload, { status });
}

type RouteContext = {
  params: Promise<{ instanceId: string; taskId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: { code: "UNAUTHORIZED", message: "You must be logged in." },
      meta: buildMeta()
    });
  }

  const profile = session.profile;
  const parsedParams = paramsSchema.safeParse(await context.params);

  if (!parsedParams.success) {
    return jsonResponse<null>(400, {
      data: null,
      error: { code: "BAD_REQUEST", message: "Invalid instance or task ID." },
      meta: buildMeta()
    });
  }

  const { instanceId, taskId } = parsedParams.data;

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

  const parsedBody = bodySchema.safeParse(body);

  if (!parsedBody.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: { code: "VALIDATION_ERROR", message: "Action must be 'complete' or 'undo'." },
      meta: buildMeta()
    });
  }

  const { action } = parsedBody.data;
  const isAdmin = hasRole(profile.roles, "HR_ADMIN") || hasRole(profile.roles, "SUPER_ADMIN");

  const supabase = await createSupabaseServerClient();

  // Fetch task + instance in parallel
  const [taskResult, instanceResult] = await Promise.all([
    supabase
      .from("onboarding_tasks")
      .select("id, instance_id, title, task_type, status, assigned_to, completed_by")
      .eq("id", taskId)
      .eq("instance_id", instanceId)
      .eq("org_id", profile.org_id)
      .is("deleted_at", null)
      .single(),
    supabase
      .from("onboarding_instances")
      .select("id, employee_id, status, type")
      .eq("id", instanceId)
      .eq("org_id", profile.org_id)
      .is("deleted_at", null)
      .single()
  ]);

  if (taskResult.error || !taskResult.data) {
    return jsonResponse<null>(404, {
      data: null,
      error: { code: "NOT_FOUND", message: "Task not found." },
      meta: buildMeta()
    });
  }

  if (instanceResult.error || !instanceResult.data) {
    return jsonResponse<null>(404, {
      data: null,
      error: { code: "NOT_FOUND", message: "Onboarding instance not found." },
      meta: buildMeta()
    });
  }

  const task = taskResult.data;
  const instance = instanceResult.data;

  // Reject e_signature tasks — they can only be completed by signing the document
  if (task.task_type === "e_signature") {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "E_SIGNATURE_ONLY",
        message: "E-signature tasks can only be completed by signing the document."
      },
      meta: buildMeta()
    });
  }

  // Permission: employee can complete tasks assigned to them, cannot undo
  if (!isAdmin) {
    if (task.assigned_to !== profile.id) {
      return jsonResponse<null>(403, {
        data: null,
        error: { code: "FORBIDDEN", message: "You can only complete tasks assigned to you." },
        meta: buildMeta()
      });
    }

    if (action === "undo") {
      return jsonResponse<null>(403, {
        data: null,
        error: { code: "FORBIDDEN", message: "Only administrators can undo task completion." },
        meta: buildMeta()
      });
    }

    if (task.status === "completed") {
      return jsonResponse<null>(422, {
        data: null,
        error: { code: "ALREADY_COMPLETED", message: "This task is already completed." },
        meta: buildMeta()
      });
    }
  }

  // Perform the update
  const serviceClient = createSupabaseServiceRoleClient();

  if (action === "complete") {
    const { error: updateError } = await serviceClient
      .from("onboarding_tasks")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        completed_by: profile.id
      })
      .eq("id", taskId)
      .eq("org_id", profile.org_id);

    if (updateError) {
      logger.error("Failed to complete onboarding task.", { error: updateError.message, taskId });
      return jsonResponse<null>(500, {
        data: null,
        error: { code: "UPDATE_FAILED", message: "Unable to complete task." },
        meta: buildMeta()
      });
    }
  } else {
    // undo — admin only (already checked above)
    const { error: updateError } = await serviceClient
      .from("onboarding_tasks")
      .update({
        status: "pending",
        completed_at: null,
        completed_by: null
      })
      .eq("id", taskId)
      .eq("org_id", profile.org_id);

    if (updateError) {
      logger.error("Failed to undo onboarding task.", { error: updateError.message, taskId });
      return jsonResponse<null>(500, {
        data: null,
        error: { code: "UPDATE_FAILED", message: "Unable to undo task completion." },
        meta: buildMeta()
      });
    }
  }

  // Recompute progress: check if all tasks in this instance are completed
  const { data: allTasks, error: tasksError } = await serviceClient
    .from("onboarding_tasks")
    .select("id, status")
    .eq("instance_id", instanceId)
    .eq("org_id", profile.org_id)
    .is("deleted_at", null);

  if (tasksError || !allTasks) {
    logger.error("Failed to fetch tasks for progress recompute.", { error: tasksError?.message });
    // Non-critical — task is already updated, return success
    return jsonResponse<{ taskId: string; action: string }>(200, {
      data: { taskId, action },
      error: null,
      meta: buildMeta()
    });
  }

  const totalTasks = allTasks.length;
  const completedTasks = allTasks.filter((t) => t.status === "completed").length;
  const allDone = totalTasks > 0 && completedTasks === totalTasks;

  if (allDone && action === "complete") {
    // Mark instance as completed
    const { error: instanceUpdateError } = await serviceClient
      .from("onboarding_instances")
      .update({
        status: "completed",
        completed_at: new Date().toISOString()
      })
      .eq("id", instanceId)
      .eq("org_id", profile.org_id);

    if (instanceUpdateError) {
      logger.error("Failed to mark instance as completed.", { error: instanceUpdateError.message });
    }

    // Auto-transition employee from onboarding to active
    if (instance.type === "onboarding") {
      const { error: profileUpdateError } = await serviceClient
        .from("profiles")
        .update({ status: "active" })
        .eq("id", instance.employee_id)
        .eq("org_id", profile.org_id)
        .eq("status", "onboarding");

      if (profileUpdateError) {
        logger.error("Failed to transition employee to active.", {
          error: profileUpdateError.message,
          employeeId: instance.employee_id
        });
      } else {
        logger.info("Employee transitioned to active after onboarding completion.", {
          employeeId: instance.employee_id,
          instanceId
        });

        await logAudit({
          action: "updated",
          tableName: "profiles",
          recordId: instance.employee_id,
          oldValue: { status: "onboarding" },
          newValue: { status: "active" }
        });
      }
    }
  } else if (action === "undo" && instance.status === "completed") {
    // Reopen instance if undoing a task in a completed instance
    await serviceClient
      .from("onboarding_instances")
      .update({
        status: "active",
        completed_at: null
      })
      .eq("id", instanceId)
      .eq("org_id", profile.org_id);
  }

  return jsonResponse<{ taskId: string; action: string; totalTasks: number; completedTasks: number }>(200, {
    data: { taskId, action, totalTasks, completedTasks: action === "complete" ? completedTasks : completedTasks },
    error: null,
    meta: buildMeta()
  });
}
