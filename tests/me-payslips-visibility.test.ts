import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Route-level tests proving the employee visibility path in /api/v1/me/payslips.
 *
 * Trust model:
 * - Native payslips are NOT published at generation time.
 * - Native payslips become visible only when the first payout cycle is marked paid,
 *   which stamps published_at on the payslip.
 * - Historical payslips become visible only after the explicit publish action.
 * - The `.not("published_at", "is", null)` filter ensures unpublished payslips
 *   are never returned to employees.
 * - Disbursement progress only counts paid cycle items — draft/ready/processing
 *   cycle disbursements must not inflate employee-visible amounts.
 */

type QResult = { data: unknown; error: unknown };

const {
  getAuthenticatedSessionMock,
  rpcClientCalls,
  serviceClientCalls,
  rpcClientQueues,
  serviceClientQueues
} = vi.hoisted(() => {
  const rpcClientQueues: Record<string, QResult[]> = {};
  const serviceClientQueues: Record<string, QResult[]> = {};
  const rpcClientCalls: { table: string; method: string; args: unknown[] }[] = [];
  const serviceClientCalls: { table: string; method: string; args: unknown[] }[] = [];

  function makeClient(
    queues: Record<string, QResult[]>,
    calls: { table: string; method: string; args: unknown[] }[]
  ) {
    function dequeue(table: string): QResult {
      const q = queues[table];
      if (!q || q.length === 0) return { data: null, error: null };
      return q.shift()!;
    }

    return {
      from(table: string) {
        const obj: Record<string, unknown> = {};
        const passthrough = [
          "select", "delete", "update", "insert", "upsert",
          "eq", "neq", "in", "is", "gt", "lt", "gte", "lte",
          "or", "order", "limit", "range", "not"
        ];
        for (const m of passthrough) {
          obj[m] = (...args: unknown[]) => {
            calls.push({ table, method: m, args });
            return obj;
          };
        }
        obj.single = () => Promise.resolve(dequeue(table));
        obj.maybeSingle = () => Promise.resolve(dequeue(table));
        obj.then = (
          resolve?: (v: QResult) => unknown,
          reject?: (e: unknown) => unknown
        ) => Promise.resolve(dequeue(table)).then(resolve, reject);
        return obj;
      }
    };
  }

  return {
    getAuthenticatedSessionMock: vi.fn(),
    rpcClientCalls,
    serviceClientCalls,
    rpcClientQueues,
    serviceClientQueues,
    makeClient
  };
});

// Reconstruct makeClient inside the factory using the hoisted queues/calls
function buildClient(
  queues: Record<string, QResult[]>,
  calls: { table: string; method: string; args: unknown[] }[]
) {
  function dequeue(table: string): QResult {
    const q = queues[table];
    if (!q || q.length === 0) return { data: null, error: null };
    return q.shift()!;
  }

  return {
    from(table: string) {
      const obj: Record<string, unknown> = {};
      const passthrough = [
        "select", "delete", "update", "insert", "upsert",
        "eq", "neq", "in", "is", "gt", "lt", "gte", "lte",
        "or", "order", "limit", "range", "not"
      ];
      for (const m of passthrough) {
        obj[m] = (...args: unknown[]) => {
          calls.push({ table, method: m, args });
          return obj;
        };
      }
      obj.single = () => Promise.resolve(dequeue(table));
      obj.maybeSingle = () => Promise.resolve(dequeue(table));
      obj.then = (
        resolve?: (v: QResult) => unknown,
        reject?: (e: unknown) => unknown
      ) => Promise.resolve(dequeue(table)).then(resolve, reject);
      return obj;
    }
  };
}

function enqueueRpc(table: string, ...results: QResult[]) {
  if (!rpcClientQueues[table]) rpcClientQueues[table] = [];
  rpcClientQueues[table].push(...results);
}

function enqueueService(table: string, ...results: QResult[]) {
  if (!serviceClientQueues[table]) serviceClientQueues[table] = [];
  serviceClientQueues[table].push(...results);
}

vi.mock("../lib/auth/session", () => ({
  getAuthenticatedSession: getAuthenticatedSessionMock
}));

vi.mock("../lib/supabase/server", () => ({
  createSupabaseServerClient: () =>
    Promise.resolve(buildClient(rpcClientQueues, rpcClientCalls))
}));

vi.mock("../lib/supabase/service-role", () => ({
  createSupabaseServiceRoleClient: () =>
    buildClient(serviceClientQueues, serviceClientCalls)
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: () => Promise.resolve(body)
    })
  }
}));

