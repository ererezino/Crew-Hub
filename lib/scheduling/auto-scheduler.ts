/**
 * Auto-scheduler: generates draft shift assignments for a date range.
 *
 * Rules:
 *  - Weekday dates: only "weekday" and "flexible" employees
 *  - Weekend dates: "weekend_primary" (full Sat+Sun), "weekend_rotation" (evenly distributed), "flexible"
 *  - Blocked dates (approved leave, holidays) are skipped
 *  - No back-to-back close+open (ending >= 21:00 blocks next-day start <= 09:00)
 *  - Hours balanced within 10% across employees
 *  - Randomised to avoid predictable patterns
 */

export type EmployeeScheduleInfo = {
  id: string;
  fullName: string;
  scheduleType: "weekday" | "weekend_primary" | "weekend_rotation" | "flexible";
  blockedDates: string[]; // YYYY-MM-DD
};

export type ShiftSlot = {
  name: string;
  startTime: string; // HH:MM
  endTime: string; // HH:MM
};

export type GeneratedAssignment = {
  employeeId: string;
  shiftDate: string; // YYYY-MM-DD
  slotName: string;
  startTime: string;
  endTime: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function dateRange(start: string, end: string): string[] {
  const dates: string[] = [];
  const current = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);

  while (current <= last) {
    dates.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() + 1);
  }

  return dates;
}

