import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../lib/auth/session";
import { logAudit } from "../../../../../lib/audit";
import { createNotification } from "../../../../../lib/notifications/service";
import type { UserRole } from "../../../../../lib/navigation";
import { hasRole } from "../../../../../lib/roles";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import type { ApiResponse } from "../../../../../types/auth";
import {
  ONBOARDING_INSTANCE_STATUSES,
  ONBOARDING_TASK_STATUSES,
  ONBOARDING_TYPES,
  type OnboardingInstanceCreateResponseData,
  type OnboardingInstanceSummary,
  type OnboardingInstancesResponseData
} from "../../../../../types/onboarding";

const querySchema = z.object({
  scope: z.enum(["all", "me", "reports"]).default("all"),
  status: z.enum(ONBOARDING_INSTANCE_STATUSES).optional(),
  type: z.enum(ONBOARDING_TYPES).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(200),
  sortBy: z.enum(["started_at", "completed_at"]).default("started_at"),
  sortDir: z.enum(["asc", "desc"]).default("desc")
});

const createInstanceSchema = z.object({
  employeeId: z.string().uuid("Employee must be valid."),
  templateId: z.string().uuid("Template must be valid."),
  type: z.enum(ONBOARDING_TYPES).optional(),
  startedAt: z
    .string()
    .trim()
    .optional()
    .refine(
      (value) =>
        value === undefined ||
        value.length === 0 ||
        /^\d{4}-\d{2}-\d{2}$/.test(value) ||
        !Number.isNaN(Date.parse(value)),
      "Start date must be a valid date."
    )
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

const profileRowSchema = z.object({
  id: z.string().uuid(),
  full_name: z.string()
});

const templateRowSchema = z.object({
  id: z.string().uuid(),
  name: z.string()
});

const taskStatusRowSchema = z.object({
  instance_id: z.string().uuid(),
  status: z.enum(ONBOARDING_TASK_STATUSES)
});

const templateTaskSchema = z.object({
  title: z.string(),
  description: z.string().default(""),
  category: z.string(),
  dueOffsetDays: z.number().int().nullable().optional(),
  due_offset_days: z.number().int().nullable().optional()
});

const templateDetailRowSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  type: z.enum(ONBOARDING_TYPES),
  tasks: z.unknown()
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

function canViewReportsScope(userRoles: readonly UserRole[]): boolean {
  return (
    hasRole(userRoles, "MANAGER") ||
    hasRole(userRoles, "HR_ADMIN") ||
    hasRole(userRoles, "SUPER_ADMIN")
  );
}

function canViewAllScope(userRoles: readonly UserRole[]): boolean {
  return (
    hasRole(userRoles, "HR_ADMIN") ||
    hasRole(userRoles, "SUPER_ADMIN")
  );
}

function canManageInstances(userRoles: readonly UserRole[]): boolean {
  return (
    hasRole(userRoles, "HR_ADMIN") ||
    hasRole(userRoles, "SUPER_ADMIN")
  );
}

function normalizeTemplateTasks(value: unknown): Array<{
  title: string;
  description: string;
  category: string;
  dueOffsetDays: number | null;
}> {
  if (!Array.isArray(value)) {
    return [];
  }

  const tasks: Array<{
    title: string;
    description: string;
    category: string;
    dueOffsetDays: number | null;
  }> = [];

  for (const task of value) {
    const parsedTask = templateTaskSchema.safeParse(task);

    if (!parsedTask.success) {
      continue;
    }

    tasks.push({
      title: parsedTask.data.title,
      description: parsedTask.data.description,
      category: parsedTask.data.category,
      dueOffsetDays: parsedTask.data.dueOffsetDays ?? parsedTask.data.due_offset_days ?? null
    });
  }

  return tasks;
}

function formatDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function resolveStartTimestamp(rawValue: string | undefined): string {
  if (!rawValue || rawValue.trim().length === 0) {
    return new Date().toISOString();
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(rawValue)) {
    return new Date(`${rawValue}T00:00:00.000Z`).toISOString();
  }

  return new Date(rawValue).toISOString();
}

export async function GET(request: Request) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to view onboarding instances."
      },
      meta: buildMeta()
    });
  }

  const requestUrl = new URL(request.url);
  const parsedQuery = querySchema.safeParse(
    Object.fromEntries(requestUrl.searchParams.entries())
  );

  if (!parsedQuery.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsedQuery.error.issues[0]?.message ?? "Invalid onboarding query."
      },
      meta: buildMeta()
    });
  }

  const query = parsedQuery.data;
  const supabase = await createSupabaseServerClient();
  const userRoles = session.profile.roles;
  let scope = query.scope;

  if (scope === "all" && !canViewAllScope(userRoles)) {
    scope = canViewReportsScope(userRoles) ? "reports" : "me";
  }

  if (scope === "reports" && !canViewReportsScope(userRoles)) {
    scope = "me";
  }

  let reportsUserIds: string[] = [];

  if (scope === "reports") {
    const { data: reportsRows, error: reportsError } = await supabase
      .from("profiles")
      .select("id")
      .eq("org_id", session.profile.org_id)
      .is("deleted_at", null)
      .eq("manager_id", session.profile.id);

    if (reportsError) {
      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "REPORTS_FETCH_FAILED",
          message: "Unable to load direct reports for onboarding scope."
        },
        meta: buildMeta()
      });
    }

    reportsUserIds = (reportsRows ?? [])
      .map((row) => row.id)
      .filter((value): value is string => typeof value === "string");

    if (reportsUserIds.length === 0) {
      return jsonResponse<OnboardingInstancesResponseData>(200, {
        data: {
          instances: []
        },
        error: null,
        meta: buildMeta()
      });
    }
  }

  let instancesQuery = supabase
    .from("onboarding_instances")
    .select("id, employee_id, template_id, type, status, started_at, completed_at")
    .eq("org_id", session.profile.org_id)
    .is("deleted_at", null)
    .limit(query.limit)
    .order(query.sortBy, {
      ascending: query.sortDir === "asc",
      nullsFirst: false
    });

  if (scope === "me") {
    instancesQuery = instancesQuery.eq("employee_id", session.profile.id);
  }

  if (scope === "reports") {
    instancesQuery = instancesQuery.in("employee_id", reportsUserIds);
  }

  if (query.status) {
    instancesQuery = instancesQuery.eq("status", query.status);
  }

  if (query.type) {
    instancesQuery = instancesQuery.eq("type", query.type);
  }

  const { data: rawInstances, error: instancesError } = await instancesQuery;

  if (instancesError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "INSTANCES_FETCH_FAILED",
        message: "Unable to load onboarding instances."
      },
      meta: buildMeta()
    });
  }

  const parsedInstances = z.array(instanceRowSchema).safeParse(rawInstances ?? []);

  if (!parsedInstances.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "INSTANCES_PARSE_FAILED",
        message: "Onboarding instance data is not in the expected shape."
      },
      meta: buildMeta()
    });
  }

  const instancesRows = parsedInstances.data;

  if (instancesRows.length === 0) {
    return jsonResponse<OnboardingInstancesResponseData>(200, {
      data: {
        instances: []
      },
      error: null,
      meta: buildMeta()
    });
  }

  const employeeIds = [...new Set(instancesRows.map((row) => row.employee_id))];
  const templateIds = [
    ...new Set(
      instancesRows
        .map((row) => row.template_id)
        .filter((value): value is string => Boolean(value))
    )
  ];
  const instanceIds = instancesRows.map((row) => row.id);

  const [{ data: employeeRows, error: employeeError }, { data: templateRows, error: templateError }, { data: taskStatusRows, error: tasksError }] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("id, full_name")
        .eq("org_id", session.profile.org_id)
        .is("deleted_at", null)
        .in("id", employeeIds),
      templateIds.length > 0
        ? supabase
            .from("onboarding_templates")
            .select("id, name")
            .eq("org_id", session.profile.org_id)
            .is("deleted_at", null)
            .in("id", templateIds)
        : Promise.resolve({ data: [], error: null }),
      supabase
        .from("onboarding_tasks")
        .select("instance_id, status")
        .eq("org_id", session.profile.org_id)
        .is("deleted_at", null)
        .in("instance_id", instanceIds)
    ]);

  if (employeeError || templateError || tasksError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "INSTANCE_METADATA_FETCH_FAILED",
        message: "Unable to resolve onboarding metadata."
      },
      meta: buildMeta()
    });
  }

  const parsedEmployees = z.array(profileRowSchema).safeParse(employeeRows ?? []);
  const parsedTemplates = z.array(templateRowSchema).safeParse(templateRows ?? []);
  const parsedTaskStatuses = z.array(taskStatusRowSchema).safeParse(taskStatusRows ?? []);

  if (!parsedEmployees.success || !parsedTemplates.success || !parsedTaskStatuses.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "INSTANCE_METADATA_PARSE_FAILED",
        message: "Onboarding metadata is not in the expected shape."
      },
      meta: buildMeta()
    });
  }

  const employeeNameById = new Map(
    parsedEmployees.data.map((row) => [row.id, row.full_name])
  );
  const templateNameById = new Map(
    parsedTemplates.data.map((row) => [row.id, row.name])
  );

  const countsByInstanceId = new Map<
    string,
    {
      totalTasks: number;
      completedTasks: number;
    }
  >();

  for (const task of parsedTaskStatuses.data) {
    const currentCounts = countsByInstanceId.get(task.instance_id) ?? {
      totalTasks: 0,
      completedTasks: 0
    };

    currentCounts.totalTasks += 1;

    if (task.status === "completed") {
      currentCounts.completedTasks += 1;
    }

    countsByInstanceId.set(task.instance_id, currentCounts);
  }

  const instances: OnboardingInstanceSummary[] = instancesRows.map((row) => {
    const counts = countsByInstanceId.get(row.id) ?? {
      totalTasks: 0,
      completedTasks: 0
    };

    return {
      id: row.id,
      employeeId: row.employee_id,
      employeeName: employeeNameById.get(row.employee_id) ?? "Unknown user",
      templateId: row.template_id,
      templateName: row.template_id
        ? templateNameById.get(row.template_id) ?? "Unknown template"
        : "No template",
      type: row.type,
      status: row.status,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      totalTasks: counts.totalTasks,
      completedTasks: counts.completedTasks,
      progressPercent: toProgressPercent(counts.completedTasks, counts.totalTasks)
    };
  });

  return jsonResponse<OnboardingInstancesResponseData>(200, {
    data: {
      instances
    },
    error: null,
    meta: buildMeta()
  });
}