// ── Fixtures ─────────────────────────────────────────────────────────

const ORG = "00000000-0000-4000-a000-000000000001";
const EMPLOYEE_A = "00000000-0000-4000-a000-000000000002";
const EMPLOYEE_B = "00000000-0000-4000-a000-000000000003";

function employeeSession(employeeId: string) {
  return {
    profile: { id: employeeId, org_id: ORG, roles: ["EMPLOYEE"] }
  };
}

const PAYSLIP_A = "00000000-0000-4000-a000-000000000010";
const PAYSLIP_B = "00000000-0000-4000-a000-000000000011";
const PITEM_A = "00000000-0000-4000-a000-000000000020";
const PITEM_B = "00000000-0000-4000-a000-000000000021";

/** A published native payslip row (as returned by Supabase join) */
function nativePayslipRow(
  id: string,
  payrollItemId: string,
  payPeriod: string,
  overrides?: {
    payment_status?: string;
    correction_of?: string | null;
  }
) {
  return {
    id,
    payroll_item_id: payrollItemId,
    pay_period: payPeriod,
    file_path: `${ORG}/payslips/${EMPLOYEE_A}/${payPeriod}/${id}.pdf`,
    generated_at: "2025-02-01T00:00:00.000Z",
    emailed_at: null,
    viewed_at: null,
    statement_type: "native",
    payroll_item: {
      gross_amount: 500000,
      net_amount: 400000,
      currency: "USD",
      deductions: [],
      withholding_applied: false,
      payment_reference: null,
      payment_status: overrides?.payment_status ?? "pending",
      correction_of: overrides?.correction_of ?? null
    }
  };
}

/** A published historical payslip row */
function historicalPayslipRow(id: string, payrollItemId: string, payPeriod: string) {
  return {
    ...nativePayslipRow(id, payrollItemId, payPeriod),
    statement_type: "historical"
  };
}

// ── Import route handler ─────────────────────────────────────────────

const { GET } = await import("../app/api/v1/me/payslips/route");

// ── Setup ────────────────────────────────────────────────────────────

beforeEach(() => {
  for (const k of Object.keys(rpcClientQueues)) delete rpcClientQueues[k];
  for (const k of Object.keys(serviceClientQueues)) delete serviceClientQueues[k];
  rpcClientCalls.length = 0;
  serviceClientCalls.length = 0;
  getAuthenticatedSessionMock.mockReset();
});

// ── Tests ────────────────────────────────────────────────────────────

