/**
 * Auto-scheduler: generates draft shift assignments for a date range.
 *
 * Rules:
 *  - Weekday dates: "weekday"/"flexible" employees, plus weekend workers on Thu/Fri support days
 *  - Weekend dates: "weekend_primary" (full Sat+Sun), "weekend_rotation" (evenly distributed), "flexible"
 *  - If `respectEmployeeScheduleType` is false, selected roster members are all eligible
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
  weekendHours?: "2" | "3" | "4" | "8"; // shift duration in hours
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

function isThursdayOrFriday(dateStr: string): boolean {
  const day = new Date(`${dateStr}T00:00:00Z`).getUTCDay();
  return day === 4 || day === 5;
}

/** Convert "HH:MM" to minutes-since-midnight. */
function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}

/** Duration of a slot in hours. Handles overnight shifts. */
function slotHours(slot: ShiftSlot): number {
  const startMin = timeToMinutes(slot.startTime);
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
      if (!prevSlot) {
        continue;
      }

      const prevStart = timeToMinutes(prevSlot.startTime);
      let prevEnd = timeToMinutes(prevSlot.endTime);
      if (prevEnd <= prevStart) {
        prevEnd += 24 * 60;
      }

      if (prevEnd >= CLOSE_THRESHOLD) {
        return true;
      }
    }
  }

  // Check if the current slot ends late and employee has an early shift tomorrow
  let slotEnd = timeToMinutes(slot.endTime);
  if (slotEnd <= slotStart) {
    slotEnd += 24 * 60;
  }

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

function isEligibleForDate({
  employee,
  date,
  weekend,
  scheduleType,
  respectEmployeeScheduleType
}: {
  employee: EmployeeScheduleInfo;
  date: string;
  weekend: boolean;
  scheduleType: "weekday" | "weekend" | "holiday";
  respectEmployeeScheduleType: boolean;
}): boolean {
  if (!respectEmployeeScheduleType) {
    return true;
  }

  if (scheduleType === "holiday") {
    return employee.scheduleType === "flexible";
  }

  if (weekend) {
    return (
      employee.scheduleType === "weekend_primary" ||
      employee.scheduleType === "weekend_rotation" ||
      employee.scheduleType === "flexible"
    );
  }

  if (
    employee.scheduleType === "weekday" ||
    employee.scheduleType === "flexible"
  ) {
    return true;
  }

  // Weekend workers still cover two weekday support days (Thu/Fri).
  if (
    (employee.scheduleType === "weekend_primary" ||
      employee.scheduleType === "weekend_rotation") &&
    isThursdayOrFriday(date)
  ) {
    return true;
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
  respectEmployeeScheduleType?: boolean;
}): GeneratedAssignment[] {
  const {
    employees,
    slots,
    startDate,
    endDate,
    scheduleType,
    respectEmployeeScheduleType = true
  } = params;

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

  // Process each date
  for (const date of dates) {
    const weekend = isWeekend(date);

    // Respect selected track: weekday schedules skip weekend dates, and vice versa.
    if (scheduleType === "weekday" && weekend) {
      continue;
    }
    if (scheduleType === "weekend" && !weekend) {
      continue;
    }

    // Determine eligible employees for this date based on schedule type.
    let eligible = employees.filter((employee) =>
      isEligibleForDate({
        employee,
        date,
        weekend,
        scheduleType,
        respectEmployeeScheduleType
      })
    );

    // Remove blocked employees
    eligible = eligible.filter((e) => !blockedSets.get(e.id)?.has(date));

    if (eligible.length === 0) {
      continue;
    }

    // Assign enough rows so every available teammate gets work each required day.
    // If available teammates are fewer than slot count, allow re-use to keep slot coverage.
    const requiredAssignments = Math.max(eligible.length, slots.length);
    const baseAssignmentsPerSlot = Math.floor(requiredAssignments / slots.length);
    const remainderAssignments = requiredAssignments % slots.length;
    const assignedOnDate = new Set<string>();

    for (let slotIndex = 0; slotIndex < slots.length; slotIndex++) {
      const slot = slots[slotIndex]!;
      const hours = slotHours(slot);
      const targetAssignmentsForSlot =
        baseAssignmentsPerSlot + (slotIndex < remainderAssignments ? 1 : 0);

      for (let assignmentIndex = 0; assignmentIndex < targetAssignmentsForSlot; assignmentIndex++) {
        const candidates = eligible.filter(
          (employee) => !isBackToBack(slot, date, employee.id, assignments, slots)
        );

        const unassignedCandidates = candidates.filter(
          (employee) => !assignedOnDate.has(employee.id)
        );
        const candidatePool =
          unassignedCandidates.length > 0 ? unassignedCandidates : candidates;

        if (candidatePool.length === 0) {
          continue;
        }

        candidatePool.sort((left, right) => {
          const leftHours = hoursMap.get(left.id) ?? 0;
          const rightHours = hoursMap.get(right.id) ?? 0;
          return leftHours - rightHours;
        });

        const minHours = hoursMap.get(candidatePool[0]!.id) ?? 0;
        const threshold = minHours * 1.1; // 10% tolerance
        const tiedCandidates = candidatePool.filter(
          (candidate) => (hoursMap.get(candidate.id) ?? 0) <= threshold
        );
        shuffle(tiedCandidates);

        const chosen = tiedCandidates[0]!;
        const assignedStartTime = slot.startTime;
        let assignedEndTime = slot.endTime;
        let assignedHours = hours;

        if (weekend && chosen.weekendHours && chosen.weekendHours !== "8") {
          const targetHours = Number(chosen.weekendHours);
          if (targetHours < hours) {
            const startMin = timeToMinutes(slot.startTime);
            const shortEndMin = startMin + targetHours * 60;
            const shortEndHour = Math.floor(shortEndMin / 60) % 24;
            const shortEndMinute = shortEndMin % 60;
            assignedEndTime = `${String(shortEndHour).padStart(2, "0")}:${String(shortEndMinute).padStart(2, "0")}`;
            assignedHours = targetHours;
          }
        }

        assignments.push({
          employeeId: chosen.id,
          shiftDate: date,
          slotName: slot.name,
          startTime: assignedStartTime,
          endTime: assignedEndTime
        });

        assignedOnDate.add(chosen.id);
        hoursMap.set(chosen.id, (hoursMap.get(chosen.id) ?? 0) + assignedHours);
      }
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

        // Check schedule type eligibility (unless roster-selected mode bypasses this)
        if (
          !isEligibleForDate({
            employee: e,
            date,
            weekend,
            scheduleType,
            respectEmployeeScheduleType
          })
        ) {
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
