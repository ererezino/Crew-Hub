/**
 * SCHED-05 — schedules longer than 8 weeks must NOT be silently truncated, and
 * the product maximum length is enforced once at input validation.
 */
import { describe, expect, it } from "vitest";

import { buildWeeks, MAX_GRID_WEEKS_RUNAWAY_GUARD } from "../lib/scheduling/week-grid";
import {
  isScheduleWithinMaxLength,
  MAX_SCHEDULE_LENGTH_DAYS,
  scheduleLengthInDays
} from "../lib/scheduling";

/** Last in-range date the builder produced across all its weeks. */
function lastCoveredDate(weeks: ReturnType<typeof buildWeeks>): string {
  const all = weeks.flatMap((w) => w.rangeDates);
  return all[all.length - 1]!;
}

describe("buildWeeks no longer caps at 8 weeks (SCHED-05)", () => {
  it("covers a 1-week schedule", () => {
    const weeks = buildWeeks("2026-07-06", "2026-07-12"); // Mon..Sun
    expect(weeks).toHaveLength(1);
    expect(lastCoveredDate(weeks)).toBe("2026-07-12");
  });

  it("covers exactly 8 weeks", () => {
    const weeks = buildWeeks("2026-07-06", "2026-08-30"); // 8 Mon..Sun weeks
    expect(weeks).toHaveLength(8);
    expect(lastCoveredDate(weeks)).toBe("2026-08-30");
  });

  it("covers 9 weeks (the old cap would have dropped week 9)", () => {
    const weeks = buildWeeks("2026-07-06", "2026-09-06"); // 9 weeks
    expect(weeks).toHaveLength(9);
    expect(lastCoveredDate(weeks)).toBe("2026-09-06");
  });

  it("covers 14 weeks (a ~3-month schedule) end to end", () => {
    const weeks = buildWeeks("2026-07-06", "2026-10-11"); // 14 weeks
    expect(weeks).toHaveLength(14);
    expect(lastCoveredDate(weeks)).toBe("2026-10-11");
  });

  it("handles a partial first and last week without dropping in-range days", () => {
    // Starts mid-week (Wed) and ends mid-week (Tue) — both partial.
    const weeks = buildWeeks("2026-07-08", "2026-07-21");
    expect(weeks[0]!.rangeDates[0]).toBe("2026-07-08");
    expect(lastCoveredDate(weeks)).toBe("2026-07-21");
  });

  it("keeps a runaway guard far above any valid schedule", () => {
    expect(MAX_GRID_WEEKS_RUNAWAY_GUARD).toBeGreaterThanOrEqual(14);
  });
});

describe("schedule length validation (single enforcement point)", () => {
  it("counts inclusive days", () => {
    expect(scheduleLengthInDays("2026-07-06", "2026-07-06")).toBe(1);
    expect(scheduleLengthInDays("2026-07-06", "2026-07-12")).toBe(7);
  });

  it("accepts schedules up to the maximum and rejects longer ones", () => {
    const start = "2026-07-01";
    const okEnd = "2026-08-01"; // 32 days
    expect(isScheduleWithinMaxLength(start, okEnd)).toBe(true);

    // One day past the maximum.
    const tooLongEnd = new Date(Date.UTC(2026, 6, 1) + MAX_SCHEDULE_LENGTH_DAYS * 86_400_000)
      .toISOString()
      .slice(0, 10);
    expect(isScheduleWithinMaxLength(start, tooLongEnd)).toBe(false);
  });

  it("rejects an inverted range", () => {
    expect(isScheduleWithinMaxLength("2026-07-12", "2026-07-06")).toBe(false);
  });
});
