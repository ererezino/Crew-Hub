import { afterEach, describe, expect, it, vi } from "vitest";

import {
  autoGenerateSchedule,
  type EmployeeScheduleInfo,
  type ShiftSlot
} from "../lib/scheduling/auto-scheduler";

const slots: ShiftSlot[] = [
  {
    name: "Day Shift",
    startTime: "09:00",
    endTime: "17:00"
  }
];

const baseEmployees: EmployeeScheduleInfo[] = [
  {
    id: "weekday-employee",
    fullName: "Weekday Employee",
    scheduleType: "weekday",
    blockedDates: []
  },
  {
    id: "weekend-employee",
    fullName: "Weekend Employee",
    scheduleType: "weekend_primary",
    blockedDates: []
  }
];

describe("autoGenerateSchedule", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps weekday schedules limited to weekday/flexible staff by default", () => {
    const assignments = autoGenerateSchedule({
      employees: baseEmployees,
      slots,
      startDate: "2026-03-02",
      endDate: "2026-03-03",
      scheduleType: "weekday"
    });

    expect(assignments).toHaveLength(2);
    expect(new Set(assignments.map((assignment) => assignment.employeeId))).toEqual(
      new Set(["weekday-employee"])
    );
  });

  it("allows explicit roster mode to assign any selected staff member", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.2);

    const assignments = autoGenerateSchedule({
      employees: baseEmployees,
      slots,
      startDate: "2026-03-02",
      endDate: "2026-03-03",
      scheduleType: "weekday",
      respectEmployeeScheduleType: false
    });

    expect(assignments).toHaveLength(2);
    expect(new Set(assignments.map((assignment) => assignment.employeeId))).toEqual(
      new Set(["weekday-employee", "weekend-employee"])
    );
  });

  it("still respects blocked dates in explicit roster mode", () => {
    const assignments = autoGenerateSchedule({
      employees: [
        {
          ...baseEmployees[0],
          blockedDates: ["2026-03-02", "2026-03-03"]
        },
        baseEmployees[1]
      ],
      slots,
      startDate: "2026-03-02",
      endDate: "2026-03-03",
      scheduleType: "weekday",
      respectEmployeeScheduleType: false
    });

    expect(assignments).toHaveLength(2);
    expect(new Set(assignments.map((assignment) => assignment.employeeId))).toEqual(
      new Set(["weekend-employee"])
    );
  });
});
