import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../../lib/auth/session";
import { createNotification } from "../../../../../../lib/notifications/service";
import { hasRole } from "../../../../../../lib/roles";
import { createSupabaseServerClient } from "../../../../../../lib/supabase/server";
import type { ApiResponse } from "../../../../../../types/auth";
import {
  ONBOARDING_INSTANCE_STATUSES,
  ONBOARDING_TASK_STATUSES,
  ONBOARDING_TYPES,
  type OnboardingInstanceDetailResponseData,
  type OnboardingInstanceSummary,
  type OnboardingTask
} from "../../../../../../types/onboarding";

const paramsSchema = z.object({
  instanceId: z.string().uuid()
});

const instanceRowSchema = z.object({
  id: z.string().uuid(),
  employee_id: z.string().uuid(),
  template_id: z.string().uuid().nullable(),
  type: z.enum(ONBOARDING_TYPES),
  status: z.enum(ONBOARDING_INSTANCE_STATUSES),
  started_at: z.string(),
  completed_at: z.string().nullable()
});

const TASK_TYPE_VALUES = ["manual", "e_signature", "link", "form"] as const;

const taskRowSchema = z.object({
  id: z.string().uuid(),
  instance_id: z.string().uuid(),
  template_task_id: z.string().uuid().nullable().default(null),
  title: z.string(),
  description: z.string().nullable(),
  category: z.string(),
  track: z.string().default("employee"),
  section_id: z.string().nullable().default(null),
  status: z.enum(ONBOARDING_TASK_STATUSES),
  task_type: z.enum(TASK_TYPE_VALUES).default("manual"),
  assigned_to: z.string().uuid().nullable(),
  due_date: z.string().nullable(),
  completed_at: z.string().nullable(),
  completed_by: z.string().uuid().nullable(),
  notes: z.string().nullable(),
  document_id: z.string().uuid().nullable().default(null),
  signature_request_id: z.string().uuid().nullable().default(null),
  action_url: z.string().nullable().default(null),
  action_label: z.string().nullable().default(null),
  completion_guidance: z.string().nullable().default(null)
});

const profileRowSchema = z.object({
  id: z.string().uuid(),
  full_name: z.string()
});

const templateRowSchema = z.object({
  id: z.string().uuid(),
  name: z.string()
});

function buildMeta() {
  return {
    timestamp: new Date().toISOString()
  };
}

function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return NextResponse.json(payload, { status });
}

function toProgressPercent(completedTasks: number, totalTasks: number): number {
  if (totalTasks <= 0) {
    return 0;
  }

  return Math.round((completedTasks / totalTasks) * 100);
}

function dueSoon(dueDate: string | null): boolean {
  if (!dueDate) {
    return false;
  }

  const due = new Date(`${dueDate}T00:00:00.000Z`);
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  if (Number.isNaN(due.getTime())) {
    return false;
  }

  const limit = new Date(today);
  limit.setUTCDate(limit.getUTCDate() + 2);

  return due.getTime() <= limit.getTime();
}

