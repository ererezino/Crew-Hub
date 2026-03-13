import { NextResponse } from "next/server";

import { createSupabaseServiceRoleClient } from "../../../../lib/supabase/service-role";
import { createNotification } from "../../../../lib/notifications/service";
import { logger } from "../../../../lib/logger";

/**
 * Daily cron endpoint: onboarding task reminders.
 *
 * Triggered by Vercel Cron daily at 08:00 UTC.
 * Protected by CRON_SECRET header.
 *
 * Logic:
 * 1. Overdue tasks: employee-track tasks past due → notify employee
 * 2. Overdue ops tasks: operations-track tasks past due → notify org admins
 * 3. Employee waiting: employee track 100% but ops track incomplete → notify admins
 * 4. Stale instances: no task completed in 3+ days → notify both
 */

function offsetDate(days: number): string {
  const now = new Date();
  now.setUTCDate(now.getUTCDate() + days);
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

type TaskRow = {
  id: string;
  instance_id: string;
  title: string;
  track: string;
  status: string;
  due_date: string | null;
  assigned_to: string | null;
  completed_at: string | null;
  onboarding_instances: {
    id: string;
    org_id: string;
    employee_id: string;
    status: string;
    profiles: {
      full_name: string;
    } | null;
  } | null;
};

async function getAdminIdsForOrg(
  supabase: ReturnType<typeof createSupabaseServiceRoleClient>,
  orgId: string
): Promise<string[]> {
  const { data: rows, error } = await supabase
    .from("profiles")
    .select("id, roles")
    .eq("org_id", orgId)
    .is("deleted_at", null);

  if (error || !rows) return [];

  return rows
    .filter((row) => {
      const roles = Array.isArray(row.roles) ? row.roles : [];
      return roles.includes("HR_ADMIN") || roles.includes("SUPER_ADMIN");
    })
    .map((row) => row.id);
}

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createSupabaseServiceRoleClient();
  const today = offsetDate(0);
  const threeDaysAgo = offsetDate(-3);

  let overdueEmployeeNotifs = 0;
  let overdueOpsNotifs = 0;
  let employeeWaitingNotifs = 0;
  let staleNotifs = 0;

  try {
    // ─── 1. Overdue employee-track tasks ───

    const { data: overdueEmployeeTasks } = await supabase
      .from("onboarding_tasks")
      .select(
        "id, instance_id, title, track, status, due_date, assigned_to, completed_at, onboarding_instances(id, org_id, employee_id, status, profiles(full_name))"
      )
      .eq("track", "employee")
      .eq("status", "pending")
      .lt("due_date", today)
      .is("deleted_at", null)
      .not("onboarding_instances", "is", null) as { data: TaskRow[] | null };

    if (overdueEmployeeTasks) {
      // Group by employee to send one notification per person
      const byEmployee = new Map<string, TaskRow[]>();

      for (const task of overdueEmployeeTasks) {
        if (!task.onboarding_instances || task.onboarding_instances.status !== "active") continue;
        const empId = task.onboarding_instances.employee_id;
        const existing = byEmployee.get(empId) ?? [];
        existing.push(task);
        byEmployee.set(empId, existing);
      }

      for (const [employeeId, tasks] of byEmployee.entries()) {
        await createNotification({
          orgId: tasks[0].onboarding_instances!.org_id,
          userId: employeeId,
          type: "onboarding_reminder",
          title: "You have overdue onboarding tasks",
          body: `${tasks.length} onboarding task${tasks.length > 1 ? "s are" : " is"} past due. Please complete them as soon as possible.`,
          link: "/me/onboarding",
          skipIfUnreadDuplicate: true
        }).catch(() => {});
        overdueEmployeeNotifs++;
      }
    }

    // ─── 2. Overdue operations-track tasks ───

    const { data: overdueOpsTasks } = await supabase
      .from("onboarding_tasks")
      .select(
        "id, instance_id, title, track, status, due_date, assigned_to, completed_at, onboarding_instances(id, org_id, employee_id, status, profiles(full_name))"
      )
      .eq("track", "operations")
      .eq("status", "pending")
      .lt("due_date", today)
      .is("deleted_at", null) as { data: TaskRow[] | null };

    if (overdueOpsTasks) {
      // Group by org to notify admins once per org
      const byOrg = new Map<string, { tasks: TaskRow[]; employeeNames: Set<string> }>();

      for (const task of overdueOpsTasks) {
        if (!task.onboarding_instances || task.onboarding_instances.status !== "active") continue;
        const orgId = task.onboarding_instances.org_id;
        const entry = byOrg.get(orgId) ?? { tasks: [], employeeNames: new Set() };
        entry.tasks.push(task);
        entry.employeeNames.add(task.onboarding_instances.profiles?.full_name ?? "an employee");
        byOrg.set(orgId, entry);
      }

      for (const [orgId, { tasks, employeeNames }] of byOrg.entries()) {
        const adminIds = await getAdminIdsForOrg(supabase, orgId);
        const names = [...employeeNames].slice(0, 3).join(", ");

        for (const adminId of adminIds) {
          await createNotification({
            orgId,
            userId: adminId,
            type: "onboarding_reminder",
            title: "Overdue operations tasks",
            body: `${tasks.length} operations task${tasks.length > 1 ? "s" : ""} for ${names} ${tasks.length > 1 ? "are" : "is"} past due.`,
            link: "/onboarding",
            skipIfUnreadDuplicate: true
          }).catch(() => {});
          overdueOpsNotifs++;
        }
      }
    }

    // ─── 3. Employee waiting (employee track 100%, ops incomplete) ───

    const { data: activeInstances } = await supabase
      .from("onboarding_instances")
      .select("id, org_id, employee_id, status, profiles(full_name)")
      .eq("status", "active")
      .is("deleted_at", null);

    if (activeInstances) {
      for (const instance of activeInstances) {
        const { data: tasks } = await supabase
          .from("onboarding_tasks")
          .select("id, track, status")
          .eq("instance_id", instance.id)
          .is("deleted_at", null);

        if (!tasks || tasks.length === 0) continue;

        const employeeTasks = tasks.filter((t) => t.track === "employee");
        const opsTasks = tasks.filter((t) => t.track === "operations");
        const employeeDone = employeeTasks.length > 0 && employeeTasks.every((t) => t.status === "completed");
        const opsIncomplete = opsTasks.some((t) => t.status !== "completed");

        if (employeeDone && opsIncomplete) {
          const employeeName = (instance as unknown as { profiles: { full_name: string } | null }).profiles?.full_name ?? "Employee";
          const adminIds = await getAdminIdsForOrg(supabase, instance.org_id);

          for (const adminId of adminIds) {
            await createNotification({
              orgId: instance.org_id,
              userId: adminId,
              type: "onboarding_reminder",
              title: `${employeeName} is waiting on your team`,
              body: `${employeeName} has completed all their onboarding tasks. Operations tasks are still pending.`,
              link: `/onboarding/${instance.id}`,
              skipIfUnreadDuplicate: true
            }).catch(() => {});
            employeeWaitingNotifs++;
          }
        }

        // ─── 4. Stale instances (no completion in 3+ days) ───

        const completedTasks = tasks.filter((t) => t.status === "completed");
        const pendingTasks = tasks.filter((t) => t.status !== "completed");

        if (pendingTasks.length > 0 && completedTasks.length > 0) {
          // Check if last completion was 3+ days ago
          const { data: recentCompletions } = await supabase
            .from("onboarding_tasks")
            .select("completed_at")
            .eq("instance_id", instance.id)
            .eq("status", "completed")
            .order("completed_at", { ascending: false })
            .limit(1);

          if (recentCompletions && recentCompletions.length > 0) {
            const lastCompleted = recentCompletions[0].completed_at;
            if (lastCompleted && lastCompleted < `${threeDaysAgo}T00:00:00`) {
              const employeeName = (instance as unknown as { profiles: { full_name: string } | null }).profiles?.full_name ?? "Employee";

              // Notify employee
              await createNotification({
                orgId: instance.org_id,
                userId: instance.employee_id,
                type: "onboarding_reminder",
                title: "Continue your onboarding",
                body: "It's been a few days since your last onboarding activity. Pick up where you left off!",
                link: "/me/onboarding",
                skipIfUnreadDuplicate: true
              }).catch(() => {});

              // Notify admins
              const adminIds = await getAdminIdsForOrg(supabase, instance.org_id);
              for (const adminId of adminIds) {
                await createNotification({
                  orgId: instance.org_id,
                  userId: adminId,
                  type: "onboarding_reminder",
                  title: `${employeeName}'s onboarding needs attention`,
                  body: `No onboarding activity for ${employeeName} in the last 3 days.`,
                  link: `/onboarding/${instance.id}`,
                  skipIfUnreadDuplicate: true
                }).catch(() => {});
              }
              staleNotifs++;
            }
          }
        }
      }
    }

    logger.info("Onboarding reminders cron completed.", {
      overdueEmployeeNotifs,
      overdueOpsNotifs,
      employeeWaitingNotifs,
      staleNotifs
    });

    return NextResponse.json({
      ok: true,
      overdueEmployeeNotifs,
      overdueOpsNotifs,
      employeeWaitingNotifs,
      staleNotifs
    });
  } catch (error) {
    logger.error("Onboarding reminders cron failed.", {
      message: error instanceof Error ? error.message : String(error)
    });

    return NextResponse.json(
      { error: "Internal error" },
      { status: 500 }
    );
  }
}
