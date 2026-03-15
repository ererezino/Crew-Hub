import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../../lib/auth/session";
import { logAudit } from "../../../../../../lib/audit";
import type { UserRole } from "../../../../../../lib/navigation";
import { hasRole } from "../../../../../../lib/roles";
import { createSupabaseServerClient } from "../../../../../../lib/supabase/server";
import type { ApiResponse } from "../../../../../../types/auth";
import {
  ONBOARDING_TYPES,
  ONBOARDING_TRACKS,
  ONBOARDING_TASK_TYPES,
  type OnboardingTemplateCreateResponseData,
  type OnboardingTemplate,
  type OnboardingTemplateTask
} from "../../../../../../types/onboarding";

const updateTemplateTaskInputSchema = z.object({
  taskId: z.string().uuid().optional(),
  title: z.string().trim().min(1, "Task title is required.").max(200, "Task title is too long."),
  description: z.string().trim().max(1000, "Task description is too long.").optional(),
  category: z.string().trim().min(1, "Task category is required.").max(50, "Task category is too long."),
  track: z.enum(ONBOARDING_TRACKS).optional(),
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

const updateTemplateSchema = z.object({
  name: z.string().trim().min(1, "Template name is required.").max(200, "Template name is too long."),
  type: z.enum(ONBOARDING_TYPES),
  countryCode: z
    .string()
    .trim()
    .max(2, "Country code must be 2 letters.")
    .optional()
    .refine(
      (value) => value === undefined || value.length === 0 || /^[a-zA-Z]{2}$/.test(value),
      "Country code must be 2 letters."
    ),
  department: z.string().trim().max(100, "Department is too long.").optional(),
  tasks: z.array(updateTemplateTaskInputSchema).min(1, "At least one task is required.")
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

const existingTaskSchema = z.object({
  taskId: z.string().uuid().optional(),
  title: z.string(),
  description: z.string().default(""),
  category: z.string(),
  track: z.enum(ONBOARDING_TRACKS).optional(),
  dueOffsetDays: z.number().int().nullable().optional(),
  due_offset_days: z.number().int().nullable().optional(),
  taskType: z.enum(ONBOARDING_TASK_TYPES).optional(),
  task_type: z.string().optional(),
  documentId: z.string().nullable().optional(),
  document_id: z.string().nullable().optional(),
  sectionId: z.string().nullable().optional(),
  section_id: z.string().nullable().optional(),
  linkUrl: z.string().nullable().optional(),
  link_url: z.string().nullable().optional(),
  actionUrl: z.string().nullable().optional(),
  action_url: z.string().nullable().optional(),
  actionLabel: z.string().nullable().optional(),
  action_label: z.string().nullable().optional(),
  completionGuidance: z.string().nullable().optional(),
  completion_guidance: z.string().nullable().optional()
});

type ExistingTaskParsed = z.infer<typeof existingTaskSchema>;

type RouteContext = {
  params: Promise<{ id: string }>;
};

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

/**
 * Check if the JSONB value is a compound object with sections metadata.
 * If so, return the sections array; otherwise return null.
 */
function extractSectionsArray(value: unknown): unknown[] | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.sections)) {
      return record.sections;
    }
  }
  return null;
}

/**
 * Build the JSONB payload for the tasks column. If the original value had a
 * compound `{ sections, tasks }` wrapper, preserve that structure so that
 * section metadata survives round-trips through the editor.
 */
function buildTasksPayload(
  mergedTasks: OnboardingTemplateTask[],
  originalValue: unknown
): OnboardingTemplateTask[] | { sections: unknown[]; tasks: OnboardingTemplateTask[] } {
  const existingSections = extractSectionsArray(originalValue);
  if (existingSections) {
    return { sections: existingSections, tasks: mergedTasks };
  }
  return mergedTasks;
}

function parseExistingTasks(value: unknown): ExistingTaskParsed[] {
  const rawTasks = extractTasksArray(value);

  const result: ExistingTaskParsed[] = [];

  for (const item of rawTasks) {
    const parsed = existingTaskSchema.safeParse(item);
    if (parsed.success) {
      result.push(parsed.data);
    }
  }

  return result;
}

/**
 * Server-side preservation: merge client-sent task fields with hidden fields
 * from the existing template tasks.
 *
 * Matching precedence:
 * 1. Match by taskId (stable UUID) — primary contract
 * 2. Fall back to title match (exact, then case-insensitive) — legacy only
 * 3. No match → treat as new task, assign fresh taskId
 *
 * Also handles duplicate taskId detection: if two incoming tasks share the
 * same taskId (e.g., copy-paste in editor), the second gets a fresh UUID.
 */