type RouteContext = {
  params: Promise<{ instanceId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to view onboarding details."
      },
      meta: buildMeta()
    });
  }

  const profile = session.profile;

  const parsedParams = paramsSchema.safeParse(await context.params);

  if (!parsedParams.success) {
    return jsonResponse<null>(400, {
      data: null,
      error: {
        code: "BAD_REQUEST",
        message: "Onboarding instance id must be a valid UUID."
      },
      meta: buildMeta()
    });
  }

  const supabase = await createSupabaseServerClient();
  const instanceId = parsedParams.data.instanceId;

  const { data: rawInstance, error: instanceError } = await supabase
    .from("onboarding_instances")
    .select("id, employee_id, template_id, type, status, started_at, completed_at")
    .eq("id", instanceId)
    .eq("org_id", profile.org_id)
    .is("deleted_at", null)
    .maybeSingle();

  if (instanceError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "INSTANCE_FETCH_FAILED",
        message: "Unable to load onboarding instance."
      },
      meta: buildMeta()
    });
  }

  const parsedInstance = instanceRowSchema.safeParse(rawInstance);

  if (!parsedInstance.success) {
    return jsonResponse<null>(404, {
      data: null,
      error: {
        code: "NOT_FOUND",
        message: "Onboarding instance not found."
      },
      meta: buildMeta()
    });
  }

  const instance = parsedInstance.data;

  // ── Object-level authorization ──────────────────────────────────────
  // HR_ADMIN / SUPER_ADMIN: full access (org_id already filtered above)
  // MANAGER: own instance OR direct reports' instances
  // Everyone else (EMPLOYEE, TEAM_LEAD, FINANCE_ADMIN): own instance only
  const isHrOrSuperAdmin =
    hasRole(profile.roles, "HR_ADMIN") || hasRole(profile.roles, "SUPER_ADMIN");

  if (!isHrOrSuperAdmin) {
    const isOwnInstance = instance.employee_id === profile.id;

    if (!isOwnInstance) {
      // Check if caller is a MANAGER and the instance employee is their direct report
      let isDirectReport = false;

      if (hasRole(profile.roles, "MANAGER")) {
        const { data: employeeProfile } = await supabase
          .from("profiles")
          .select("manager_id")
          .eq("id", instance.employee_id)
          .eq("org_id", profile.org_id)
          .is("deleted_at", null)
          .maybeSingle();

        isDirectReport = employeeProfile?.manager_id === profile.id;
      }

      if (!isDirectReport) {
        return jsonResponse<null>(403, {
          data: null,
          error: {
            code: "FORBIDDEN",
            message: "You do not have permission to view this onboarding instance."
          },
          meta: buildMeta()
        });
      }
    }
  }

  const { data: rawTasks, error: tasksError } = await supabase
    .from("onboarding_tasks")
    .select(
      "id, instance_id, template_task_id, title, description, category, track, section_id, status, task_type, assigned_to, due_date, completed_at, completed_by, notes, document_id, signature_request_id, action_url, action_label, completion_guidance"
    )
    .eq("instance_id", instance.id)
    .eq("org_id", profile.org_id)
    .is("deleted_at", null)
    .order("due_date", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });

  if (tasksError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "TASKS_FETCH_FAILED",
        message: "Unable to load onboarding tasks."
      },
      meta: buildMeta()
    });
  }

  const parsedTasks = z.array(taskRowSchema).safeParse(rawTasks ?? []);

  if (!parsedTasks.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "TASKS_PARSE_FAILED",
        message: "Onboarding task data is not in the expected shape."
      },
      meta: buildMeta()
    });
  }

  const tasksRows = parsedTasks.data;

  const profileIds = [
    instance.employee_id,
    ...tasksRows
      .flatMap((task) => [task.assigned_to, task.completed_by])
      .filter((value): value is string => Boolean(value))
  ];

  const uniqueProfileIds = [...new Set(profileIds)];

  const [{ data: rawProfiles, error: profilesError }, { data: rawTemplate, error: templateError }] =
    await Promise.all([
      uniqueProfileIds.length > 0
        ? supabase
            .from("profiles")
            .select("id, full_name")
            .eq("org_id", profile.org_id)
            .is("deleted_at", null)
            .in("id", uniqueProfileIds)
        : Promise.resolve({ data: [], error: null }),
      instance.template_id
        ? supabase
            .from("onboarding_templates")
            .select("id, name")
            .eq("id", instance.template_id)
            .is("deleted_at", null)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null })
    ]);

  if (profilesError || templateError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "INSTANCE_METADATA_FETCH_FAILED",
        message: "Unable to resolve onboarding metadata."
      },
      meta: buildMeta()
    });
  }

  const parsedProfiles = z.array(profileRowSchema).safeParse(rawProfiles ?? []);

  if (!parsedProfiles.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "INSTANCE_METADATA_PARSE_FAILED",
        message: "Profile metadata is not in the expected shape."
      },
      meta: buildMeta()
    });
  }

  const parsedTemplate = templateRowSchema.safeParse(rawTemplate);
  const profileNameById = new Map(
    parsedProfiles.data.map((profile) => [profile.id, profile.full_name])
  );

  const totalTasks = tasksRows.length;
  const completedTasks = tasksRows.filter((task) => task.status === "completed").length;

  const employeeTasks = tasksRows.filter((t) => (t.track ?? "employee") === "employee");
  const opsTasks = tasksRows.filter((t) => t.track === "operations");
  const employeeCompleted = employeeTasks.filter((t) => t.status === "completed").length;
  const opsCompleted = opsTasks.filter((t) => t.status === "completed").length;

  const summary: OnboardingInstanceSummary = {
    id: instance.id,
    employeeId: instance.employee_id,
    employeeName: profileNameById.get(instance.employee_id) ?? "Unknown user",
    templateId: instance.template_id,
    templateName: parsedTemplate.success ? parsedTemplate.data.name : "No template",
    type: instance.type,
    status: instance.status,
    startedAt: instance.started_at,
    completedAt: instance.completed_at,
    totalTasks,
    completedTasks,
    progressPercent: toProgressPercent(completedTasks, totalTasks),
    employeeTrack: {
      total: employeeTasks.length,
      completed: employeeCompleted,
      percent: toProgressPercent(employeeCompleted, employeeTasks.length)
    },
    operationsTrack: {
      total: opsTasks.length,
      completed: opsCompleted,
      percent: toProgressPercent(opsCompleted, opsTasks.length)
    }
  };

  const tasks: OnboardingTask[] = tasksRows.map((task) => ({
    id: task.id,
    instanceId: task.instance_id,
    templateTaskId: task.template_task_id,
    title: task.title,
    description: task.description,
    category: task.category,
    track: (task.track as "employee" | "operations") ?? "employee",
    sectionId: task.section_id ?? null,
    status: task.status,
    taskType: task.task_type ?? "manual",
    assignedTo: task.assigned_to,
    assignedToName: task.assigned_to
      ? profileNameById.get(task.assigned_to) ?? "Unknown user"
      : "Unassigned",
    dueDate: task.due_date,
    completedAt: task.completed_at,
    completedBy: task.completed_by,
    completedByName: task.completed_by
      ? profileNameById.get(task.completed_by) ?? "Unknown user"
      : null,
    notes: task.notes,
    documentId: task.document_id,
    signatureRequestId: task.signature_request_id,
    actionUrl: task.action_url,
    actionLabel: task.action_label,
    completionGuidance: task.completion_guidance
  }));

  const reminderTasks = tasksRows.filter((task) => {
    return (
      task.assigned_to === profile.id &&
      task.status !== "completed" &&
      dueSoon(task.due_date)
    );
  });

  for (const task of reminderTasks) {
    await createNotification({
      orgId: profile.org_id,
      userId: profile.id,
      type: "onboarding_task",
      title: `Onboarding task due: ${task.title}`,
      body: task.due_date
        ? `Complete this task by ${task.due_date}.`
        : "This onboarding task is awaiting completion.",
      link: `/onboarding/${instance.id}`
    });
  }

  const responseData: OnboardingInstanceDetailResponseData = {
    instance: summary,
    tasks
  };

  return jsonResponse<OnboardingInstanceDetailResponseData>(200, {
    data: responseData,
    error: null,
    meta: buildMeta()
  });
}
