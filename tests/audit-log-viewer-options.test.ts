import { describe, expect, it } from "vitest";

import { mergeFilterOptions } from "../app/(shell)/settings/audit-log-viewer";

describe("mergeFilterOptions", () => {
  it("keeps the currently selected table available after filtering", () => {
    expect(
      mergeFilterOptions(
        ["audit_log", "profiles"],
        "travel_support_requests"
      )
    ).toContain("travel_support_requests");
  });

  it("ignores the sentinel all-option value", () => {
    expect(mergeFilterOptions(["audit_log"], "__all__")).toEqual(["audit_log"]);
  });

  it("deduplicates merged options", () => {
    expect(mergeFilterOptions(["audit_log"], "audit_log", "audit_log")).toEqual(["audit_log"]);
  });
});
