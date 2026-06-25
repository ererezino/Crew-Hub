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
 * Both completion paths now share this computation (ONBOARD-01): the manual
 * task-completion route AND the signatures sign route call findUnlockableTasks
 * after a completion, so a task completed by signature unlocks its dependents
 * immediately. The signatures route additionally rejects signing while a
 * linked task's prerequisites are incomplete. The unlock computation stays
 * deliberately self-healing — it unlocks ANY blocked task whose prerequisites
 * are all complete — so a missed pass is still repaired by the next completion.
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
