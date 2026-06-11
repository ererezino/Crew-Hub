/**
 * Pure helpers for the onboarding task dependency model.
 *
 * Instance tasks (onboarding_tasks rows) carry `depends_on_task_ids uuid[]` —
 * ids of sibling tasks in the same instance that must be completed before
 * this task may start. Tasks with unmet prerequisites hold status 'blocked';
 * when the last prerequisite completes they flip to 'pending'.
 *
 * These functions only COMPUTE transitions; callers perform the updates,
 * notifications, and audit entries (see the task completion route).
 *
 * KNOWN GAP: e-signature tasks linked to a signature request are completed by
 * the signatures sign route, which does not yet run an unlock pass. The
 * unlock computation here is deliberately self-healing — it unlocks ANY
 * blocked task whose prerequisites are all complete, not just direct
 * dependents of the task that just completed — so the next completion through
 * the onboarding route repairs any unlock missed by the signatures path.
 */

export type DependencyTaskRow = {
  id: string;
  status: string;
  depends_on_task_ids: string[] | null;
  assigned_to: string | null;
  title: string;
};

function dependenciesOf(task: DependencyTaskRow): string[] {
  return Array.isArray(task.depends_on_task_ids) ? task.depends_on_task_ids : [];
}

/**
 * Returns the blocked tasks whose prerequisites are now ALL completed and
 * should therefore flip 'blocked' → 'pending'.
 *
 * A prerequisite id that no longer resolves to a task in the list (e.g. the
 * row was soft-deleted) counts as satisfied — otherwise the dependent could
 * never unlock.
 */
export function findUnlockableTasks(tasks: readonly DependencyTaskRow[]): DependencyTaskRow[] {
  const statusById = new Map(tasks.map((task) => [task.id, task.status]));

  return tasks.filter((task) => {
    if (task.status !== "blocked") {
      return false;
    }

    const dependencyIds = dependenciesOf(task);

    if (dependencyIds.length === 0) {
      // Blocked without recorded prerequisites (legacy/manual block) — leave
      // it alone; nothing in the dependency model can unlock it.
      return false;
    }

    return dependencyIds.every((dependencyId) => {
      const dependencyStatus = statusById.get(dependencyId);
      return dependencyStatus === undefined || dependencyStatus === "completed";
    });
  });
}

/**
 * Returns the tasks that should flip 'pending' → 'blocked' after the task
 * with `reopenedTaskId` was reopened (completion undone): direct dependents
 * that are still 'pending'. Tasks already 'in_progress' or 'completed' are
 * left untouched — work already started is not retroactively blocked.
 */
export function findReblockableTasks(
  tasks: readonly DependencyTaskRow[],
  reopenedTaskId: string
): DependencyTaskRow[] {
  return tasks.filter(
    (task) =>
      task.status === "pending" && dependenciesOf(task).includes(reopenedTaskId)
  );
}
