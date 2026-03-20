import { beforeEach, describe, expect, it, vi } from "vitest";

type QResult = { data: unknown; error: unknown };

const {
  getAuthenticatedSessionMock,
  fromFn,
  tableQueues
} = vi.hoisted(() => {
  const tableQueues: Record<string, QResult[]> = {};

  function dequeue(table: string): QResult {
    const queue = tableQueues[table];
    if (!queue || queue.length === 0) {
      return { data: null, error: null };
    }
    return queue.shift()!;
  }

  function chain(table: string): Record<string, unknown> {
    const obj: Record<string, unknown> = {};
    for (const method of ["select", "eq", "in", "is", "maybeSingle"]) {
      if (method === "maybeSingle") {
        obj[method] = () => Promise.resolve(dequeue(table));
      } else {
        obj[method] = (..._args: unknown[]) => obj;
      }
    }
    obj.then = (resolve?: (value: QResult) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(dequeue(table)).then(resolve, reject);
    return obj;
  }

  return {
    getAuthenticatedSessionMock: vi.fn(),
    fromFn: (table: string) => chain(table),
    tableQueues
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

function runRow() {
  return {
    id: RUN,
    org_id: ORG,
    pay_period_start: "2026-03-01",
    pay_period_end: "2026-03-31",
    pay_date: "2026-03-31",
    status: "calculated",
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
});
