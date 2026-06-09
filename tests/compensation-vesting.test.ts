import { describe, expect, it } from "vitest";

import { calculateGrantExpirationDate, calculateVestingProgress } from "../lib/compensation";

describe("calculateVestingProgress", () => {
  it("matches retroactive vesting schedules from the signed agreements", () => {
    const progress = calculateVestingProgress(
      {
        numberOfShares: 40_788,
        vestingStartDate: "2022-03-07",
        cliffMonths: 12,
        vestingDurationMonths: 48
      },
      new Date("2026-01-15T00:00:00.000Z")
    );

    expect(progress.vestedShares).toBe(39_088);
    expect(progress.unvestedShares).toBe(1_700);
    expect(progress.remainingMonths).toBe(2);
    expect(progress.nextVestingShares).toBe(850);
    expect(progress.nextVestingDate).toBe("2026-02-07");
    expect(progress.fullyVestedDate).toBe("2026-03-07");
    expect(progress.vestedPercent).toBeCloseTo(95.832, 3);
  });

  it("holds shares at zero before the first cliff date", () => {
    const progress = calculateVestingProgress(
      {
        numberOfShares: 6_283,
        vestingStartDate: "2025-09-15",
        cliffMonths: 12,
        vestingDurationMonths: 48
      },
      new Date("2026-01-15T00:00:00.000Z")
    );

    expect(progress.vestedShares).toBe(0);
    expect(progress.unvestedShares).toBe(6_283);
    expect(progress.cliffReached).toBe(false);
    expect(progress.nextVestingDate).toBe("2026-09-15");
    expect(progress.nextVestingShares).toBe(1_570);
  });

  it("uses the cliff plus monthly remainder schedule after vesting begins", () => {
    const progress = calculateVestingProgress(
      {
        numberOfShares: 18_308,
        vestingStartDate: "2024-07-28",
        cliffMonths: 12,
        vestingDurationMonths: 48
      },
      new Date("2026-01-15T00:00:00.000Z")
    );

    expect(progress.vestedShares).toBe(6_484);
    expect(progress.unvestedShares).toBe(11_824);
    expect(progress.nextVestingShares).toBe(381);
    expect(progress.nextVestingDate).toBe("2026-01-28");
  });

  it("marks grants as fully vested when the schedule is complete", () => {
    const progress = calculateVestingProgress(
      {
        numberOfShares: 31_375,
        vestingStartDate: "2021-09-01",
        cliffMonths: 12,
        vestingDurationMonths: 48
      },
      new Date("2026-03-24T00:00:00.000Z")
    );

    expect(progress.isFullyVested).toBe(true);
    expect(progress.vestedShares).toBe(31_375);
    expect(progress.unvestedShares).toBe(0);
    expect(progress.nextVestingDate).toBeNull();
    expect(progress.nextVestingShares).toBe(0);
    expect(progress.fullyVestedDate).toBe("2025-09-01");
  });
});

describe("calculateGrantExpirationDate", () => {
  it("derives the standard 10-year option expiry from the grant date", () => {
    expect(calculateGrantExpirationDate("2026-01-15")).toBe("2036-01-15");
  });
});
