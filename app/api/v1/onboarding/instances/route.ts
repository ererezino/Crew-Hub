import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../lib/auth/session";
import { logAudit } from "../../../../../lib/audit";
import { sendOnboardingStartedEmail } from "../../../../../lib/notifications/email";
import { createNotification } from "../../../../../lib/notifications/service";
import { createOnboardingInstance } from "../../../../../lib/onboarding/create-instance";
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
  status: z.enum(ONBOARDING_TASK_STATUSES),
  track: z.string().default("employee")
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
        .select("instance_id, status, track")
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

  type InstanceCounts = {
    totalTasks: number;
    completedTasks: number;
    employeeTotal: number;
    employeeCompleted: number;
    opsTotal: number;
    opsCompleted: number;
  };

  const countsByInstanceId = new Map<string, InstanceCounts>();

  for (const task of parsedTaskStatuses.data) {
    const currentCounts = countsByInstanceId.get(task.instance_id) ?? {
      totalTasks: 0,
      completedTasks: 0,
      employeeTotal: 0,
      employeeCompleted: 0,
      opsTotal: 0,
      opsCompleted: 0
    };

    currentCounts.totalTasks += 1;
    const isCompleted = task.status === "completed";

    if (task.track === "operations") {
      currentCounts.opsTotal += 1;
      if (isCompleted) { currentCounts.opsCompleted += 1; }
    } else {
      currentCounts.employeeTotal += 1;
      if (isCompleted) { currentCounts.employeeCompleted += 1; }
    }

    if (isCompleted) {
      currentCounts.completedTasks += 1;
    }

    countsByInstanceId.set(task.instance_id, currentCounts);
  }

  const instances: OnboardingInstanceSummary[] = instancesRows.map((row) => {
    const counts = countsByInstanceId.get(row.id) ?? {
      totalTasks: 0,
      completedTasks: 0,
      employeeTotal: 0,
      employeeCompleted: 0,
      opsTotal: 0,
      opsCompleted: 0
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
      progressPercent: toProgressPercent(counts.completedTasks, counts.totalTasks),
      employeeTrack: {
        total: counts.employeeTotal,
        completed: counts.employeeCompleted,
        percent: toProgressPercent(counts.employeeCompleted, counts.employeeTotal)
      },
      operationsTrack: {
        total: counts.opsTotal,
        completed: counts.opsCompleted,
        percent: toProgressPercent(counts.opsCompleted, counts.opsTotal)
      }
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
        .select("id, full_name, manager_id")
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

  let instance: OnboardingInstanceSummary;

  try {
    const created = await createOnboardingInstance({
      supabase,
      orgId: profile.org_id,
      employee: {
        id: employeeRow.id,
        fullName: employeeRow.full_name
      },
      template: {
        id: parsedTemplate.data.id,
        name: parsedTemplate.data.name,
        type: parsedTemplate.data.type,
        tasks: parsedTemplate.data.tasks
      },
      type: payload.type,
      startedAt: payload.startedAt,
      creatingAdminId: profile.id
    });

    instance = created.instance;
  } catch (error) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "INSTANCE_CREATE_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "Unable to start onboarding instance."
      },
      meta: buildMeta()
    });
  }

  await createNotification({
    orgId: profile.org_id,
    userId: employeeRow.id,
    type: "onboarding_task",
    title: "Onboarding started",
    body: "A new onboarding plan has been assigned to you.",
    link: `/onboarding/${instance.id}`
  });

  sendOnboardingStartedEmail({
    orgId: profile.org_id,
    userId: employeeRow.id,
    managerId: typeof employeeRow.manager_id === "string" ? employeeRow.manager_id : profile.id,
    employeeName: employeeRow.full_name
  }).catch((err) => console.error("Email send failed:", err));

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
