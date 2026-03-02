import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import {
  ONBOARDING_TASK_STATUSES,
  ONBOARDING_TYPES,
  type OnboardingInstanceSummary,
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
};

const templateTaskSchema = z.object({
  title: z.string(),
  description: z.string().default(""),
  category: z.string(),
  dueOffsetDays: z.number().int().nullable().optional(),
  due_offset_days: z.number().int().nullable().optional()
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

export function normalizeTemplateTasks(value: unknown): Array<{
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

export async function createOnboardingInstance({
  supabase,
  orgId,
  employee,
  template,
  type,
  startedAt
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
      status: ONBOARDING_TASK_STATUSES[0],
      assigned_to: employee.id,
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
        .eq("org_id", orgId);

      throw new Error("Onboarding instance was created but tasks could not be generated.");
    }
  }

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
      progressPercent: 0
    }
  };
}
