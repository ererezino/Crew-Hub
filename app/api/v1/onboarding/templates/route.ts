import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../lib/auth/session";
import { logAudit } from "../../../../../lib/audit";
import type { UserRole } from "../../../../../lib/navigation";
import { hasRole } from "../../../../../lib/roles";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import type { ApiResponse } from "../../../../../types/auth";
import {
  ONBOARDING_TYPES,
  ONBOARDING_TRACKS,
  ONBOARDING_TASK_TYPES,
  type OnboardingTemplateCreateResponseData,
  type OnboardingTemplate,
  type OnboardingTemplateTask,
  type OnboardingTemplatesResponseData
} from "../../../../../types/onboarding";

const querySchema = z.object({
  type: z.enum(ONBOARDING_TYPES).optional()
});

const templateTaskInputSchema = z.object({
  title: z.string().trim().min(1, "Task title is required.").max(200, "Task title is too long."),
  description: z.string().trim().max(1000, "Task description is too long.").optional(),
  category: z.string().trim().min(1, "Task category is required.").max(50, "Task category is too long."),
  track: z.enum(ONBOARDING_TRACKS).optional(),
  taskType: z.enum(ONBOARDING_TASK_TYPES).optional(),
  dueOffsetDays: z.number().int().min(-365).max(365).nullable().optional(),
  actionUrl: z
    .string()
    .trim()
    .url("Action URL must be a valid URL.")
    .max(500, "Action URL is too long.")
    .nullable()
    .optional(),
  actionLabel: z.string().trim().max(120, "Action label is too long.").nullable().optional(),
  completionGuidance: z
    .string()
    .trim()
    .max(1000, "Completion guidance is too long.")
    .nullable()
    .optional()
});

const createTemplateSchema = z.object({
  name: z.string().trim().min(1, "Template name is required.").max(200, "Template name is too long."),
  type: z.enum(ONBOARDING_TYPES).default("onboarding"),
  countryCode: z
    .string()
    .trim()
    .max(2, "Country code must be 2 letters.")
    .optional()
    .refine((value) => value === undefined || value.length === 0 || /^[a-zA-Z]{2}$/.test(value), "Country code must be 2 letters."),
  department: z.string().trim().max(100, "Department is too long.").optional(),
  tasks: z.array(templateTaskInputSchema).default([])
});

const templateRowSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  type: z.enum(ONBOARDING_TYPES),
  country_code: z.string().nullable(),
  department: z.string().nullable(),
  tasks: z.unknown(),
  created_at: z.string(),
  updated_at: z.string()
});

const templateTaskSchema = z.object({
  title: z.string(),
  description: z.string().default(""),
  category: z.string(),
  track: z.enum(ONBOARDING_TRACKS).optional(),
  taskType: z.enum(ONBOARDING_TASK_TYPES).optional(),
  task_type: z.string().optional(),
  dueOffsetDays: z.number().int().nullable().optional(),
  due_offset_days: z.number().int().nullable().optional(),
  actionUrl: z.string().nullable().optional(),
  action_url: z.string().nullable().optional(),
  actionLabel: z.string().nullable().optional(),
  action_label: z.string().nullable().optional(),
  completionGuidance: z.string().nullable().optional(),
  completion_guidance: z.string().nullable().optional()
});

function buildMeta() {
  return {
    timestamp: new Date().toISOString()
  };
}

function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return NextResponse.json(payload, { status });
}

function canManageTemplates(userRoles: readonly UserRole[]): boolean {
  return hasRole(userRoles, "HR_ADMIN") || hasRole(userRoles, "SUPER_ADMIN");
}

/**
 * Extract the tasks array from the JSONB column. The column may be either:
 * - a flat array of tasks (user-created templates)
 * - a compound object `{ sections: [...], tasks: [...] }` (seed templates)
 */
function extractTasksArray(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }

  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.tasks)) {
      return record.tasks;
    }
  }

  return [];
}

function normalizeTemplateTasks(value: unknown): OnboardingTemplateTask[] {
  const rawTasks = extractTasksArray(value);

  const normalizedTasks: OnboardingTemplateTask[] = [];

  for (const task of rawTasks) {
    const parsedTask = templateTaskSchema.safeParse(task);

    if (!parsedTask.success) {
      continue;
    }

    const rawTaskType = parsedTask.data.taskType ?? parsedTask.data.task_type;
    const validTaskTypes = new Set(ONBOARDING_TASK_TYPES as readonly string[]);
    const resolvedTaskType =
      rawTaskType && validTaskTypes.has(rawTaskType)
        ? (rawTaskType as (typeof ONBOARDING_TASK_TYPES)[number])
        : undefined;

    normalizedTasks.push({
      title: parsedTask.data.title,
      description: parsedTask.data.description,
      category: parsedTask.data.category,
      track: parsedTask.data.track,
      taskType: resolvedTaskType,
      dueOffsetDays:
        parsedTask.data.dueOffsetDays ??
        parsedTask.data.due_offset_days ??
        null,
      actionUrl: parsedTask.data.actionUrl ?? parsedTask.data.action_url ?? null,
      actionLabel: parsedTask.data.actionLabel ?? parsedTask.data.action_label ?? null,
      completionGuidance:
        parsedTask.data.completionGuidance ?? parsedTask.data.completion_guidance ?? null
    });
  }

  return normalizedTasks;
}

