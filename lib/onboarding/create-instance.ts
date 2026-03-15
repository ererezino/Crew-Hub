import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { createNotification } from "../notifications/service";
import {
  ONBOARDING_TASK_STATUSES,
  ONBOARDING_TRACKS,
  ONBOARDING_TYPES,
  type OnboardingInstanceSummary,
  type OnboardingTrack,
  type OnboardingType
} from "../../types/onboarding";

type OnboardingEmployee = {
  id: string;
  fullName: string;
};

type OnboardingTemplate = {
  id: string;
  name: string;
  type: OnboardingType;
  tasks: unknown;
};

type CreateOnboardingInstanceInput = {
  supabase: SupabaseClient;
  orgId: string;
  employee: OnboardingEmployee;
  template: OnboardingTemplate;
  type?: OnboardingType;
  startedAt?: string;
  /** Admin who created this instance — auto-assigned to operations-track tasks */
  creatingAdminId?: string;
};

const ONBOARDING_TASK_TYPES = ["manual", "e_signature", "link", "form"] as const;
type OnboardingTaskType = (typeof ONBOARDING_TASK_TYPES)[number];

const templateTaskSchema = z.object({
  title: z.string(),
  description: z.string().default(""),
  category: z.string(),
  track: z.enum(ONBOARDING_TRACKS).optional(),
  sectionId: z.string().nullable().optional(),
  section_id: z.string().nullable().optional(),
  dueOffsetDays: z.number().int().nullable().optional(),
  due_offset_days: z.number().int().nullable().optional(),
  taskType: z.enum(ONBOARDING_TASK_TYPES).optional(),
  task_type: z.enum(ONBOARDING_TASK_TYPES).optional(),
  documentId: z.string().uuid().optional(),
  document_id: z.string().uuid().optional(),
  linkUrl: z.string().optional(),
  link_url: z.string().optional(),
  actionUrl: z.string().url().nullable().optional(),
  action_url: z.string().url().nullable().optional(),
  actionLabel: z.string().max(120).nullable().optional(),
  action_label: z.string().max(120).nullable().optional(),
  completionGuidance: z.string().max(1000).nullable().optional(),
  completion_guidance: z.string().max(1000).nullable().optional()
});

const createdInstanceRowSchema = z.object({
  id: z.string().uuid(),
  employee_id: z.string().uuid(),
  template_id: z.string().uuid().nullable(),
  type: z.enum(ONBOARDING_TYPES),
  status: z.enum(["active", "completed", "cancelled"]),
  started_at: z.string(),
  completed_at: z.string().nullable()
});

function formatDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function resolveOnboardingStartTimestamp(rawValue: string | undefined): string {
  if (!rawValue || rawValue.trim().length === 0) {
    return new Date().toISOString();
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(rawValue)) {
    return new Date(`${rawValue}T00:00:00.000Z`).toISOString();
  }

  return new Date(rawValue).toISOString();
}

export type NormalizedTemplateTask = {
  title: string;
  description: string;
  category: string;
  track: OnboardingTrack;
  sectionId: string | null;
  dueOffsetDays: number | null;
  taskType: OnboardingTaskType;
  documentId: string | null;
  linkUrl: string | null;
  actionUrl: string | null;
  actionLabel: string | null;
  completionGuidance: string | null;
};

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

export function normalizeTemplateTasks(value: unknown): NormalizedTemplateTask[] {
  const rawTasks = extractTasksArray(value);

  const tasks: NormalizedTemplateTask[] = [];

  for (const task of rawTasks) {
    const parsedTask = templateTaskSchema.safeParse(task);

    if (!parsedTask.success) {
      continue;
    }

    tasks.push({
      title: parsedTask.data.title,
      description: parsedTask.data.description,
      category: parsedTask.data.category,
      track: parsedTask.data.track ?? "employee",
      sectionId: parsedTask.data.sectionId ?? parsedTask.data.section_id ?? null,
      dueOffsetDays: parsedTask.data.dueOffsetDays ?? parsedTask.data.due_offset_days ?? null,
      taskType: parsedTask.data.taskType ?? parsedTask.data.task_type ?? "manual",
      documentId: parsedTask.data.documentId ?? parsedTask.data.document_id ?? null,
      linkUrl: parsedTask.data.linkUrl ?? parsedTask.data.link_url ?? null,
      actionUrl: parsedTask.data.actionUrl ?? parsedTask.data.action_url ?? null,
      actionLabel: parsedTask.data.actionLabel ?? parsedTask.data.action_label ?? null,
      completionGuidance:
        parsedTask.data.completionGuidance ?? parsedTask.data.completion_guidance ?? null
    });
  }

  return tasks;
}