function isWeekend(dateStr: string): boolean {
  const day = new Date(`${dateStr}T00:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

/** Convert "HH:MM" to minutes-since-midnight. */
function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}

/** Duration of a slot in hours. Handles overnight shifts. */
function slotHours(slot: ShiftSlot): number {
  let startMin = timeToMinutes(slot.startTime);
  let endMin = timeToMinutes(slot.endTime);

  if (endMin <= startMin) {
    endMin += 24 * 60; // overnight shift
  }

  return (endMin - startMin) / 60;
}

/** Fisher-Yates shuffle (in-place, returns the same array). */
function shuffle<T>(array: T[]): T[] {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j] as T, array[i] as T];
  }

  return array;
}

/** Check if assigning `slot` on `date` would create a close-then-open conflict. */
function isBackToBack(
  slot: ShiftSlot,
  date: string,
  employeeId: string,
  assignments: GeneratedAssignment[],
  slots: ShiftSlot[]
): boolean {
  const CLOSE_THRESHOLD = timeToMinutes("21:00");
  const OPEN_THRESHOLD = timeToMinutes("09:00");

  // Check if the current slot starts early and employee had a late shift yesterday
  const slotStart = timeToMinutes(slot.startTime);

  if (slotStart <= OPEN_THRESHOLD) {
    const prevDate = new Date(`${date}T00:00:00Z`);
    prevDate.setUTCDate(prevDate.getUTCDate() - 1);
    const prevDateStr = prevDate.toISOString().slice(0, 10);

    const prevAssignments = assignments.filter(
      (a) => a.employeeId === employeeId && a.shiftDate === prevDateStr
    );

    for (const prev of prevAssignments) {
      const prevSlot = slots.find((s) => s.name === prev.slotName);
      if (prevSlot && timeToMinutes(prevSlot.endTime) >= CLOSE_THRESHOLD) {
        return true;
      }
    }
  }

  // Check if the current slot ends late and employee has an early shift tomorrow
  const slotEnd = timeToMinutes(slot.endTime);

  if (slotEnd >= CLOSE_THRESHOLD) {
    const nextDate = new Date(`${date}T00:00:00Z`);
    nextDate.setUTCDate(nextDate.getUTCDate() + 1);
    const nextDateStr = nextDate.toISOString().slice(0, 10);

    const nextAssignments = assignments.filter(
      (a) => a.employeeId === employeeId && a.shiftDate === nextDateStr
    );

    for (const next of nextAssignments) {
      const nextSlot = slots.find((s) => s.name === next.slotName);
      if (nextSlot && timeToMinutes(nextSlot.startTime) <= OPEN_THRESHOLD) {
        return true;
      }
    }
  }

  return false;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export function autoGenerateSchedule(params: {
  employees: EmployeeScheduleInfo[];
  slots: ShiftSlot[];
  startDate: string;
  endDate: string;
  scheduleType: "weekday" | "weekend" | "holiday";
}): GeneratedAssignment[] {
  const { employees, slots, startDate, endDate, scheduleType } = params;

  if (employees.length === 0 || slots.length === 0) {
    return [];
  }

  const dates = dateRange(startDate, endDate);
  const assignments: GeneratedAssignment[] = [];

  // Track total hours per employee for balancing
  const hoursMap = new Map<string, number>();

  for (const emp of employees) {
    hoursMap.set(emp.id, 0);
  }

  // Build blocked-date sets for O(1) lookups
  const blockedSets = new Map<string, Set<string>>();

  for (const emp of employees) {
    blockedSets.set(emp.id, new Set(emp.blockedDates));
  }

  // Identify weekend-rotation employees for even distribution
  const weekendRotationIds = employees
    .filter((e) => e.scheduleType === "weekend_rotation")
    .map((e) => e.id);
  let rotationIndex = 0;

  // Process each date
  for (const date of dates) {
    const weekend = isWeekend(date);

    // Determine eligible employees for this date based on schedule type
    let eligible: EmployeeScheduleInfo[];

    if (scheduleType === "holiday") {
      // Holiday schedules: flexible employees only
      eligible = employees.filter((e) => e.scheduleType === "flexible");
    } else if (weekend) {
      // Weekend dates
      eligible = employees.filter(
        (e) =>
          e.scheduleType === "weekend_primary" ||
          e.scheduleType === "weekend_rotation" ||
          e.scheduleType === "flexible"
      );
    } else {
      // Weekday dates
      eligible = employees.filter(
        (e) => e.scheduleType === "weekday" || e.scheduleType === "flexible"
      );
    }

    // Remove blocked employees
    eligible = eligible.filter((e) => !blockedSets.get(e.id)?.has(date));

    if (eligible.length === 0) {
      continue;
    }

    // For each slot on this date, pick the best candidate
    for (const slot of slots) {
      const hours = slotHours(slot);

      // For weekend rotation, only include the rotation employee scheduled for this weekend
      let candidates: EmployeeScheduleInfo[];

      if (weekend && scheduleType !== "holiday") {
        candidates = eligible.filter((e) => {
          if (e.scheduleType === "weekend_rotation") {
            // Only include if it's this employee's rotation turn
            const idx = weekendRotationIds.indexOf(e.id);
            if (idx === -1) return false;
            return idx === rotationIndex % weekendRotationIds.length;
          }

          return true;
        });
      } else {
        candidates = [...eligible];
      }

      // Filter out back-to-back conflicts
      candidates = candidates.filter(
        (e) => !isBackToBack(slot, date, e.id, assignments, slots)
      );

      // Filter out employees already assigned to a slot on this date
      const assignedOnDate = new Set(
        assignments.filter((a) => a.shiftDate === date).map((a) => a.employeeId)
      );
      candidates = candidates.filter((e) => !assignedOnDate.has(e.id));

      if (candidates.length === 0) {
        continue;
      }

      // Sort by fewest hours (balancing), then shuffle within tied groups
      candidates.sort((a, b) => {
        const hoursA = hoursMap.get(a.id) ?? 0;
        const hoursB = hoursMap.get(b.id) ?? 0;
        return hoursA - hoursB;
      });

      // Find the group of candidates with the minimum hours and shuffle them
      const minHours = hoursMap.get(candidates[0]!.id) ?? 0;
      const threshold = minHours * 1.1; // 10% tolerance
      const tiedCandidates = candidates.filter(
        (c) => (hoursMap.get(c.id) ?? 0) <= threshold
      );
      shuffle(tiedCandidates);

      const chosen = tiedCandidates[0]!;

      assignments.push({
        employeeId: chosen.id,
        shiftDate: date,
        slotName: slot.name,
        startTime: slot.startTime,
        endTime: slot.endTime
      });

      hoursMap.set(chosen.id, (hoursMap.get(chosen.id) ?? 0) + hours);
    }

    // Advance rotation counter at the end of each Sunday
    if (weekend && new Date(`${date}T00:00:00Z`).getUTCDay() === 0) {
      rotationIndex++;
    }
  }

  // Balance pass: if any employee exceeds 10% over the mean, attempt swaps
  const totalHours = [...hoursMap.values()].reduce((sum, h) => sum + h, 0);
  const activeEmployees = [...hoursMap.entries()].filter(([, h]) => h > 0);
  const meanHours =
    activeEmployees.length > 0 ? totalHours / activeEmployees.length : 0;
  const upperBound = meanHours * 1.1;

  for (const [empId, empHours] of hoursMap) {
    if (empHours <= upperBound) continue;

    // Find assignments for this overloaded employee, sorted by date descending
    const empAssignments = assignments
      .filter((a) => a.employeeId === empId)
      .sort((a, b) => b.shiftDate.localeCompare(a.shiftDate));

    for (const assignment of empAssignments) {
      if ((hoursMap.get(empId) ?? 0) <= upperBound) break;

      const slot = slots.find((s) => s.name === assignment.slotName);
      if (!slot) continue;

      const hours = slotHours(slot);
      const date = assignment.shiftDate;
      const weekend = isWeekend(date);

      // Find an underloaded candidate for this slot
      const lowerBound = meanHours * 0.9;
      const underloaded = employees.filter((e) => {
        if (e.id === empId) return false;
        if ((hoursMap.get(e.id) ?? 0) >= lowerBound) return false;
        if (blockedSets.get(e.id)?.has(date)) return false;

        // Check schedule type eligibility
        if (weekend) {
          if (
            e.scheduleType !== "weekend_primary" &&
            e.scheduleType !== "weekend_rotation" &&
            e.scheduleType !== "flexible"
          )
            return false;
        } else {
          if (e.scheduleType !== "weekday" && e.scheduleType !== "flexible")
            return false;
        }

        // No back-to-back
        if (isBackToBack(slot, date, e.id, assignments, slots)) return false;

        // Not already assigned on this date
        const assignedOnDate = assignments.some(
          (a) => a.shiftDate === date && a.employeeId === e.id
        );
        if (assignedOnDate) return false;

        return true;
      });

      if (underloaded.length === 0) continue;

      shuffle(underloaded);
      const replacement = underloaded[0]!;

      // Perform swap
      assignment.employeeId = replacement.id;
      hoursMap.set(empId, (hoursMap.get(empId) ?? 0) - hours);
      hoursMap.set(replacement.id, (hoursMap.get(replacement.id) ?? 0) + hours);
    }
  }

  return assignments;
}
