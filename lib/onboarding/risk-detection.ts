import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { ONBOARDING_TASK_STATUSES } from "../../types/onboarding";

/* ─── Public types ─── */

export type AtRiskStuckTask = {
  id: string;
  title: string;
  daysPastDue: number;
};

export type AtRiskInstance = {
  instanceId: string;
  employeeId: string;
  employeeName: string;
  startedAt: string;
  daysSinceLastActivity: number;
  totalTasks: number;
  completedTasks: number;
  stuckTask: AtRiskStuckTask | null;
};

export type AtRiskOnboardingsResponseData = {
  instances: AtRiskInstance[];
};

/* ─── Row schemas ─── */

const instanceRowSchema = z.object({
  id: z.string().uuid(),
  employee_id: z.string().uuid(),
  started_at: z.string(),
  updated_at: z.string()
});

const profileRowSchema = z.object({
  id: z.string().uuid(),
  full_name: z.string()
});

const taskRowSchema = z.object({
  id: z.string().uuid(),
  instance_id: z.string().uuid(),
  title: z.string(),
  status: z.enum(ONBOARDING_TASK_STATUSES),
  due_date: z.string().nullable(),
  updated_at: z.string()
});

/* ─── Constants ─── */

const INACTIVITY_THRESHOLD_DAYS = 3;

/* ─── Helpers ─── */

function daysBetween(earlier: Date, later: Date): number {
  const differenceMs = later.getTime() - earlier.getTime();
  return Math.floor(differenceMs / (1000 * 60 * 60 * 24));
}

/* ─── Main query ─── */

export async function getAtRiskOnboardings(
  supabase: SupabaseClient,
  orgId: string
): Promise<AtRiskInstance[]> {
  const now = new Date();

  // 1. Fetch all in-progress (active) instances
  const { data: rawInstances, error: instancesError } = await supabase
    .from("onboarding_instances")
    .select("id, employee_id, started_at, updated_at")
    .eq("org_id", orgId)
    .eq("status", "active")
    .is("deleted_at", null);

  if (instancesError || !rawInstances || rawInstances.length === 0) {
    return [];
  }

  const parsedInstances = z.array(instanceRowSchema).safeParse(rawInstances);

  if (!parsedInstances.success) {
    return [];
  }

  const instances = parsedInstances.data;
  const instanceIds = instances.map((row) => row.id);
  const employeeIds = [...new Set(instances.map((row) => row.employee_id))];

  // 2. Fetch employee names and tasks in parallel
  const [
    { data: employeeRows, error: employeeError },
    { data: taskRows, error: tasksError }
  ] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name")
      .eq("org_id", orgId)
      .is("deleted_at", null)
      .in("id", employeeIds),
    supabase
      .from("onboarding_tasks")
      .select("id, instance_id, title, status, due_date, updated_at")
      .eq("org_id", orgId)
      .is("deleted_at", null)
      .in("instance_id", instanceIds)
  ]);

  if (employeeError || tasksError) {
    return [];
  }

  const parsedEmployees = z.array(profileRowSchema).safeParse(employeeRows ?? []);
  const parsedTasks = z.array(taskRowSchema).safeParse(taskRows ?? []);

  if (!parsedEmployees.success || !parsedTasks.success) {
    return [];
  }

  const employeeNameById = new Map(
    parsedEmployees.data.map((row) => [row.id, row.full_name])
  );

  // 3. Group tasks by instance
  const tasksByInstanceId = new Map<string, z.infer<typeof taskRowSchema>[]>();

  for (const task of parsedTasks.data) {
    const existing = tasksByInstanceId.get(task.instance_id) ?? [];
    existing.push(task);
    tasksByInstanceId.set(task.instance_id, existing);
  }

  // 4. Evaluate each instance for risk
  const atRiskInstances: AtRiskInstance[] = [];

  for (const instance of instances) {
    const tasks = tasksByInstanceId.get(instance.id) ?? [];
    const totalTasks = tasks.length;
    const completedTasks = tasks.filter((task) => task.status === "completed").length;

    // Calculate days since last activity using the most recent task update or instance update
    const allTimestamps = [
      new Date(instance.updated_at),
      ...tasks.map((task) => new Date(task.updated_at))
    ];
    const mostRecentActivity = new Date(
      Math.max(...allTimestamps.map((date) => date.getTime()))
    );
    const daysSinceLastActivity = daysBetween(mostRecentActivity, now);

    // Find the most overdue incomplete task
    let stuckTask: AtRiskStuckTask | null = null;
    let maxDaysPastDue = 0;

    for (const task of tasks) {
      if (task.status === "completed") {
        continue;
      }

      if (task.due_date) {
        const dueDate = new Date(task.due_date + "T23:59:59.999Z");
        const daysPastDue = daysBetween(dueDate, now);

        if (daysPastDue > 0 && daysPastDue > maxDaysPastDue) {
          maxDaysPastDue = daysPastDue;
          stuckTask = {
            id: task.id,
            title: task.title,
            daysPastDue
          };
        }
      }
    }

    // Flag as at-risk if inactive 3+ days OR has overdue tasks
    const isInactive = daysSinceLastActivity >= INACTIVITY_THRESHOLD_DAYS;
    const hasOverdueTasks = stuckTask !== null;

    if (isInactive || hasOverdueTasks) {
      atRiskInstances.push({
        instanceId: instance.id,
        employeeId: instance.employee_id,
        employeeName: employeeNameById.get(instance.employee_id) ?? "Unknown user",
        startedAt: instance.started_at,
        daysSinceLastActivity,
        totalTasks,
        completedTasks,
        stuckTask
      });
    }
  }

  // 5. Sort by days since last activity descending
  atRiskInstances.sort(
    (left, right) => right.daysSinceLastActivity - left.daysSinceLastActivity
  );

  return atRiskInstances;
}
