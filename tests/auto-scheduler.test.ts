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

    expect(assignments).toHaveLength(4);
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

  it("only generates weekend assignments for weekend schedules", () => {
    const assignments = autoGenerateSchedule({
      employees: baseEmployees,
      slots,
      startDate: "2026-03-06", // Friday
      endDate: "2026-03-09", // Monday
      scheduleType: "weekend",
      respectEmployeeScheduleType: false
    });

    expect(assignments).toHaveLength(4);
    expect(new Set(assignments.map((assignment) => assignment.shiftDate))).toEqual(
      new Set(["2026-03-07", "2026-03-08"])
    );
  });

  it("includes weekend workers on Thursday and Friday for weekday schedules", () => {
    const assignments = autoGenerateSchedule({
      employees: baseEmployees,
      slots,
      startDate: "2026-03-04", // Wednesday
      endDate: "2026-03-06", // Friday
      scheduleType: "weekday"
    });

    expect(assignments).toHaveLength(5);

    const weekendEmployeeDates = assignments
      .filter((assignment) => assignment.employeeId === "weekend-employee")
      .map((assignment) => assignment.shiftDate);

    expect(new Set(weekendEmployeeDates)).toEqual(new Set(["2026-03-05", "2026-03-06"]));
  });

  it("keeps weekend-rotation workers eligible for weekday assignments", () => {
    const assignments = autoGenerateSchedule({
      employees: [
        {
          id: "rotation-weekday",
          fullName: "Rotation Weekday",
          scheduleType: "weekend_rotation",
          blockedDates: []
        }
      ],
      slots,
      startDate: "2026-03-02",
      endDate: "2026-03-04",
      scheduleType: "weekday"
    });

    expect(assignments).toHaveLength(3);
    expect(new Set(assignments.map((assignment) => assignment.employeeId))).toEqual(
      new Set(["rotation-weekday"])
    );
  });

  it("falls back to same-day double assignment when needed for coverage", () => {
    const assignments = autoGenerateSchedule({
      employees: [
        {
          id: "solo",
          fullName: "Solo Employee",
          scheduleType: "weekday",
          blockedDates: []
        }
      ],
      slots: [
        {
          name: "Morning",
          startTime: "08:00",
          endTime: "16:00"
        },
        {
          name: "Evening",
          startTime: "16:00",
          endTime: "00:00"
        }
      ],
      startDate: "2026-03-02",
      endDate: "2026-03-02",
      scheduleType: "weekday",
      respectEmployeeScheduleType: false
    });

    expect(assignments).toHaveLength(2);
    expect(new Set(assignments.map((assignment) => assignment.slotName))).toEqual(
      new Set(["Morning", "Evening"])
    );
    expect(new Set(assignments.map((assignment) => assignment.employeeId))).toEqual(
      new Set(["solo"])
    );
  });

  it("assigns all selected weekday roster members each weekday and splits across slots", () => {
    const employees: EmployeeScheduleInfo[] = Array.from({ length: 12 }, (_, index) => ({
      id: `employee-${index + 1}`,
      fullName: `Employee ${index + 1}`,
      scheduleType: "weekday",
      blockedDates: []
    }));

    const coverageSlots: ShiftSlot[] = [
      {
        name: "Morning Shift",
        startTime: "08:00",
        endTime: "16:00"
      },
      {
        name: "Evening Shift",
        startTime: "16:00",
        endTime: "00:00"
      }
    ];

    const assignments = autoGenerateSchedule({
      employees,
      slots: coverageSlots,
      startDate: "2026-04-01",
      endDate: "2026-05-31",
      scheduleType: "weekday",
      respectEmployeeScheduleType: false
    });

    const requiredDates: string[] = [];
    const cursor = new Date("2026-04-01T00:00:00.000Z");
    const last = new Date("2026-05-31T00:00:00.000Z");

    while (cursor <= last) {
      const day = cursor.getUTCDay();
      if (day !== 0 && day !== 6) {
        requiredDates.push(cursor.toISOString().slice(0, 10));
      }
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    expect(assignments).toHaveLength(requiredDates.length * employees.length);

    for (const date of requiredDates) {
      const dateAssignments = assignments.filter((assignment) => assignment.shiftDate === date);

      expect(dateAssignments).toHaveLength(12);
      expect(new Set(dateAssignments.map((assignment) => assignment.slotName))).toEqual(
        new Set(["Morning Shift", "Evening Shift"])
      );

      const morningCount = dateAssignments.filter(
        (assignment) => assignment.slotName === "Morning Shift"
      ).length;
      const eveningCount = dateAssignments.filter(
        (assignment) => assignment.slotName === "Evening Shift"
      ).length;

      expect(morningCount).toBe(6);
      expect(eveningCount).toBe(6);
    }
  });

  it("alternates weekend-rotation workers across weekend anchors", () => {
    const employees: EmployeeScheduleInfo[] = [
      {
        id: "rotation-a",
        fullName: "Rotation A",
        scheduleType: "weekend_rotation",
        blockedDates: []
      },
      {
        id: "rotation-b",
        fullName: "Rotation B",
        scheduleType: "weekend_rotation",
        blockedDates: []
      },
      {
        id: "rotation-c",
        fullName: "Rotation C",
        scheduleType: "weekend_rotation",
        blockedDates: []
      },
      {
        id: "rotation-d",
        fullName: "Rotation D",
        scheduleType: "weekend_rotation",
        blockedDates: []
      }
    ];

    const assignments = autoGenerateSchedule({
      employees,
      slots,
      startDate: "2026-03-07",
      endDate: "2026-03-15",
      scheduleType: "weekend"
    });

    const firstWeekendDates = new Set(["2026-03-07", "2026-03-08"]);
    const secondWeekendDates = new Set(["2026-03-14", "2026-03-15"]);

    const firstWeekendAssignees = new Set(
      assignments
        .filter((assignment) => firstWeekendDates.has(assignment.shiftDate))
        .map((assignment) => assignment.employeeId)
    );
    const secondWeekendAssignees = new Set(
      assignments
        .filter((assignment) => secondWeekendDates.has(assignment.shiftDate))
        .map((assignment) => assignment.employeeId)
    );

    expect(firstWeekendAssignees).toEqual(new Set(["rotation-a", "rotation-c"]));
    expect(secondWeekendAssignees).toEqual(new Set(["rotation-b", "rotation-d"]));
  });
});