describe("GET /api/v1/me/payslips — employee visibility", () => {
  it("returns 401 when not authenticated", async () => {
    getAuthenticatedSessionMock.mockResolvedValue(null);
    const res = await GET(new Request("http://localhost/api/v1/me/payslips"));
    expect(res.status).toBe(401);
  });

  it("returns native payslips that have been published (cycle paid)", async () => {
    getAuthenticatedSessionMock.mockResolvedValue(employeeSession(EMPLOYEE_A));

    // Year-picker query (RPC client)
    enqueueRpc("payslips", {
      data: [{ pay_period: "2025-01" }],
      error: null
    });

    // Main payslips query (service client) — returns 1 native payslip
    enqueueService("payslips", {
      data: [nativePayslipRow(PAYSLIP_A, PITEM_A, "2025-01")],
      error: null
    });

    const res = await GET(new Request("http://localhost/api/v1/me/payslips?year=2025"));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data.statements).toHaveLength(1);
    expect(body.data.statements[0].statementType).toBe("native");
    expect(body.data.statements[0].payPeriod).toBe("2025-01");
  });

  it("returns published historical payslips after publication", async () => {
    getAuthenticatedSessionMock.mockResolvedValue(employeeSession(EMPLOYEE_A));

    enqueueRpc("payslips", {
      data: [{ pay_period: "2024-06" }],
      error: null
    });

    enqueueService("payslips", {
      data: [historicalPayslipRow(PAYSLIP_A, PITEM_A, "2024-06")],
      error: null
    });

    const res = await GET(new Request("http://localhost/api/v1/me/payslips?year=2024"));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data.statements).toHaveLength(1);
    expect(body.data.statements[0].statementType).toBe("historical");
  });

  it("unpublished historical payslips do NOT appear — filter proven by empty result", async () => {
    getAuthenticatedSessionMock.mockResolvedValue(employeeSession(EMPLOYEE_A));

    // The `.not("published_at", "is", null)` filter means Supabase never
    // returns rows where published_at IS NULL.  Simulate that by returning
    // empty arrays — that is exactly what happens when the DB filter works.
    enqueueRpc("payslips", { data: [], error: null });
    enqueueService("payslips", { data: [], error: null });

    const res = await GET(new Request("http://localhost/api/v1/me/payslips?year=2024"));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data.statements).toHaveLength(0);
    expect(body.data.summary.monthsPaid).toBe(0);
  });

  it("the route structurally calls .not('published_at', 'is', null) on BOTH queries", async () => {
    getAuthenticatedSessionMock.mockResolvedValue(employeeSession(EMPLOYEE_A));
    enqueueRpc("payslips", { data: [], error: null });
    enqueueService("payslips", { data: [], error: null });

    await GET(new Request("http://localhost/api/v1/me/payslips?year=2025"));

    // RPC client (year-picker query) must call .not("published_at", "is", null)
    const rpcNotCalls = rpcClientCalls.filter(
      (c) => c.table === "payslips" && c.method === "not"
    );
    expect(rpcNotCalls.length).toBeGreaterThanOrEqual(1);
    const rpcNotArgs = rpcNotCalls[0].args;
    expect(rpcNotArgs[0]).toBe("published_at");
    expect(rpcNotArgs[1]).toBe("is");
    expect(rpcNotArgs[2]).toBeNull();

    // Service client (main payslips query) must call .not("published_at", "is", null)
    const serviceNotCalls = serviceClientCalls.filter(
      (c) => c.table === "payslips" && c.method === "not"
    );
    expect(serviceNotCalls.length).toBeGreaterThanOrEqual(1);
    const serviceNotArgs = serviceNotCalls[0].args;
    expect(serviceNotArgs[0]).toBe("published_at");
    expect(serviceNotArgs[1]).toBe("is");
    expect(serviceNotArgs[2]).toBeNull();
  });

  it("employee B cannot see employee A's payslips — query scoped by employee_id", async () => {
    getAuthenticatedSessionMock.mockResolvedValue(employeeSession(EMPLOYEE_B));

    // The DB query filters by employee_id = session.profile.id.
    // When Employee B queries, the DB returns nothing for Employee A's payslips.
    enqueueRpc("payslips", { data: [], error: null });
    enqueueService("payslips", { data: [], error: null });

    const res = await GET(new Request("http://localhost/api/v1/me/payslips?year=2025"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.statements).toHaveLength(0);

    // Verify the query used Employee B's ID, not Employee A's
    const eqCalls = rpcClientCalls.filter(
      (c) => c.table === "payslips" && c.method === "eq" && c.args[0] === "employee_id"
    );
    expect(eqCalls.length).toBeGreaterThanOrEqual(1);
    expect(eqCalls[0].args[1]).toBe(EMPLOYEE_B);

    const serviceEqCalls = serviceClientCalls.filter(
      (c) => c.table === "payslips" && c.method === "eq" && c.args[0] === "employee_id"
    );
    expect(serviceEqCalls.length).toBeGreaterThanOrEqual(1);
    expect(serviceEqCalls[0].args[1]).toBe(EMPLOYEE_B);
  });

  it("returns correct summary totals for visible payslips only", async () => {
    getAuthenticatedSessionMock.mockResolvedValue(employeeSession(EMPLOYEE_A));

    enqueueRpc("payslips", {
      data: [{ pay_period: "2025-01" }, { pay_period: "2025-02" }],
      error: null
    });

    enqueueService("payslips", {
      data: [
        nativePayslipRow(PAYSLIP_A, PITEM_A, "2025-01"),
        nativePayslipRow(PAYSLIP_B, PITEM_B, "2025-02")
      ],
      error: null
    });

    const res = await GET(new Request("http://localhost/api/v1/me/payslips?year=2025"));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data.statements).toHaveLength(2);
    expect(body.data.summary.monthsPaid).toBe(2);
    // 400000 per payslip × 2 = 800000
    expect(body.data.summary.netAmount).toBe(800000);
    // 500000 per payslip × 2 = 1000000
    expect(body.data.summary.grossAmount).toBe(1000000);
    // No paid cycle items enqueued → amountDisbursed = 0
    expect(body.data.summary.amountDisbursed).toBe(0);
  });
});

// ── My Pay model tests ────────────────────────────────────────────────

const PAYSLIP_C = "00000000-0000-4000-a000-000000000012";
const PITEM_C = "00000000-0000-4000-a000-000000000022";

