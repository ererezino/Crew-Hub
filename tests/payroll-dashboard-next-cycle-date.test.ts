import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..");

describe("payroll dashboard next pay date", () => {
  it("derives the next pay date from semimonthly cycle dates", () => {
    const source = readFileSync(
      path.join(ROOT, "app/api/v1/payroll/runs/route.ts"),
      "utf8"
    );

    expect(source).toContain("run.cycle1Date && ![\"paid\", \"cancelled\", \"failed\"].includes(run.cycle1Status ?? \"\")");
    expect(source).toContain("run.cycle2Date && ![\"paid\", \"cancelled\", \"failed\"].includes(run.cycle2Status ?? \"\")");
    expect(source).toContain('run.status !== "completed"');
  });
});
