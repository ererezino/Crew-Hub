import { describe, expect, it } from "vitest";

import {
  calculateBusinessDaysNotice,
  differenceInCalendarDays,
  getBirthdayLeaveOptions,
  spansMultipleCalendarYears
} from "../lib/time-off";

describe("time-off policy helpers", () => {
  it("flags leave that crosses into a new calendar year", () => {
    expect(spansMultipleCalendarYears("2026-12-30", "2027-01-02")).toBe(true);
    expect(spansMultipleCalendarYears("2026-12-30", "2026-12-31")).toBe(false);
  });

  it("calculates business-day notice excluding the request day and leave start day", () => {
    const holidays = new Set<string>(["2026-04-10"]);

    expect(calculateBusinessDaysNotice("2026-04-06", "2026-04-13", holidays)).toBe(3);
    expect(differenceInCalendarDays("2026-04-06", "2026-04-13")).toBe(7);
  });

  it("returns the full following work week for birthdays on non-working days", () => {
    const result = getBirthdayLeaveOptions("1990-03-21", 2026, new Set());

    expect(result.needsChoice).toBe(true);
    expect(result.isBirthdayWorkday).toBe(false);
    expect(result.options).toEqual([
      "2026-03-23",
      "2026-03-24",
      "2026-03-25",
      "2026-03-26",
      "2026-03-27"
    ]);
  });

  it("includes the birthday date plus working-day override options when the birthday is on a workday", () => {
    const result = getBirthdayLeaveOptions("1990-03-24", 2026, new Set(["2026-03-26"]));

    expect(result.needsChoice).toBe(false);
    expect(result.isBirthdayWorkday).toBe(true);
    expect(result.options).toEqual([
      "2026-03-24",
      "2026-03-25",
      "2026-03-27",
      "2026-03-30",
      "2026-03-31"
    ]);
  });
});
