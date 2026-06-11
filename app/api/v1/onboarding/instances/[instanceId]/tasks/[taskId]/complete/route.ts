import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../../../../../lib/auth/session";
import { diffAuditValues, logAudit } from "../../../../../../../../../lib/audit";
import { logger } from "../../../../../../../../../lib/logger";
import { createNotification } from "../../../../../../../../../lib/notifications/service";
import { completeOnboarding, completeOffboarding } from "../../../../../../../../../lib/onboarding/auto-transition";
import {
  findReblockableTasks,
  findUnlockableTasks
} from "../../../../../../../../../lib/onboarding/task-dependencies";
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
      .select("id, instance_id, title, task_type, status, assigned_to, completed_by, depends_on_task_ids")
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

  // Dependency enforcement: a task with prerequisites cannot be completed
  // until every task in depends_on_task_ids is completed. This applies to
  // admins too. A 'blocked' task whose prerequisites are in fact all complete
  // (e.g. a previously missed unlock pass) is allowed through.
  if (action === "complete") {
    const dependsOnTaskIds: string[] = Array.isArray(task.depends_on_task_ids)
      ? task.depends_on_task_ids
      : [];

    if (dependsOnTaskIds.length > 0) {
      const { data: prerequisiteTasks, error: prerequisiteError } = await supabase
        .from("onboarding_tasks")
        .select("id, title, status")
        .in("id", dependsOnTaskIds)
        .eq("org_id", profile.org_id)
        .is("deleted_at", null);

      if (prerequisiteError) {
        logger.error("Failed to check onboarding task prerequisites.", {
          error: prerequisiteError.message,
          taskId
        });
        return jsonResponse<null>(500, {
          data: null,
          error: { code: "DEPENDENCY_CHECK_FAILED", message: "Unable to verify task prerequisites." },
          meta: buildMeta()
        });
      }

      const incompletePrerequisites = (prerequisiteTasks ?? []).filter(
        (prerequisite) => prerequisite.status !== "completed"
      );

      if (incompletePrerequisites.length > 0) {
        const blockingTitles = incompletePrerequisites
          .map((prerequisite) => `"${prerequisite.title}"`)
          .join(", ");

        return jsonResponse<null>(422, {
          data: null,
          error: {
            code: "DEPENDENCIES_NOT_MET",
            message: `This task is blocked until the following prerequisite task(s) are completed: ${blockingTitles}.`
          },
          meta: buildMeta()
        });
      }
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

  // Fetch all sibling tasks once: used for the dependency unlock/re-block
  // pass and for the per-track progress recompute below.
  const { data: allTasks, error: tasksError } = await serviceClient
    .from("onboarding_tasks")
    .select("id, status, track, title, assigned_to, depends_on_task_ids")
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

  if (action === "complete") {
    // Unlock pass: flip 'blocked' → 'pending' for every task whose
    // prerequisites are now all completed (self-healing: not limited to
    // direct dependents of the task that just completed).
    const unlockableTasks = findUnlockableTasks(allTasks);

    for (const unlockableTask of unlockableTasks) {
      const { error: unlockError } = await serviceClient
        .from("onboarding_tasks")
        .update({ status: "pending" })
        .eq("id", unlockableTask.id)
        .eq("org_id", profile.org_id);

      if (unlockError) {
        logger.error("Failed to unlock dependent onboarding task.", {
          error: unlockError.message,
          taskId: unlockableTask.id
        });
        continue;
      }

      unlockableTask.status = "pending";

      const { oldValue, newValue } = diffAuditValues(
        { status: "blocked" },
        { status: "pending" }
      );

      await logAudit({
        action: "updated",
        tableName: "onboarding_tasks",
        recordId: unlockableTask.id,
        oldValue,
        newValue
      });

      if (unlockableTask.assigned_to) {
        await createNotification({
          orgId: profile.org_id,
          userId: unlockableTask.assigned_to,
          type: "onboarding_task",
          title: `Task unlocked: ${unlockableTask.title}`,
          body: "All prerequisite tasks are complete. This task is now ready to start.",
          link: `/onboarding/${instanceId}`
        });
      }
    }
  } else {
    // Reopen (undo) pass: re-block direct dependents that are still 'pending'
    // — their prerequisites are no longer all met.
    const reblockableTasks = findReblockableTasks(allTasks, taskId);

    for (const reblockableTask of reblockableTasks) {
      const { error: reblockError } = await serviceClient
        .from("onboarding_tasks")
        .update({ status: "blocked" })
        .eq("id", reblockableTask.id)
        .eq("org_id", profile.org_id);

      if (reblockError) {
        logger.error("Failed to re-block dependent onboarding task.", {
          error: reblockError.message,
          taskId: reblockableTask.id
        });
        continue;
      }

      reblockableTask.status = "blocked";

      const { oldValue, newValue } = diffAuditValues(
        { status: "pending" },
        { status: "blocked" }
      );

      await logAudit({
        action: "updated",
        tableName: "onboarding_tasks",
        recordId: reblockableTask.id,
        oldValue,
        newValue
      });
    }
  }

  const totalTasks = allTasks.length;
  const completedTasks = allTasks.filter((t) => t.status === "completed").length;

  // Per-track completion check: both employee AND operations tracks must be 100%
  const employeeTasks = allTasks.filter((t) => t.track === "employee");
  const opsTasks = allTasks.filter((t) => t.track === "operations");
  const employeeDone = employeeTasks.length === 0 || employeeTasks.every((t) => t.status === "completed");
  const opsDone = opsTasks.length === 0 || opsTasks.every((t) => t.status === "completed");
  const allDone = totalTasks > 0 && employeeDone && opsDone;

  let awaitingLastDay = false;

  if (allDone && action === "complete") {
    if (instance.type === "onboarding") {
      await completeOnboarding({
        supabase: serviceClient,
        orgId: profile.org_id,
        instanceId,
        employeeId: instance.employee_id
      });
    } else if (instance.type === "offboarding") {
      // Two-gate: all tasks done AND today >= last working day
      const { data: employeeProfile } = await serviceClient
        .from("profiles")
        .select("notice_period_end_date, full_name")
        .eq("id", instance.employee_id)
        .eq("org_id", profile.org_id)
        .maybeSingle();

      const today = new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" });
      const lastDay = employeeProfile?.notice_period_end_date;

      if (lastDay && today >= lastDay) {
        await completeOffboarding({
          supabase: serviceClient,
          orgId: profile.org_id,
          instanceId,
          employeeId: instance.employee_id,
          employeeName: employeeProfile?.full_name
        });
      } else {
        // Tasks complete but date gate not met — instance stays active
        awaitingLastDay = true;
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

  return jsonResponse<{ taskId: string; action: string; totalTasks: number; completedTasks: number; allTasksComplete: boolean; awaitingLastDay: boolean }>(200, {
    data: { taskId, action, totalTasks, completedTasks, allTasksComplete: allDone && action === "complete", awaitingLastDay },
    error: null,
    meta: buildMeta()
  });
}
