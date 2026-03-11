import { describe, expect, it } from "vitest";

import { combineDateAndTimeRange } from "../lib/scheduling";

describe("combineDateAndTimeRange", () => {
  it("returns same-day range when end is after start", () => {
    const result = combineDateAndTimeRange("2026-03-10", "08:00", "16:00");

    expect(result).toEqual({
      startTime: "2026-03-10T08:00:00.000Z",
      endTime: "2026-03-10T16:00:00.000Z"
    });
  });

  it("rolls end time to next day for overnight ranges", () => {
    const result = combineDateAndTimeRange("2026-03-10", "16:00", "00:00");

    expect(result).toEqual({
      startTime: "2026-03-10T16:00:00.000Z",
      endTime: "2026-03-11T00:00:00.000Z"
    });
  });

  it("rejects zero-length ranges", () => {
    const result = combineDateAndTimeRange("2026-03-10", "08:00", "08:00");

    expect(result).toBeNull();
  });
});
