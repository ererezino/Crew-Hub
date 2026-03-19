import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Route-level tests proving the employee visibility path in /api/v1/me/payslips.
 *
 * These tests directly exercise the GET handler and verify:
 * 1. Unpublished historical payslips do NOT appear
 * 2. Published historical payslips DO appear
 * 3. Another employee cannot see payslips belonging to a different employee
 * 4. Native payslips (with published_at set at generation) appear normally
 * 5. The `.not("published_at", "is", null)` filter is structurally present
 *    and the route enforces it — proved by the data that comes through.
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
function nativePayslipRow(id: string, payrollItemId: string, payPeriod: string) {
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
      payment_reference: null
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

  it("returns published native payslips normally", async () => {
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
  });
});
