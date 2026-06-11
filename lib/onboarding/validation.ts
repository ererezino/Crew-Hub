import { z } from "zod";

/**
 * Zod schema for onboarding task action URLs.
 *
 * Accepts:
 * - Relative internal app paths starting with "/" (e.g. "/me/profile", "/documents?category=policy")
 * - Absolute http/https URLs (e.g. "https://slack.com/invite")
 * - null / undefined (handled by chaining .nullable().optional() at call sites)
 *
 * Rejects:
 * - Malformed strings that are neither a relative path nor a valid http/https URL
 * - javascript: URLs
 * - Protocol-relative URLs (//example.com)
 * - Other non-http schemes (ftp:, data:, etc.)
 */
export const actionUrlSchema = z
  .string()
  .trim()
  .max(500, "Action URL is too long.")
  .refine(
    (val) => {
      // Allow relative internal paths starting with a single slash
      if (val.startsWith("/") && !val.startsWith("//")) {
        return true;
      }

      // For everything else, require a valid http or https URL
      try {
        const parsed = new URL(val);
        return parsed.protocol === "http:" || parsed.protocol === "https:";
      } catch {
        return false;
      }
    },
    "Action URL must be a relative path (starting with /) or a valid http/https URL."
  );

/**
 * Zod schema for a template task's `dependsOnTaskIndexes` field — positions of
 * prerequisite tasks within the same template's tasks array. Chain
 * `.optional()` at call sites; an absent field means "no dependencies".
 *
 * Structural rules (in-range, no self-reference, no cycles) span the whole
 * tasks array, so they live in `validateTaskDependencies` rather than here.
 */
export const dependsOnTaskIndexesSchema = z
  .array(
    z
      .number()
      .int("Task dependency positions must be whole numbers.")
      .min(0, "Task dependency positions must be 0 or greater.")
  )
  .max(50, "A task can depend on at most 50 other tasks.");

export type TaskDependencyValidationResult =
  | { ok: true }
  | { ok: false; message: string };

type TaskWithDependencyIndexes = {
  dependsOnTaskIndexes?: number[] | null;
};

/**
 * Validates the dependency graph of a template's tasks array:
 * - every referenced index must exist in the array
 * - a task cannot depend on itself
 * - the graph must be acyclic (DFS three-colour check)
 *
 * Cross-track dependencies (employee <-> operations) are intentionally
 * ALLOWED: both tracks live as onboarding_tasks rows inside the same
 * instance, are completable at any time through the same completion route
 * while the instance is active, and instance completion requires both tracks
 * to reach 100%. A prerequisite on the other track is therefore always
 * satisfiable within the lifetime of one instance.
 */
export function validateTaskDependencies(
  tasks: readonly TaskWithDependencyIndexes[]
): TaskDependencyValidationResult {
  for (let index = 0; index < tasks.length; index++) {
    const dependencyIndexes = tasks[index]?.dependsOnTaskIndexes ?? [];

    for (const dependencyIndex of dependencyIndexes) {
      if (
        !Number.isInteger(dependencyIndex) ||
        dependencyIndex < 0 ||
        dependencyIndex >= tasks.length
      ) {
        return {
          ok: false,
          message: `Task ${index + 1} depends on task position ${dependencyIndex}, which does not exist in this template.`
        };
      }

      if (dependencyIndex === index) {
        return {
          ok: false,
          message: `Task ${index + 1} cannot depend on itself.`
        };
      }
    }
  }

  // Cycle detection: 0 = unvisited, 1 = on the current DFS stack, 2 = done.
  const visitState = new Array<number>(tasks.length).fill(0);

  function hasCycleFrom(index: number): boolean {
    if (visitState[index] === 1) {
      return true;
    }

    if (visitState[index] === 2) {
      return false;
    }

    visitState[index] = 1;

    for (const dependencyIndex of tasks[index]?.dependsOnTaskIndexes ?? []) {
      if (hasCycleFrom(dependencyIndex)) {
        return true;
      }
    }

    visitState[index] = 2;
    return false;
  }

  for (let index = 0; index < tasks.length; index++) {
    if (visitState[index] === 0 && hasCycleFrom(index)) {
      return {
        ok: false,
        message:
          "Task dependencies form a cycle. Tasks cannot directly or indirectly depend on each other."
      };
    }
  }

  return { ok: true };
}
