import { describe, expect, it } from "vitest";

import {
  WEEKLY_HOURS_SOFT_LIMIT,
  employeeWeekHours,
  isOverWeeklyLimit,
  isoWeekStart,
  roundHours,
  shiftDurationHours,
  weeklyHoursByEmployee
} from "../lib/scheduling/shift-hours";

describe("shiftDurationHours", () => {
  it("computes a same-day range", () => {
    expect(shiftDurationHours("08:00", "16:00")).toBe(8);
  });

  it("rolls overnight ranges into the next day", () => {
    expect(shiftDurationHours("16:00", "00:00")).toBe(8);
    expect(shiftDurationHours("22:00", "06:00")).toBe(8);
  });

  it("treats equal start/end as a full 24h roll (matches combineDateAndTimeRange/slotHours convention)", () => {
    expect(shiftDurationHours("08:00", "08:00")).toBe(24);
  });

  it("accepts ISO timestamps, including overnight ones stored on the next day", () => {
    expect(
      shiftDurationHours("2026-03-10T08:00:00.000Z", "2026-03-10T16:30:00.000Z")
    ).toBe(8.5);
    expect(
      shiftDurationHours("2026-03-10T16:00:00.000Z", "2026-03-11T00:00:00.000Z")
    ).toBe(8);
  });

  it("accepts HH:MM:SS values", () => {
    expect(shiftDurationHours("09:00:00", "17:30:00")).toBe(8.5);
  });

  it("subtracts break minutes", () => {
    expect(shiftDurationHours("08:00", "16:00", 60)).toBe(7);
    expect(shiftDurationHours("16:00", "00:00", 30)).toBe(7.5);
  });

  it("never returns a negative duration", () => {
    expect(shiftDurationHours("08:00", "09:00", 600)).toBe(0);
  });

  it("ignores negative break minutes", () => {
    expect(shiftDurationHours("08:00", "16:00", -30)).toBe(8);
  });

  it("returns 0 for unparseable input", () => {
    expect(shiftDurationHours("not-a-time", "16:00")).toBe(0);
    expect(shiftDurationHours("08:00", "")).toBe(0);
    expect(shiftDurationHours("25:00", "16:00")).toBe(0);
  });
});

describe("isoWeekStart", () => {
  it("returns the same date for a Monday", () => {
    // 2026-03-09 is a Monday
    expect(isoWeekStart("2026-03-09")).toBe("2026-03-09");
  });

  it("returns the prior Monday for mid-week dates", () => {
    // 2026-03-11 is a Wednesday
    expect(isoWeekStart("2026-03-11")).toBe("2026-03-09");
  });

  it("keeps Sundays in the week that started the prior Monday", () => {
    // 2026-03-15 is a Sunday
    expect(isoWeekStart("2026-03-15")).toBe("2026-03-09");
  });

  it("crosses month boundaries", () => {
    // 2026-04-01 is a Wednesday; that week's Monday is 2026-03-30
    expect(isoWeekStart("2026-04-01")).toBe("2026-03-30");
  });

  it("returns invalid input unchanged", () => {
    expect(isoWeekStart("garbage")).toBe("garbage");
  });
});

describe("weeklyHoursByEmployee", () => {
  const baseShift = {
    startTime: "08:00",
    endTime: "16:00",
    breakMinutes: 0
  };

  it("sums hours per employee per ISO week", () => {
    const totals = weeklyHoursByEmployee([
      { ...baseShift, employeeId: "emp-1", shiftDate: "2026-03-09" },
      { ...baseShift, employeeId: "emp-1", shiftDate: "2026-03-10" },
      { ...baseShift, employeeId: "emp-2", shiftDate: "2026-03-09" }
    ]);

    expect(totals.get("emp-1")?.get("2026-03-09")).toBe(16);
    expect(totals.get("emp-2")?.get("2026-03-09")).toBe(8);
  });

  it("splits totals across week boundaries (Sunday vs following Monday)", () => {
    const totals = weeklyHoursByEmployee([
      { ...baseShift, employeeId: "emp-1", shiftDate: "2026-03-15" }, // Sunday
      { ...baseShift, employeeId: "emp-1", shiftDate: "2026-03-16" } // Monday
    ]);

    expect(totals.get("emp-1")?.get("2026-03-09")).toBe(8);
    expect(totals.get("emp-1")?.get("2026-03-16")).toBe(8);
  });

  it("skips open (unassigned) and cancelled shifts", () => {
    const totals = weeklyHoursByEmployee([
      { ...baseShift, employeeId: null, shiftDate: "2026-03-09" },
      {
        ...baseShift,
        employeeId: "emp-1",
        shiftDate: "2026-03-09",
        status: "cancelled"
      },
      {
        ...baseShift,
        employeeId: "emp-1",
        shiftDate: "2026-03-10",
        status: "scheduled"
      }
    ]);

    expect(totals.get("emp-1")?.get("2026-03-09")).toBe(8);
  });

  it("honours break minutes and overnight ISO timestamps", () => {
    const totals = weeklyHoursByEmployee([
      {
        employeeId: "emp-1",
        shiftDate: "2026-03-09",
        startTime: "2026-03-09T16:00:00.000Z",
        endTime: "2026-03-10T00:00:00.000Z",
        breakMinutes: 30
      }
    ]);

    expect(totals.get("emp-1")?.get("2026-03-09")).toBe(7.5);
  });
});

describe("employeeWeekHours", () => {
  it("looks up totals by any date within the week and defaults to 0", () => {
    const totals = weeklyHoursByEmployee([
      {
        employeeId: "emp-1",
        shiftDate: "2026-03-09",
        startTime: "08:00",
        endTime: "16:00"
      }
    ]);

    expect(employeeWeekHours(totals, "emp-1", "2026-03-13")).toBe(8);
    expect(employeeWeekHours(totals, "emp-1", "2026-03-16")).toBe(0);
    expect(employeeWeekHours(totals, "missing", "2026-03-09")).toBe(0);
  });
});

describe("weekly soft limit", () => {
  it("is 48 hours and warns only strictly above it", () => {
    expect(WEEKLY_HOURS_SOFT_LIMIT).toBe(48);
    expect(isOverWeeklyLimit(48)).toBe(false);
    expect(isOverWeeklyLimit(48.5)).toBe(true);
  });
});

describe("roundHours", () => {
  it("rounds to one decimal", () => {
    expect(roundHours(38.3333)).toBe(38.3);
    expect(roundHours(40)).toBe(40);
    expect(roundHours(7.25)).toBe(7.3);
  });
});