describe("GET /api/v1/me/payslips — My Pay month-grouped model", () => {
  it("groups statements into months with correct totals", async () => {
    getAuthenticatedSessionMock.mockResolvedValue(employeeSession(EMPLOYEE_A));

    enqueueRpc("payslips", {
      data: [{ pay_period: "2025-01" }, { pay_period: "2025-02" }],
      error: null
    });

    enqueueService("payslips", {
      data: [
        nativePayslipRow(PAYSLIP_A, PITEM_A, "2025-01", { payment_status: "paid" }),
        nativePayslipRow(PAYSLIP_B, PITEM_B, "2025-02", { payment_status: "pending" })
      ],
      error: null
    });

    const res = await GET(new Request("http://localhost/api/v1/me/payslips?year=2025"));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data.months).toHaveLength(2);

    // First month (2025-01) — ordered descending, but months preserve insertion order
    const jan = body.data.months.find((m: { payPeriod: string }) => m.payPeriod === "2025-01");
    expect(jan).toBeDefined();
    expect(jan.totalNet).toBe(400000);
    expect(jan.totalGross).toBe(500000);
    expect(jan.paymentStatus).toBe("paid");
    expect(jan.statements).toHaveLength(1);

    const feb = body.data.months.find((m: { payPeriod: string }) => m.payPeriod === "2025-02");
    expect(feb).toBeDefined();
    expect(feb.paymentStatus).toBe("pending");
  });

  it("surfaces payment_status from payroll_items on each statement", async () => {
    getAuthenticatedSessionMock.mockResolvedValue(employeeSession(EMPLOYEE_A));

    enqueueRpc("payslips", { data: [{ pay_period: "2025-03" }], error: null });
    enqueueService("payslips", {
      data: [
        nativePayslipRow(PAYSLIP_A, PITEM_A, "2025-03", { payment_status: "partially_paid" })
      ],
      error: null
    });

    const res = await GET(new Request("http://localhost/api/v1/me/payslips?year=2025"));
    const body = await res.json();

    expect(body.data.statements[0].paymentStatus).toBe("partially_paid");
    expect(body.data.months[0].paymentStatus).toBe("partially_paid");
  });

  it("marks amendment statements with isAmendment: true", async () => {
    getAuthenticatedSessionMock.mockResolvedValue(employeeSession(EMPLOYEE_A));

    enqueueRpc("payslips", { data: [{ pay_period: "2025-01" }], error: null });

    // Two payslips in same month — one original, one amendment
    enqueueService("payslips", {
      data: [
        nativePayslipRow(PAYSLIP_A, PITEM_A, "2025-01", { payment_status: "paid" }),
        nativePayslipRow(PAYSLIP_B, PITEM_B, "2025-01", {
          payment_status: "paid",
          correction_of: PITEM_A
        })
      ],
      error: null
    });

    const res = await GET(new Request("http://localhost/api/v1/me/payslips?year=2025"));
    const body = await res.json();

    // Should have 1 month with 2 statements
    expect(body.data.months).toHaveLength(1);
    const month = body.data.months[0];
    expect(month.statements).toHaveLength(2);
    expect(month.hasAmendment).toBe(true);

    // First statement is original, second is amendment
    const original = month.statements.find(
      (s: { payrollItemId: string }) => s.payrollItemId === PITEM_A
    );
    const amendment = month.statements.find(
      (s: { payrollItemId: string }) => s.payrollItemId === PITEM_B
    );
    expect(original.isAmendment).toBe(false);
    expect(amendment.isAmendment).toBe(true);

    // Month totals reflect both
    expect(month.totalNet).toBe(800000); // 400000 × 2
  });

  it("month paymentStatus is worst-case across statements", async () => {
    getAuthenticatedSessionMock.mockResolvedValue(employeeSession(EMPLOYEE_A));

    enqueueRpc("payslips", { data: [{ pay_period: "2025-06" }], error: null });

    // One paid, one pending — month should show pending
    enqueueService("payslips", {
      data: [
        nativePayslipRow(PAYSLIP_A, PITEM_A, "2025-06", { payment_status: "paid" }),
        nativePayslipRow(PAYSLIP_B, PITEM_B, "2025-06", { payment_status: "pending" })
      ],
      error: null
    });

    const res = await GET(new Request("http://localhost/api/v1/me/payslips?year=2025"));
    const body = await res.json();

    expect(body.data.months[0].paymentStatus).toBe("pending");
  });

  it("historical months are flagged with hasHistorical: true", async () => {
    getAuthenticatedSessionMock.mockResolvedValue(employeeSession(EMPLOYEE_A));

    enqueueRpc("payslips", { data: [{ pay_period: "2024-12" }], error: null });
    enqueueService("payslips", {
      data: [historicalPayslipRow(PAYSLIP_A, PITEM_A, "2024-12")],
      error: null
    });

    const res = await GET(new Request("http://localhost/api/v1/me/payslips?year=2024"));
    const body = await res.json();

    expect(body.data.months[0].hasHistorical).toBe(true);
    expect(body.data.months[0].hasAmendment).toBe(false);
  });

  it("flat statements array is preserved for backward compatibility", async () => {
    getAuthenticatedSessionMock.mockResolvedValue(employeeSession(EMPLOYEE_A));

    enqueueRpc("payslips", { data: [{ pay_period: "2025-01" }], error: null });
    enqueueService("payslips", {
      data: [nativePayslipRow(PAYSLIP_A, PITEM_A, "2025-01")],
      error: null
    });

    const res = await GET(new Request("http://localhost/api/v1/me/payslips?year=2025"));
    const body = await res.json();

    // Both months and statements should exist
    expect(body.data.months).toHaveLength(1);
    expect(body.data.statements).toHaveLength(1);
    expect(body.data.statements[0].id).toBe(PAYSLIP_A);
    expect(body.data.statements[0].paymentStatus).toBe("pending");
  });
});

