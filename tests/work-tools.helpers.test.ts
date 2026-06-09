import { describe, expect, it } from "vitest";

import {
  canManageWorkTools,
  getWorkToolDisplayLabel,
  getWorkToolRequestTitle,
  isWorkToolOutstanding,
  mapWorkToolRow,
  workToolRowSchema
} from "../lib/work-tools";

describe("work tools helpers", () => {
  it("allows only HR admin and super admin to manage work tools", () => {
    expect(canManageWorkTools(["EMPLOYEE"])).toBe(false);
    expect(canManageWorkTools(["HR_ADMIN"])).toBe(true);
    expect(canManageWorkTools(["SUPER_ADMIN"])).toBe(true);
  });

  it("treats assigned and maintenance tools as outstanding for offboarding", () => {
    expect(isWorkToolOutstanding("assigned")).toBe(true);
    expect(isWorkToolOutstanding("maintenance")).toBe(true);
    expect(isWorkToolOutstanding("available")).toBe(false);
    expect(isWorkToolOutstanding("returned")).toBe(false);
    expect(isWorkToolOutstanding("stolen")).toBe(false);
  });

  it("builds readable display labels", () => {
    expect(
      getWorkToolDisplayLabel({
        itemName: "MacBook Air 2020, M1 Chip, 13-inch",
        serialNumber: "FVFJ1CK7Q6L4"
      })
    ).toBe("MacBook Air 2020, M1 Chip, 13-inch (FVFJ1CK7Q6L4)");

    expect(
      getWorkToolDisplayLabel({
        itemName: "Redmi 14C",
        serialNumber: null
      })
    ).toBe("Redmi 14C");
  });

  it("supports work tools without an assigned date yet", () => {
    const parsed = workToolRowSchema.parse({
      id: "11111111-1111-4111-8111-111111111111",
      org_id: "22222222-2222-4222-8222-222222222222",
      employee_id: "33333333-3333-4333-8333-333333333333",
      item_type: "laptop",
      item_name: "MacBook Air 2020, M1 Chip, 13-inch",
      serial_number: "FVFJ1CK7Q6L4",
      transaction_currency: "NGN",
      cost_amount: "950000",
      status: "assigned",
      assigned_at: null,
      returned_at: null,
      notes: null,
      created_at: "2026-03-24T00:00:00.000Z",
      updated_at: "2026-03-24T00:00:00.000Z",
      employee_name: "Alan Olisa"
    });

    expect(mapWorkToolRow(parsed).assignedAt).toBeNull();
  });

  it("describes employee requests and issue reports clearly", () => {
    expect(
      getWorkToolRequestTitle({
        requestKind: "tool_request",
        requestedItemType: "webcam",
        issueType: null,
        toolLabel: null
      })
    ).toBe("Work tool request: webcam");

    expect(
      getWorkToolRequestTitle({
        requestKind: "issue_report",
        requestedItemType: null,
        issueType: "not_in_possession",
        toolLabel: "MacBook Pro"
      })
    ).toBe("Assignment dispute: MacBook Pro");
  });
});