export async function createOnboardingInstance({
  supabase,
  orgId,
  employee,
  template,
  type,
  startedAt,
  creatingAdminId
}: CreateOnboardingInstanceInput): Promise<{
  instance: OnboardingInstanceSummary;
}> {
  const startTimestamp = resolveOnboardingStartTimestamp(startedAt);
  const instanceType = type ?? template.type;

  const { data: insertedInstance, error: insertInstanceError } = await supabase
    .from("onboarding_instances")
    .insert({
      org_id: orgId,
      employee_id: employee.id,
      template_id: template.id,
      type: instanceType,
      status: "active",
      started_at: startTimestamp
    })
    .select("id, employee_id, template_id, type, status, started_at, completed_at")
    .single();

  if (insertInstanceError || !insertedInstance) {
    throw new Error(insertInstanceError?.message ?? "Unable to create onboarding instance.");
  }

  const parsedInstance = createdInstanceRowSchema.safeParse(insertedInstance);

  if (!parsedInstance.success) {
    throw new Error("Created onboarding instance data is not in the expected shape.");
  }

  const normalizedTemplateTasks = normalizeTemplateTasks(template.tasks);
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
      org_id: orgId,
      instance_id: parsedInstance.data.id,
      title: task.title,
      description: task.description || null,
      category: task.category,
      track: task.track,
      status: ONBOARDING_TASK_STATUSES[0],
      assigned_to: task.track === "operations" && creatingAdminId
        ? creatingAdminId
        : employee.id,
      due_date: dueDate,
      task_type: task.taskType,
      document_id: task.documentId ?? null,
      action_url: task.actionUrl ?? task.linkUrl ?? null,
      action_label: task.actionLabel ?? (task.linkUrl ? "Open resource" : null),
      completion_guidance: task.completionGuidance
    };
  });

  if (taskRows.length > 0) {
    const { data: insertedTasks, error: insertTasksError } = await supabase
      .from("onboarding_tasks")
      .insert(taskRows)
      .select("id, task_type, document_id");

    if (insertTasksError) {
      await supabase
        .from("onboarding_instances")
        .update({
          deleted_at: new Date().toISOString()
        })
        .eq("id", parsedInstance.data.id)
        .eq("org_id", orgId);

      throw new Error("Onboarding instance was created but tasks could not be generated.");
    }

    // Auto-trigger signature requests for e_signature tasks with a document_id
    if (insertedTasks) {
      for (const insertedTask of insertedTasks) {
        if (
          insertedTask.task_type === "e_signature" &&
          insertedTask.document_id
        ) {
          try {
            // Create signature request
            const { data: sigRequest, error: sigError } = await supabase
              .from("signature_requests")
              .insert({
                org_id: orgId,
                document_id: insertedTask.document_id,
                title: `Onboarding: ${taskRows.find((_, idx) => insertedTasks[idx]?.id === insertedTask.id)?.title ?? "Document signature"}`,
                message: "Please review and sign this document as part of your onboarding.",
                status: "pending",
                created_by: employee.id
              })
              .select("id")
              .single();

            if (!sigError && sigRequest) {
              // Create signer entry
              await supabase.from("signature_signers").insert({
                org_id: orgId,
                signature_request_id: sigRequest.id,
                signer_user_id: employee.id,
                signer_order: 1,
                status: "pending"
              });

              // Link signature request to onboarding task
              await supabase
                .from("onboarding_tasks")
                .update({ signature_request_id: sigRequest.id })
                .eq("id", insertedTask.id)
                .eq("org_id", orgId);

              // Notify employee about signature request
              await createNotification({
                orgId,
                userId: employee.id,
                type: "signature_request",
                title: "Document requires your signature",
                body: "A document needs your signature as part of your onboarding. Tap to sign.",
                link: "/signatures"
              });
            }
          } catch {
            // Non-critical: log but don't fail onboarding creation
            console.error("Unable to auto-trigger signature for onboarding task.", {
              taskId: insertedTask.id,
              documentId: insertedTask.document_id
            });
          }
        }
      }
    }
  }

  const employeeTaskCount = taskRows.filter((t) => t.track === "employee").length;
  const opsTaskCount = taskRows.filter((t) => t.track === "operations").length;

  return {
    instance: {
      id: parsedInstance.data.id,
      employeeId: parsedInstance.data.employee_id,
      employeeName: employee.fullName,
      templateId: parsedInstance.data.template_id,
      templateName: template.name,
      type: parsedInstance.data.type,
      status: parsedInstance.data.status,
      startedAt: parsedInstance.data.started_at,
      completedAt: parsedInstance.data.completed_at,
      totalTasks: taskRows.length,
      completedTasks: 0,
      progressPercent: 0,
      employeeTrack: { total: employeeTaskCount, completed: 0, percent: 0 },
      operationsTrack: { total: opsTaskCount, completed: 0, percent: 0 }
    }
  };
}