function mergeTasksWithPreservation(
  incomingTasks: z.infer<typeof updateTemplateSchema>["tasks"],
  existingTasks: ExistingTaskParsed[]
): OnboardingTemplateTask[] {
  const usedIndices = new Set<number>();
  const usedTaskIds = new Set<string>();

  // Build a lookup map for taskId-based matching
  const existingByTaskId = new Map<string, number>();
  for (let i = 0; i < existingTasks.length; i++) {
    const tid = existingTasks[i]?.taskId;
    if (tid) {
      existingByTaskId.set(tid, i);
    }
  }

  return incomingTasks.map((incoming) => {
    let matchIndex = -1;

    // 1. Primary: match by taskId
    if (incoming.taskId && existingByTaskId.has(incoming.taskId)) {
      const candidateIndex = existingByTaskId.get(incoming.taskId)!;
      if (!usedIndices.has(candidateIndex)) {
        matchIndex = candidateIndex;
      }
    }

    // 2. Legacy fallback: match by title (exact, then case-insensitive)
    if (matchIndex === -1) {
      matchIndex = existingTasks.findIndex(
        (existing, index) => !usedIndices.has(index) && existing.title === incoming.title
      );
    }
    if (matchIndex === -1) {
      matchIndex = existingTasks.findIndex(
        (existing, index) =>
          !usedIndices.has(index) &&
          existing.title.toLowerCase() === incoming.title.toLowerCase()
      );
    }

    const existing = matchIndex >= 0 ? existingTasks[matchIndex] : undefined;
    if (matchIndex >= 0) {
      usedIndices.add(matchIndex);
    }

    // Resolve taskId: use existing match's taskId, then incoming, then generate new.
    // De-duplicate: if this taskId was already claimed, generate a fresh one.
    let resolvedTaskId = existing?.taskId ?? incoming.taskId ?? randomUUID();
    if (usedTaskIds.has(resolvedTaskId)) {
      resolvedTaskId = randomUUID();
    }
    usedTaskIds.add(resolvedTaskId);

    // Resolve hidden fields from existing task (preserve what client doesn't send)
    const taskType = existing?.taskType ?? existing?.task_type ?? undefined;
    const documentId = existing?.documentId ?? existing?.document_id ?? null;
    const sectionId = existing?.sectionId ?? existing?.section_id ?? null;
    const linkUrl = existing?.linkUrl ?? existing?.link_url ?? null;

    // Validate taskType against the enum
    const validTaskTypes = new Set(ONBOARDING_TASK_TYPES as readonly string[]);
    const resolvedTaskType =
      taskType && validTaskTypes.has(taskType)
        ? (taskType as (typeof ONBOARDING_TASK_TYPES)[number])
        : undefined;

    return {
      taskId: resolvedTaskId,
      title: incoming.title.trim(),
      description: incoming.description?.trim() ?? "",
      category: incoming.category.trim(),
      track: incoming.track,
      sectionId: sectionId,
      dueOffsetDays: incoming.dueOffsetDays ?? null,
      taskType: resolvedTaskType,
      documentId: documentId,
      linkUrl: linkUrl,
      actionUrl: incoming.actionUrl?.trim() || null,
      actionLabel: incoming.actionLabel?.trim() || null,
      completionGuidance: incoming.completionGuidance?.trim() || null
    };
  });
}

