import type { ShiftRecord } from "../../types/scheduling";

/**
 * Shared shift display rules (SCHED-01).
 *
 * Two invariants every scheduling surface must honour identically:
 *
 *  1. "Open" status is a property of assignment, NEVER of display metadata.
 *     A shift is open iff it has no assignee (`employee_id IS NULL`). An
 *     assigned shift whose name failed to resolve is STILL assigned and must
 *     never be relabelled as open.
 *
 *  2. When an assigned shift is missing a resolved name we show a defensive
 *     label ("Crew member") and emit a monitored invariant error, rather than
 *     silently rendering "Unknown" or, worse, "Open".
 */

export function isOpenShift(shift: Pick<ShiftRecord, "employeeId">): boolean {
  return shift.employeeId === null;
}

/** Stable prefix so the invariant is greppable/alertable in logs. */
const INVARIANT_PREFIX = "[SCHEDULING_INVARIANT]";

/** Emit a monitored invariant error. Non-throwing — the UI must still render. */
export function reportSchedulingInvariant(message: string, context?: Record<string, unknown>): void {
  // console.error is the monitored channel in both the browser and the server
  // runtime; tests assert on it directly.
  console.error(`${INVARIANT_PREFIX} ${message}`, context ?? {});
}

/**
 * Resolve the display name for a shift cell/badge.
 *
 * @param openLabel    e.g. t("calendar.openShift")
 * @param crewFallback e.g. t("calendar.crewMemberFallback")
 */
export function resolveShiftDisplayName(
  shift: Pick<ShiftRecord, "employeeId" | "employeeName">,
  openLabel: string,
  crewFallback: string
): string {
  if (isOpenShift(shift)) {
    return openLabel;
  }

  const name = shift.employeeName?.trim();
  if (name) {
    return name;
  }

  // Assigned, but the name did not resolve. Keep it assigned; flag the gap.
  reportSchedulingInvariant("Assigned shift is missing a resolved employee name.", {
    employeeId: shift.employeeId
  });
  return crewFallback;
}