// ── Visibility trust model tests ──────────────────────────────────────

describe("GET /api/v1/me/payslips — visibility trust model", () => {
  it("unpaid native payslips are hidden — published_at is null until first cycle pays", async () => {
    getAuthenticatedSessionMock.mockResolvedValue(employeeSession(EMPLOYEE_A));

    // The DB has the payslip but published_at is null because no cycle has paid yet.
    // The route's .not("published_at", "is", null) filter excludes it.
    // Simulate: DB returns nothing for year-picker and main query.
    enqueueRpc("payslips", { data: [], error: null });
    enqueueService("payslips", { data: [], error: null });

    const res = await GET(new Request("http://localhost/api/v1/me/payslips?year=2025"));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data.statements).toHaveLength(0);
    expect(body.data.months).toHaveLength(0);
    expect(body.data.summary.monthsPaid).toBe(0);
    expect(body.data.summary.netAmount).toBe(0);
  });

  it("first paid cycle makes the month visible — published_at now set", async () => {
    getAuthenticatedSessionMock.mockResolvedValue(employeeSession(EMPLOYEE_A));

    // After the first cycle is marked paid, the cycle-actions route stamps
    // published_at on the payslip. Now the DB returns it.
    enqueueRpc("payslips", { data: [{ pay_period: "2025-03" }], error: null });
    enqueueService("payslips", {
      data: [nativePayslipRow(PAYSLIP_A, PITEM_A, "2025-03", { payment_status: "partially_paid" })],
      error: null
    });

    // Enqueue cycle items query result — only paid disbursements
    enqueueService("payroll_cycle_items", {
      data: [{
        payroll_item_id: PITEM_A,
        disbursement_amount: 200000,
        disbursement_status: "paid"
      }],
      error: null
    });

    const res = await GET(new Request("http://localhost/api/v1/me/payslips?year=2025"));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data.months).toHaveLength(1);
    expect(body.data.months[0].paymentStatus).toBe("partially_paid");
    expect(body.data.months[0].amountDisbursed).toBe(200000);
    expect(body.data.months[0].amountRemaining).toBe(200000); // 400000 - 200000
    expect(body.data.months[0].totalNet).toBe(400000);
  });

  it("only paid-cycle disbursements count — draft/ready/processing are excluded", async () => {
    getAuthenticatedSessionMock.mockResolvedValue(employeeSession(EMPLOYEE_A));

    enqueueRpc("payslips", { data: [{ pay_period: "2025-04" }], error: null });
    enqueueService("payslips", {
      data: [nativePayslipRow(PAYSLIP_A, PITEM_A, "2025-04", { payment_status: "partially_paid" })],
      error: null
    });

    // The route now filters by disbursement_status = "paid".
    // Only paid items come through. Draft/processing are excluded by the DB filter.
    // Simulate: DB returns only the paid cycle item (the route adds .eq("disbursement_status", "paid"))
    enqueueService("payroll_cycle_items", {
      data: [{
        payroll_item_id: PITEM_A,
        disbursement_amount: 150000,
        disbursement_status: "paid"
      }],
      error: null
    });

    const res = await GET(new Request("http://localhost/api/v1/me/payslips?year=2025"));
    const body = await res.json();

    // Only the paid 150000 counts, not the full net
    expect(body.data.statements[0].amountDisbursed).toBe(150000);
    expect(body.data.months[0].amountDisbursed).toBe(150000);
    expect(body.data.months[0].amountRemaining).toBe(250000); // 400000 - 150000
  });

  it("the route structurally filters cycle items by disbursement_status = paid", async () => {
    getAuthenticatedSessionMock.mockResolvedValue(employeeSession(EMPLOYEE_A));

    enqueueRpc("payslips", { data: [{ pay_period: "2025-05" }], error: null });
    enqueueService("payslips", {
      data: [nativePayslipRow(PAYSLIP_A, PITEM_A, "2025-05")],
      error: null
    });

    await GET(new Request("http://localhost/api/v1/me/payslips?year=2025"));

    // Verify the cycle_items query includes .eq("disbursement_status", "paid")
    const cycleItemEqCalls = serviceClientCalls.filter(
      (c) => c.table === "payroll_cycle_items" && c.method === "eq"
    );
    const statusFilter = cycleItemEqCalls.find(
      (c) => c.args[0] === "disbursement_status" && c.args[1] === "paid"
    );
    expect(statusFilter).toBeDefined();
  });

  it("future/unpaid cycles do not inflate employee-visible amounts", async () => {
    getAuthenticatedSessionMock.mockResolvedValue(employeeSession(EMPLOYEE_A));

    enqueueRpc("payslips", { data: [{ pay_period: "2025-06" }], error: null });
    enqueueService("payslips", {
      data: [nativePayslipRow(PAYSLIP_A, PITEM_A, "2025-06", { payment_status: "pending" })],
      error: null
    });

    // No paid cycle items exist — only draft/processing ones which the DB filter excludes.
    // The route's .eq("disbursement_status", "paid") means DB returns empty.
    enqueueService("payroll_cycle_items", {
      data: [],
      error: null
    });

    const res = await GET(new Request("http://localhost/api/v1/me/payslips?year=2025"));
    const body = await res.json();

    expect(body.data.statements[0].amountDisbursed).toBe(0);
    expect(body.data.months[0].amountDisbursed).toBe(0);
    expect(body.data.months[0].amountRemaining).toBe(400000);
  });

  it("YTD summary.amountDisbursed reflects only confirmed paid amounts", async () => {
    getAuthenticatedSessionMock.mockResolvedValue(employeeSession(EMPLOYEE_A));

    enqueueRpc("payslips", {
      data: [{ pay_period: "2025-01" }, { pay_period: "2025-02" }],
      error: null
    });

    // Jan is fully paid, Feb is partially paid
    enqueueService("payslips", {
      data: [
        nativePayslipRow(PAYSLIP_A, PITEM_A, "2025-01", { payment_status: "paid" }),
        nativePayslipRow(PAYSLIP_B, PITEM_B, "2025-02", { payment_status: "partially_paid" })
      ],
      error: null
    });

    // Cycle items: Jan fully disbursed (400k), Feb partially (100k)
    enqueueService("payroll_cycle_items", {
      data: [
        { payroll_item_id: PITEM_A, disbursement_amount: 400000, disbursement_status: "paid" },
        { payroll_item_id: PITEM_B, disbursement_amount: 100000, disbursement_status: "paid" }
      ],
      error: null
    });

    const res = await GET(new Request("http://localhost/api/v1/me/payslips?year=2025"));
    const body = await res.json();

    // YTD netAmount is full entitlement (800k), but amountDisbursed is only confirmed (500k)
    expect(body.data.summary.netAmount).toBe(800000);
    expect(body.data.summary.amountDisbursed).toBe(500000);
    expect(body.data.summary.grossAmount).toBe(1000000);

    // Per-month check
    const jan = body.data.months.find((m: { payPeriod: string }) => m.payPeriod === "2025-01");
    expect(jan.amountDisbursed).toBe(400000);
    expect(jan.amountRemaining).toBe(0);

    const feb = body.data.months.find((m: { payPeriod: string }) => m.payPeriod === "2025-02");
    expect(feb.amountDisbursed).toBe(100000);
    expect(feb.amountRemaining).toBe(300000);
  });
});