export async function POST(request: Request) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to create onboarding instances."
      },
      meta: buildMeta()
    });
  }

  const profile = session.profile;

  if (!canManageInstances(profile.roles)) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "Only HR Admin and Super Admin users can start onboarding."
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

  const parsedBody = createInstanceSchema.safeParse(body);

  if (!parsedBody.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsedBody.error.issues[0]?.message ?? "Invalid onboarding payload."
      },
      meta: buildMeta()
    });
  }

  const payload = parsedBody.data;
  const supabase = await createSupabaseServerClient();

  const [{ data: employeeRow, error: employeeError }, { data: templateRow, error: templateError }] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("id, full_name")
        .eq("org_id", profile.org_id)
        .is("deleted_at", null)
        .eq("id", payload.employeeId)
        .maybeSingle(),
      supabase
        .from("onboarding_templates")
        .select("id, name, type, tasks")
        .eq("org_id", profile.org_id)
        .is("deleted_at", null)
        .eq("id", payload.templateId)
        .maybeSingle()
    ]);

  if (employeeError || templateError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "ONBOARDING_REFERENCE_FETCH_FAILED",
        message: "Unable to validate employee or template details."
      },
      meta: buildMeta()
    });
  }

  if (!employeeRow) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: "Selected employee was not found in this organization."
      },
      meta: buildMeta()
    });
  }

  const parsedTemplate = templateDetailRowSchema.safeParse(templateRow);

  if (!parsedTemplate.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: "Selected template was not found in this organization."
      },
      meta: buildMeta()
    });
  }

  const startTimestamp = resolveStartTimestamp(payload.startedAt);
  const instanceType = payload.type ?? parsedTemplate.data.type;

  const { data: insertedInstance, error: insertInstanceError } = await supabase
    .from("onboarding_instances")
    .insert({
      org_id: profile.org_id,
      employee_id: employeeRow.id,
      template_id: parsedTemplate.data.id,
      type: instanceType,
      status: "active",
      started_at: startTimestamp
    })
    .select("id, employee_id, template_id, type, status, started_at, completed_at")
    .single();

  if (insertInstanceError || !insertedInstance) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "INSTANCE_CREATE_FAILED",
        message: "Unable to start onboarding instance."
      },
      meta: buildMeta()
    });
  }

  const parsedInstance = instanceRowSchema.safeParse(insertedInstance);

  if (!parsedInstance.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "INSTANCE_PARSE_FAILED",
        message: "Created onboarding instance data is not in the expected shape."
      },
      meta: buildMeta()
    });
  }

  const normalizedTemplateTasks = normalizeTemplateTasks(parsedTemplate.data.tasks);
  const baseDate = new Date(startTimestamp);
  const taskRows = normalizedTemplateTasks.map((task) => {
    const dueDate =
      task.dueOffsetDays === null
        ? null
        : formatDateOnly(
            new Date(
              baseDate.getTime() + task.dueOffsetDays * 24 * 60 * 60 * 1000
            )
          );

    return {
      org_id: profile.org_id,
      instance_id: parsedInstance.data.id,
      title: task.title,
      description: task.description || null,
      category: task.category,
      status: "pending",
      assigned_to: employeeRow.id,
      due_date: dueDate
    };
  });

  if (taskRows.length > 0) {
    const { error: insertTasksError } = await supabase
      .from("onboarding_tasks")
      .insert(taskRows);

    if (insertTasksError) {
      await supabase
        .from("onboarding_instances")
        .update({
          deleted_at: new Date().toISOString()
        })
        .eq("id", parsedInstance.data.id)
        .eq("org_id", profile.org_id);

      return jsonResponse<null>(500, {
        data: null,
        error: {
          code: "ONBOARDING_TASKS_CREATE_FAILED",
          message: "Onboarding instance was created but tasks could not be generated."
        },
        meta: buildMeta()
      });
    }
  }

  const instance: OnboardingInstanceSummary = {
    id: parsedInstance.data.id,
    employeeId: parsedInstance.data.employee_id,
    employeeName: employeeRow.full_name,
    templateId: parsedInstance.data.template_id,
    templateName: parsedTemplate.data.name,
    type: parsedInstance.data.type,
    status: parsedInstance.data.status,
    startedAt: parsedInstance.data.started_at,
    completedAt: parsedInstance.data.completed_at,
    totalTasks: taskRows.length,
    completedTasks: 0,
    progressPercent: 0
  };

  await createNotification({
    orgId: profile.org_id,
    userId: employeeRow.id,
    type: "onboarding_task",
    title: "Onboarding started",
    body: "A new onboarding plan has been assigned to you.",
    link: `/onboarding/${instance.id}`
  });

  await logAudit({
    action: "created",
    tableName: "onboarding_instances",
    recordId: instance.id,
    newValue: {
      employeeId: instance.employeeId,
      templateId: instance.templateId,
      type: instance.type,
      totalTasks: instance.totalTasks
    }
  });

  const responseData: OnboardingInstanceCreateResponseData = {
    instance
  };

  return jsonResponse<OnboardingInstanceCreateResponseData>(201, {
    data: responseData,
    error: null,
    meta: buildMeta()
  });
}