function mapTemplateRow(row: z.infer<typeof templateRowSchema>): OnboardingTemplate {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    countryCode: row.country_code,
    department: row.department,
    tasks: normalizeTemplateTasks(row.tasks),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export async function GET(request: Request) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to view onboarding templates."
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
        message: parsedQuery.error.issues[0]?.message ?? "Invalid template query."
      },
      meta: buildMeta()
    });
  }

  const supabase = await createSupabaseServerClient();

  let templatesQuery = supabase
    .from("onboarding_templates")
    .select("id, name, type, country_code, department, tasks, created_at, updated_at")
    .eq("org_id", session.profile.org_id)
    .is("deleted_at", null)
    .order("name", { ascending: true });

  if (parsedQuery.data.type) {
    templatesQuery = templatesQuery.eq("type", parsedQuery.data.type);
  }

  const { data: rawTemplates, error: templatesError } = await templatesQuery;

  if (templatesError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "TEMPLATES_FETCH_FAILED",
        message: "Unable to load onboarding templates."
      },
      meta: buildMeta()
    });
  }

  const parsedTemplates = z.array(templateRowSchema).safeParse(rawTemplates ?? []);

  if (!parsedTemplates.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "TEMPLATES_PARSE_FAILED",
        message: "Template data is not in the expected shape."
      },
      meta: buildMeta()
    });
  }

  const templates: OnboardingTemplate[] = parsedTemplates.data.map(mapTemplateRow);

  const responseData: OnboardingTemplatesResponseData = {
    templates
  };

  return jsonResponse<OnboardingTemplatesResponseData>(200, {
    data: responseData,
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
        message: "You must be logged in to create onboarding templates."
      },
      meta: buildMeta()
    });
  }

  if (!canManageTemplates(session.profile.roles)) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "Only HR Admin and Super Admin users can create onboarding templates."
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

  const parsedBody = createTemplateSchema.safeParse(body);

  if (!parsedBody.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsedBody.error.issues[0]?.message ?? "Invalid template payload."
      },
      meta: buildMeta()
    });
  }

  const payload = parsedBody.data;
  const supabase = await createSupabaseServerClient();

  const normalizedCountryCode =
    payload.countryCode && payload.countryCode.trim().length > 0
      ? payload.countryCode.trim().toUpperCase()
      : null;
  const normalizedDepartment =
    payload.department && payload.department.trim().length > 0
      ? payload.department.trim()
      : null;

  const templateTaskPayload = payload.tasks.map((task) => ({
    title: task.title.trim(),
    description: task.description?.trim() ?? "",
    category: task.category.trim(),
    track: task.track ?? undefined,
    taskType: task.taskType ?? undefined,
    dueOffsetDays: task.dueOffsetDays ?? null,
    actionUrl: task.actionUrl?.trim() || null,
    actionLabel: task.actionLabel?.trim() || null,
    completionGuidance: task.completionGuidance?.trim() || null
  }));

  const { data: insertedTemplate, error: insertError } = await supabase
    .from("onboarding_templates")
    .insert({
      org_id: session.profile.org_id,
      name: payload.name.trim(),
      type: payload.type,
      country_code: normalizedCountryCode,
      department: normalizedDepartment,
      tasks: templateTaskPayload
    })
    .select("id, name, type, country_code, department, tasks, created_at, updated_at")
    .single();

  if (insertError || !insertedTemplate) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "TEMPLATE_CREATE_FAILED",
        message: "Unable to create onboarding template."
      },
      meta: buildMeta()
    });
  }

  const parsedTemplate = templateRowSchema.safeParse(insertedTemplate);

  if (!parsedTemplate.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "TEMPLATE_PARSE_FAILED",
        message: "Created template data is not in the expected shape."
      },
      meta: buildMeta()
    });
  }

  const template = mapTemplateRow(parsedTemplate.data);

  await logAudit({
    action: "created",
    tableName: "onboarding_templates",
    recordId: template.id,
    newValue: {
      name: template.name,
      type: template.type,
      countryCode: template.countryCode,
      department: template.department,
      taskCount: template.tasks.length
    }
  });

  const responseData: OnboardingTemplateCreateResponseData = {
    template
  };

  return jsonResponse<OnboardingTemplateCreateResponseData>(201, {
    data: responseData,
    error: null,
    meta: buildMeta()
  });
}
