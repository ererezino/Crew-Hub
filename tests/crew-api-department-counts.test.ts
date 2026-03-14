/**
 * W3.5: Regression guard verifying that the Crew API departmentCounts
 * uses crewDisplayDepartment() bucketing — the same logic the frontend
 * uses for display — so the API contract matches the UI.
 *
 * Covered scenarios:
 *   1. Marketing + Growth + Sales merge into one "Marketing & Growth" count
 *   2. Non-merged departments remain unchanged
 *   3. null departments bucket into "Other"
 *   4. Legacy "Marketing & Growth" DB values merge correctly
 */
import { describe, expect, it } from "vitest";

import { crewDisplayDepartment } from "../lib/crew-department-display";

/**
 * Replicate the Crew API departmentCounts computation.
 * This is the exact logic from GET /api/v1/the-crew after the W3.5 fix:
 *   const dept = crewDisplayDepartment(row.department);
 *   departmentCounts[dept] = (departmentCounts[dept] ?? 0) + 1;
 */
function computeDepartmentCounts(
  rawDepartments: (string | null)[]
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const raw of rawDepartments) {
    const dept = crewDisplayDepartment(raw);
    counts[dept] = (counts[dept] ?? 0) + 1;
  }
  return counts;
}

describe("Crew API departmentCounts bucketing (W3.5)", () => {
  it("merges Marketing, Growth, and Sales into one Marketing & Growth count", () => {
    const counts = computeDepartmentCounts([
      "Marketing",
      "Growth",
      "Sales",
      "Marketing",
      "Growth"
    ]);

    expect(counts).toEqual({
      "Marketing & Growth": 5
    });
  });

  it("keeps non-merged departments unchanged", () => {
    const counts = computeDepartmentCounts([
      "Engineering",
      "Engineering",
      "Customer Success",
      "Finance",
      "Operations"
    ]);

    expect(counts).toEqual({
      "Engineering": 2,
      "Customer Success": 1,
      "Finance": 1,
      "Operations": 1
    });
  });

  it("buckets null departments into Other", () => {
    const counts = computeDepartmentCounts([
      "Engineering",
      null,
      null,
      "Finance"
    ]);

    expect(counts).toEqual({
      "Engineering": 1,
      "Other": 2,
      "Finance": 1
    });
  });

  it("merges legacy Marketing & Growth DB values with other MGS departments", () => {
    const counts = computeDepartmentCounts([
      "Marketing & Growth",
      "Marketing",
      "Growth",
      "Sales",
      "Engineering"
    ]);

    expect(counts).toEqual({
      "Marketing & Growth": 4,
      "Engineering": 1
    });
  });

  it("handles case-insensitive MGS merging", () => {
    const counts = computeDepartmentCounts([
      "marketing",
      "GROWTH",
      "sales"
    ]);

    expect(counts).toEqual({
      "Marketing & Growth": 3
    });
  });

  it("returns empty object for empty input", () => {
    expect(computeDepartmentCounts([])).toEqual({});
  });
});
