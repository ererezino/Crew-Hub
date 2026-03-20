import { describe, expect, it } from "vitest";

import {
  currentMonthPeriod,
  monthPeriod,
  semiMonthlyCycleDates
} from "../lib/payroll/runs";

describe("semimonthly payroll date defaults", () => {
  it("computes the first and third Friday for a month", () => {
    expect(semiMonthlyCycleDates(2026, 3)).toEqual({
      cycle1Date: "2026-03-06",
      cycle2Date: "2026-03-20"
    });
  });

  it("uses the second cycle date as the legacy run payDate for arbitrary months", () => {
    expect(monthPeriod(2026, 3)).toEqual({
      payPeriodStart: "2026-03-01",
      payPeriodEnd: "2026-03-31",
      payDate: "2026-03-20"
    });
  });

  it("uses the second cycle date as the default payDate for the current month helper", () => {
    expect(currentMonthPeriod(new Date(Date.UTC(2026, 2, 12)))).toEqual({
      payPeriodStart: "2026-03-01",
      payPeriodEnd: "2026-03-31",
      payDate: "2026-03-20"
    });
  });
});
