import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..");

function readSource(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

describe("Payroll run creation auto-prefill", () => {
  const createRouteSource = readSource("app/api/v1/payroll/runs/route.ts");
  const calculateRouteSource = readSource("app/api/v1/payroll/runs/[id]/calculate/route.ts");
  const helperSource = readSource("lib/payroll/persist-payroll-run-calculation.ts");

  it("uses the shared calculation helper during run creation", () => {
    expect(createRouteSource).toContain("persistPayrollRunCalculation");
    expect(createRouteSource).toContain("calculationResult = await persistPayrollRunCalculation");
  });

  it("rolls back the created run if prefilling fails", () => {
    expect(createRouteSource).toContain('.from("payroll_runs")');
    expect(createRouteSource).toContain(".delete()");
    expect(createRouteSource).toContain("Unable to create and prefill payroll run");
  });

  it("returns the run as calculated after creation", () => {
    expect(createRouteSource).toContain("status: calculationResult.status");
    expect(createRouteSource).toContain("employee_count: calculationResult.employeeCount");
  });

  it("reuses the same shared helper for manual recalculation", () => {
    expect(calculateRouteSource).toContain("persistPayrollRunCalculation");
    expect(calculateRouteSource).toContain("const responseData = await persistPayrollRunCalculation");
  });

  it("keeps the actual payroll item generation inside one helper", () => {
    expect(helperSource).toContain('.from("profiles")');
    expect(helperSource).toContain('.from("payroll_items")');
    expect(helperSource).toContain("status: \"calculated\"");
  });
});
