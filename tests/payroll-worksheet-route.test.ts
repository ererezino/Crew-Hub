import { beforeEach, describe, expect, it, vi } from "vitest";

type QResult = { data: unknown; error: unknown };
type UpdateCall = { table: string; payload: Record<string, unknown> };

const {
  getAuthenticatedSessionMock,
  fromFn,
  tableQueues,
  updateCalls
} = vi.hoisted(() => {
  const tableQueues: Record<string, QResult[]> = {};
  const updateCalls: UpdateCall[] = [];

  function dequeue(table: string): QResult {
    const queue = tableQueues[table];
    if (!queue || queue.length === 0) {
      return { data: null, error: null };
    }
    return queue.shift()!;
  }

  function chain(table: string): Record<string, unknown> {
    const obj: Record<string, unknown> = {};
    let isUpdate = false;
    for (const method of ["select", "eq", "in", "is", "maybeSingle"]) {
      if (method === "maybeSingle") {
        obj[method] = () => Promise.resolve(dequeue(table));
      } else {
        obj[method] = (..._args: unknown[]) => obj;
      }
    }
    obj.update = (payload: Record<string, unknown>) => {
      isUpdate = true;
      updateCalls.push({ table, payload });
      return obj;
    };
    obj.then = (resolve?: (value: QResult) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(isUpdate ? { data: null, error: null } : dequeue(table)).then(resolve, reject);
    return obj;
  }

  return {
    getAuthenticatedSessionMock: vi.fn(),
    fromFn: (table: string) => chain(table),
    tableQueues,
    updateCalls
  };
});

function enqueue(table: string, ...results: QResult[]) {
  if (!tableQueues[table]) tableQueues[table] = [];
  tableQueues[table].push(...results);
}

vi.mock("../lib/auth/session", () => ({
  getAuthenticatedSession: getAuthenticatedSessionMock
}));

vi.mock("../lib/supabase/server", () => ({
  createSupabaseServerClient: () => Promise.resolve({ from: fromFn })
}));

vi.mock("../lib/supabase/service-role", () => ({
  createSupabaseServiceRoleClient: () => ({ from: fromFn })
}));

vi.mock("../lib/audit", () => ({
  logAudit: vi.fn().mockResolvedValue(undefined)
}));

const ORG = "00000000-0000-4000-a000-000000000001";
const RUN = "00000000-0000-4000-a000-000000000002";
const ITEM = "00000000-0000-4000-a000-000000000003";
const USR = "00000000-0000-4000-a000-000000000004";

const session = { profile: { id: USR, org_id: ORG, roles: ["FINANCE_ADMIN"] } };

function runRow(status = "calculated") {
  return {
    id: RUN,
    org_id: ORG,
    pay_period_start: "2026-03-01",
    pay_period_end: "2026-03-31",
    pay_date: "2026-03-31",
    status,
    initiated_by: USR,
    first_approved_by: null,
    first_approved_at: null,
    final_approved_by: null,
    final_approved_at: null,
    total_gross: {},
    total_net: {},
    total_deductions: {},
    total_employer_contributions: {},
    employee_count: 1,
    snapshot: {},
    notes: null,
    created_at: "2026-03-01T00:00:00Z",
    updated_at: "2026-03-01T00:00:00Z"
  };
}

describe("PATCH /items/[itemId]/worksheet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(tableQueues)) delete tableQueues[key];
    updateCalls.length = 0;
  });

  async function importRoute() {
    return await import("../app/api/v1/payroll/runs/[id]/items/[itemId]/worksheet/route");
  }

  it("locks shared payout fields once any cycle has been submitted", async () => {
    getAuthenticatedSessionMock.mockResolvedValueOnce(session);
    enqueue("payroll_runs", { data: runRow(), error: null });
    enqueue("payroll_cycles", {
      data: [{ cycle_number: 1, status: "submitted" }],
      error: null
    });

    const { PATCH } = await importRoute();
    const res = await PATCH(
      new Request("http://localhost/test", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bonus: 5000 })
      }),
      { params: Promise.resolve({ id: RUN, itemId: ITEM }) }
    );
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.error.code).toBe("CYCLE_FROZEN");
    expect(json.error.message).toContain("shared payout fields");
  });

  it("still allows cycle 2 edits after cycle 1 has moved the month into submitted status", async () => {
    getAuthenticatedSessionMock.mockResolvedValueOnce(session);
    enqueue("payroll_runs", { data: runRow("submitted"), error: null });
    enqueue("payroll_cycles", { data: [], error: null });
    enqueue("payroll_items", {
      data: {
        id: ITEM,
        payroll_run_id: RUN,
        employee_id: "00000000-0000-4000-a000-000000000005",
        org_id: ORG,
        base_salary_amount: 300000,
        overtime_amount: 0,
        overtime_hours: 0,
        cycle_1_base_amount: 150000,
        cycle_2_base_amount: 150000,
        cycle_1_overtime_hours: 0,
        cycle_2_overtime_hours: 0,
        cycle_1_overtime_amount: 0,
        cycle_2_overtime_amount: 0,
        cycle_1_included: true,
        cycle_2_included: true,
        fees: 0,
        bonus: 0,
        comment: null,
        exception_reason: null
      },
      error: null
    });
    enqueue("payroll_items", {
      data: {
        cycle_2_base_amount: 160000,
        cycle_1_base_amount: 150000,
        cycle_1_overtime_hours: 0,
        cycle_2_overtime_hours: 0,
        cycle_1_overtime_amount: 0,
        cycle_2_overtime_amount: 0,
        cycle_1_included: true,
        cycle_2_included: true,
        fees: 0,
        bonus: 0,
        comment: null,
        exception_reason: "Second cycle adjustment",
        net_amount: 310000,
        gross_amount: 310000
      },
      error: null
    });
    enqueue("payroll_items", {
      data: [{ gross_amount: 310000, net_amount: 310000, pay_currency: "USD" }],
      error: null
    });

    const { PATCH } = await importRoute();
    const res = await PATCH(
      new Request("http://localhost/test", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cycle2BaseAmount: 160000,
          exceptionReason: "Second cycle adjustment"
        })
      }),
      { params: Promise.resolve({ id: RUN, itemId: ITEM }) }
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.error).toBeNull();
    expect(json.data.item.cycle2BaseAmount).toBe(160000);
  });

  it("uses salary divided by 160 for overtime and includes fees in payable totals", async () => {
    getAuthenticatedSessionMock.mockResolvedValueOnce(session);
    enqueue("payroll_runs", { data: runRow("calculated"), error: null });
    enqueue("payroll_cycles", { data: [], error: null });
    enqueue("payroll_items", {
      data: {
        id: ITEM,
        payroll_run_id: RUN,
        employee_id: "00000000-0000-4000-a000-000000000005",
        org_id: ORG,
        base_salary_amount: 50000,
        overtime_amount: 0,
        overtime_hours: 0,
        cycle_1_base_amount: 25000,
        cycle_2_base_amount: 25000,
        cycle_1_overtime_hours: 0,
        cycle_2_overtime_hours: 0,
        cycle_1_overtime_amount: 0,
        cycle_2_overtime_amount: 0,
        cycle_1_included: true,
        cycle_2_included: true,
        fees: 1000,
        bonus: 0,
        comment: null,
        exception_reason: null
      },
      error: null
    });
    enqueue("payroll_items", {
      data: {
        cycle_2_base_amount: 25000,
        cycle_1_base_amount: 25000,
        cycle_1_overtime_hours: 16,
        cycle_2_overtime_hours: 0,
        cycle_1_overtime_amount: 5000,
        cycle_2_overtime_amount: 0,
        cycle_1_included: true,
        cycle_2_included: true,
        fees: 1000,
        bonus: 0,
        comment: null,
        exception_reason: null,
        net_amount: 56000,
        gross_amount: 56000
      },
      error: null
    });
    enqueue("payroll_items", {
      data: [
        { gross_amount: 56000, net_amount: 56000, pay_currency: "USD" },
        { gross_amount: 100000, net_amount: 90000, pay_currency: "NGN" }
      ],
      error: null
    });

    const { PATCH } = await importRoute();
    const res = await PATCH(
      new Request("http://localhost/test", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cycle1OvertimeHours: 16,
          fees: 1000
        })
      }),
      { params: Promise.resolve({ id: RUN, itemId: ITEM }) }
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.error).toBeNull();
    expect(json.data.item.cycle1OvertimeAmount).toBe(5000);
    expect(json.data.item.monthlyTotal).toBe(56000);
    expect(json.data.item.netAmount).toBe(56000);

    const payrollItemUpdate = updateCalls.find((call) => call.table === "payroll_items");
    expect(payrollItemUpdate?.payload.cycle_1_overtime_amount).toBe(5000);
    expect(payrollItemUpdate?.payload.net_amount).toBe(56000);
    expect(payrollItemUpdate?.payload.gross_amount).toBe(56000);

    const payrollRunUpdate = updateCalls.find((call) => call.table === "payroll_runs");
    expect(payrollRunUpdate?.payload.total_gross).toEqual({ USD: 56000, NGN: 100000 });
    expect(payrollRunUpdate?.payload.total_net).toEqual({ USD: 56000, NGN: 90000 });
    expect(payrollRunUpdate?.payload.total_deductions).toEqual({ USD: 0, NGN: 10000 });
  });

  it("preserves stored deductions and adjustments in net when recalculating worksheet totals", async () => {
    getAuthenticatedSessionMock.mockResolvedValueOnce(session);
    enqueue("payroll_runs", { data: runRow("calculated"), error: null });
    enqueue("payroll_cycles", { data: [], error: null });
    enqueue("payroll_items", {
      data: {
        id: ITEM,
        payroll_run_id: RUN,
        employee_id: "00000000-0000-4000-a000-000000000005",
        org_id: ORG,
        base_salary_amount: 300000,
        overtime_amount: 0,
        overtime_hours: 0,
        cycle_1_base_amount: 150000,
        cycle_2_base_amount: 150000,
        cycle_1_overtime_hours: 0,
        cycle_2_overtime_hours: 0,
        cycle_1_overtime_amount: 0,
        cycle_2_overtime_amount: 0,
        cycle_1_included: true,
        cycle_2_included: true,
        fees: 0,
        bonus: 0,
        comment: null,
        exception_reason: null,
        deductions: [
          { ruleType: "paye", ruleName: "PAYE", amount: 40000 },
          { ruleType: "pension", ruleName: "Pension", amount: 5000 }
        ],
        adjustments: [{ label: "Backpay", amount: 2000 }]
      },
      error: null
    });
    enqueue("payroll_items", {
      data: {
        cycle_2_base_amount: 150000,
        cycle_1_base_amount: 150000,
        cycle_1_overtime_hours: 0,
        cycle_2_overtime_hours: 0,
        cycle_1_overtime_amount: 0,
        cycle_2_overtime_amount: 0,
        cycle_1_included: true,
        cycle_2_included: true,
        fees: 0,
        bonus: 10000,
        comment: null,
        exception_reason: null,
        net_amount: 267000,
        gross_amount: 310000
      },
      error: null
    });
    enqueue("payroll_items", {
      data: [{ gross_amount: 310000, net_amount: 267000, pay_currency: "NGN" }],
      error: null
    });

    const { PATCH } = await importRoute();
    const res = await PATCH(
      new Request("http://localhost/test", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bonus: 10000 })
      }),
      { params: Promise.resolve({ id: RUN, itemId: ITEM }) }
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.error).toBeNull();

    const payrollItemUpdate = updateCalls.find((call) => call.table === "payroll_items");
    /* monthlyTotal = 150000 + 150000 + 10000 = 310000 (gross) */
    expect(payrollItemUpdate?.payload.gross_amount).toBe(310000);
    /* net = 310000 - (40000 + 5000) deductions + 2000 adjustments = 267000 */
    expect(payrollItemUpdate?.payload.net_amount).toBe(267000);
  });
});