function mapTemplateRow(row: z.infer<typeof templateRowSchema>): OnboardingTemplate {
  const tasks = parseExistingTasks(row.tasks);

  return {
    id: row.id,
    name: row.name,
    type: row.type,
    countryCode: row.country_code,
    department: row.department,
    tasks: tasks.map((task) => ({
      taskId: task.taskId,
      title: task.title,
      description: task.description,
      category: task.category,
      track: task.track,
      sectionId: task.sectionId ?? task.section_id ?? null,
      dueOffsetDays: task.dueOffsetDays ?? task.due_offset_days ?? null,
      taskType: (() => {
        const raw = task.taskType ?? task.task_type;
        const validTypes = new Set(ONBOARDING_TASK_TYPES as readonly string[]);
        return raw && validTypes.has(raw)
          ? (raw as (typeof ONBOARDING_TASK_TYPES)[number])
          : undefined;
      })(),
      documentId: task.documentId ?? task.document_id ?? null,
      linkUrl: task.linkUrl ?? task.link_url ?? null,
      actionUrl: task.actionUrl ?? task.action_url ?? null,
      actionLabel: task.actionLabel ?? task.action_label ?? null,
      completionGuidance: task.completionGuidance ?? task.completion_guidance ?? null
    })),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export async function PUT(request: Request, context: RouteContext) {
  const { id } = await context.params;

  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to update onboarding templates."
      },
      meta: buildMeta()
    });
  }

  if (!canManageTemplates(session.profile.roles)) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "Only HR Admin and Super Admin users can update onboarding templates."
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

  const parsedBody = updateTemplateSchema.safeParse(body);

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

  // Fetch existing template to preserve hidden fields
  const { data: existingRow, error: fetchError } = await supabase
    .from("onboarding_templates")
    .select("id, name, type, country_code, department, tasks, created_at, updated_at")
    .eq("id", id)
    .eq("org_id", session.profile.org_id)
    .is("deleted_at", null)
    .single();

  if (fetchError || !existingRow) {
    return jsonResponse<null>(404, {
      data: null,
      error: {
        code: "TEMPLATE_NOT_FOUND",
        message: "Onboarding template not found."
      },
      meta: buildMeta()
    });
  }

  // Parse existing tasks for server-side preservation
  const existingTasks = parseExistingTasks(existingRow.tasks);

  // Merge incoming tasks with preserved hidden fields
  const mergedTasks = mergeTasksWithPreservation(payload.tasks, existingTasks);

  const normalizedCountryCode =
    payload.countryCode && payload.countryCode.trim().length > 0
      ? payload.countryCode.trim().toUpperCase()
      : null;
  const normalizedDepartment =
    payload.department && payload.department.trim().length > 0
      ? payload.department.trim()
      : null;

  // Re-wrap tasks in the compound format if the original had sections metadata
  const tasksPayload = buildTasksPayload(mergedTasks, existingRow.tasks);

  const { data: updatedRow, error: updateError } = await supabase
    .from("onboarding_templates")
    .update({
      name: payload.name.trim(),
      type: payload.type,
      country_code: normalizedCountryCode,
      department: normalizedDepartment,
      tasks: tasksPayload,
      updated_at: new Date().toISOString()
    })
    .eq("id", id)
    .eq("org_id", session.profile.org_id)
    .is("deleted_at", null)
    .select("id, name, type, country_code, department, tasks, created_at, updated_at")
    .single();

  if (updateError || !updatedRow) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "TEMPLATE_UPDATE_FAILED",
        message: "Unable to update onboarding template."
      },
      meta: buildMeta()
    });
  }

  const parsedUpdated = templateRowSchema.safeParse(updatedRow);

  if (!parsedUpdated.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "TEMPLATE_PARSE_FAILED",
        message: "Updated template data is not in the expected shape."
      },
      meta: buildMeta()
    });
  }

  const template = mapTemplateRow(parsedUpdated.data);

  await logAudit({
    action: "updated",
    tableName: "onboarding_templates",
    recordId: template.id,
    oldValue: {
      name: existingRow.name,
      type: existingRow.type,
      countryCode: existingRow.country_code,
      department: existingRow.department,
      taskCount: existingTasks.length
    },
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

  return jsonResponse<OnboardingTemplateCreateResponseData>(200, {
    data: responseData,
    error: null,
    meta: buildMeta()
  });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { id } = await context.params;

  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to archive onboarding templates."
      },
      meta: buildMeta()
    });
  }

  if (!canManageTemplates(session.profile.roles)) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "Only HR Admin and Super Admin users can archive onboarding templates."
      },
      meta: buildMeta()
    });
  }

  const supabase = await createSupabaseServerClient();

  // Fetch existing to confirm it exists and belongs to this org
  const { data: existingRow, error: fetchError } = await supabase
    .from("onboarding_templates")
    .select("id, name, type")
    .eq("id", id)
    .eq("org_id", session.profile.org_id)
    .is("deleted_at", null)
    .single();

  if (fetchError || !existingRow) {
    return jsonResponse<null>(404, {
      data: null,
      error: {
        code: "TEMPLATE_NOT_FOUND",
        message: "Onboarding template not found."
      },
      meta: buildMeta()
    });
  }

  // Soft-delete by setting deleted_at
  const { error: deleteError } = await supabase
    .from("onboarding_templates")
    .update({
      deleted_at: new Date().toISOString()
    })
    .eq("id", id)
    .eq("org_id", session.profile.org_id);

  if (deleteError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "TEMPLATE_ARCHIVE_FAILED",
        message: "Unable to archive onboarding template."
      },
      meta: buildMeta()
    });
  }

  await logAudit({
    action: "deleted",
    tableName: "onboarding_templates",
    recordId: id,
    oldValue: {
      name: existingRow.name,
      type: existingRow.type
    }
  });

  return jsonResponse<{ archived: boolean }>(200, {
    data: { archived: true },
    error: null,
    meta: buildMeta()
  });
}
