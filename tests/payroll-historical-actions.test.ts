import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Hoisted mocks ────────────────────────────────────────────────────

type QResult = { data: unknown; error: unknown; count?: number | null };
type UpdateCall = { table: string; payload: Record<string, unknown> };

const {
  getAuthenticatedSessionMock,
  logAuditMock,
  fromFn,
  tableQueues,
  updateCalls
} = vi.hoisted(() => {
  const tableQueues: Record<string, QResult[]> = {};
  const updateCalls: UpdateCall[] = [];

  function dequeue(table: string): QResult {
    const q = tableQueues[table];
    if (!q || q.length === 0) return { data: null, error: null };
    return q.shift()!;
  }

  function chain(table: string): Record<string, unknown> {
    const obj: Record<string, unknown> = {};
    const passthrough = [
      "select", "delete",
      "eq", "neq", "in", "is", "gt", "lt",
      "or", "order", "limit", "range", "not"
    ];
    for (const m of passthrough) {
      obj[m] = (..._args: unknown[]) => obj;
    }
    obj.update = (payload: Record<string, unknown>) => {
      updateCalls.push({ table, payload });
      return obj;
    };
    obj.insert = (_payload: unknown) => obj;
    obj.upsert = (_payload: unknown) => obj;
    obj.single = () => Promise.resolve(dequeue(table));
    obj.maybeSingle = () => Promise.resolve(dequeue(table));
    obj.then = (
      resolve?: (v: QResult) => unknown,
      reject?: (e: unknown) => unknown
    ) => {
      const result = dequeue(table);
      return Promise.resolve(result).then(resolve, reject);
    };
    return obj;
  }

  const fromCalls: string[][] = [];
  const fromFn = (table: string) => {
    fromCalls.push([table]);
    return chain(table);
  };
  (fromFn as unknown as Record<string, unknown>).mock = { calls: fromCalls };

  return {
    getAuthenticatedSessionMock: vi.fn(),
    logAuditMock: vi.fn().mockResolvedValue(undefined),
    fromFn,
    tableQueues,
    updateCalls
  };
});

function enqueue(table: string, ...results: QResult[]) {
  if (!tableQueues[table]) tableQueues[table] = [];
  tableQueues[table].push(...results);
}

function updatesFor(table: string) {
  return updateCalls.filter((c) => c.table === table).map((c) => c.payload);
}

vi.mock("../lib/auth/session", () => ({
  getAuthenticatedSession: getAuthenticatedSessionMock
}));

vi.mock("../lib/supabase/server", () => ({
  createSupabaseServerClient: () => Promise.resolve({ from: fromFn })
}));

vi.mock("../lib/audit", () => ({
  logAudit: logAuditMock
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
const RUN = "00000000-0000-4000-a000-000000000002";
const USR_FINANCE = "00000000-0000-4000-a000-000000000003";
const USR_APPROVER = "00000000-0000-4000-a000-000000000004";
const USR_EMPLOYEE = "00000000-0000-4000-a000-000000000005";

const financeSession = {
  profile: { id: USR_FINANCE, org_id: ORG, roles: ["FINANCE_ADMIN"] }
};

const approverSession = {
  profile: { id: USR_APPROVER, org_id: ORG, roles: ["FINANCE_APPROVER"] }
};

const employeeSession = {
  profile: { id: USR_EMPLOYEE, org_id: ORG, roles: ["EMPLOYEE"] }
};

const superAdminSession = {
  profile: { id: USR_APPROVER, org_id: ORG, roles: ["SUPER_ADMIN"] }
};

function historicalRun(overrides: Record<string, unknown> = {}) {
  return {
    id: RUN,
    org_id: ORG,
    pay_period_start: "2025-01-01",
    pay_period_end: "2025-01-31",
    pay_date: "2025-01-31",
    status: "approved",
    initiated_by: USR_FINANCE,
    first_approved_by: null,
    first_approved_at: null,
    final_approved_by: null,
    final_approved_at: null,
    total_gross: { USD: 500000 },
    total_net: { USD: 400000 },
    total_deductions: { USD: 100000 },
    total_employer_contributions: { USD: 0 },
    employee_count: 5,
    snapshot: {},
    notes: null,
    run_month: "2025-01",
    published_at: null,
    published_by: null,
    submitted_at: null,
    submitted_by: null,
    rejected_at: null,
    rejected_by: null,
    rejection_reason: null,
    completed_at: null,
    completed_by: null,
    amendment_of: null,
    locked_at: null,
    is_historical: true,
    reviewed_at: null,
    reviewed_by: null,
    authorized_at: null,
    authorized_by: null,
    provenance_note: null,
    created_at: "2025-01-01T00:00:00.000Z",
    updated_at: "2025-01-01T00:00:00.000Z",
    ...overrides
  };
}

function nonHistoricalRun() {
  return historicalRun({ is_historical: false });
}

function makeRequest(action: string, provenanceNote?: string) {
  const body: Record<string, unknown> = { action };
  if (provenanceNote !== undefined) {
    body.provenanceNote = provenanceNote;
  }
  return new Request("http://localhost/api/v1/payroll/runs/x/historical-actions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

// ── Import route handler ─────────────────────────────────────────────

const { POST } = await import(
  "../app/api/v1/payroll/runs/[id]/historical-actions/route"
);

// ── Setup ────────────────────────────────────────────────────────────

beforeEach(() => {
  for (const k of Object.keys(tableQueues)) delete tableQueues[k];
  updateCalls.length = 0;
  logAuditMock.mockClear();
  getAuthenticatedSessionMock.mockReset();
});

// ── Tests ────────────────────────────────────────────────────────────

describe("POST /api/v1/payroll/runs/[id]/historical-actions", () => {
  // ─── AUTH ────────────────────────────────────────────────────────

  it("returns 401 when unauthenticated", async () => {
    getAuthenticatedSessionMock.mockResolvedValue(null);
    const res = await POST(makeRequest("review"), {
      params: Promise.resolve({ id: RUN })
    });
    expect(res.status).toBe(401);
  });

  // ─── NON-HISTORICAL GUARD ───────────────────────────────────────

  it("returns 409 when run is not historical", async () => {
    getAuthenticatedSessionMock.mockResolvedValue(financeSession);
    enqueue("payroll_runs", { data: nonHistoricalRun(), error: null });

    const res = await POST(makeRequest("review"), {
      params: Promise.resolve({ id: RUN })
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("INVALID_STATE");
  });

  // ─── REVIEW ─────────────────────────────────────────────────────

  it("FINANCE_ADMIN can review; writes reviewed_at and reviewed_by", async () => {
    getAuthenticatedSessionMock.mockResolvedValue(financeSession);
    // Load run
    enqueue("payroll_runs", { data: historicalRun(), error: null });
    // Update result
    enqueue("payroll_runs", {
      data: historicalRun({
        reviewed_at: "2025-01-15T00:00:00.000Z",
        reviewed_by: USR_FINANCE
      }),
      error: null
    });

    const res = await POST(makeRequest("review"), {
      params: Promise.resolve({ id: RUN })
    });
    expect(res.status).toBe(200);

    // Assert the DB update payload
    const runUpdates = updatesFor("payroll_runs");
    expect(runUpdates.length).toBe(1);
    expect(runUpdates[0]).toHaveProperty("reviewed_at");
    expect(runUpdates[0]).toHaveProperty("reviewed_by", USR_FINANCE);

    // Audit logged
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tableName: "payroll_runs",
        recordId: RUN,
        newValue: expect.objectContaining({
          action: "review_historical",
          reviewed_by: USR_FINANCE
        })
      })
    );
  });

  it("EMPLOYEE cannot review (RBAC 403)", async () => {
    getAuthenticatedSessionMock.mockResolvedValue(employeeSession);
    enqueue("payroll_runs", { data: historicalRun(), error: null });

    const res = await POST(makeRequest("review"), {
      params: Promise.resolve({ id: RUN })
    });
    expect(res.status).toBe(403);
  });

  it("returns 409 if already reviewed", async () => {
    getAuthenticatedSessionMock.mockResolvedValue(financeSession);
    enqueue("payroll_runs", {
      data: historicalRun({
        reviewed_at: "2025-01-10T00:00:00.000Z",
        reviewed_by: USR_FINANCE
      }),
      error: null
    });

    const res = await POST(makeRequest("review"), {
      params: Promise.resolve({ id: RUN })
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.message).toContain("Already reviewed");
  });

  // ─── AUTHORIZE ──────────────────────────────────────────────────

  it("FINANCE_APPROVER can authorize after review; writes authorized_at and authorized_by", async () => {
    getAuthenticatedSessionMock.mockResolvedValue(approverSession);
    // Load run — already reviewed by a different user
    enqueue("payroll_runs", {
      data: historicalRun({
        reviewed_at: "2025-01-10T00:00:00.000Z",
        reviewed_by: USR_FINANCE
      }),
      error: null
    });
    // Update result
    enqueue("payroll_runs", {
      data: historicalRun({
        reviewed_at: "2025-01-10T00:00:00.000Z",
        reviewed_by: USR_FINANCE,
        authorized_at: "2025-01-15T00:00:00.000Z",
        authorized_by: USR_APPROVER
      }),
      error: null
    });

    const res = await POST(makeRequest("authorize"), {
      params: Promise.resolve({ id: RUN })
    });
    expect(res.status).toBe(200);

    const runUpdates = updatesFor("payroll_runs");
    expect(runUpdates.length).toBe(1);
    expect(runUpdates[0]).toHaveProperty("authorized_at");
    expect(runUpdates[0]).toHaveProperty("authorized_by", USR_APPROVER);

    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        newValue: expect.objectContaining({
          action: "authorize_historical",
          authorized_by: USR_APPROVER
        })
      })
    );
  });

  it("FINANCE_ADMIN cannot authorize (RBAC 403)", async () => {
    getAuthenticatedSessionMock.mockResolvedValue(financeSession);
    enqueue("payroll_runs", {
      data: historicalRun({
        reviewed_at: "2025-01-10T00:00:00.000Z",
        reviewed_by: USR_FINANCE
      }),
      error: null
    });

    const res = await POST(makeRequest("authorize"), {
      params: Promise.resolve({ id: RUN })
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("authorize fails if not yet reviewed (409)", async () => {
    getAuthenticatedSessionMock.mockResolvedValue(approverSession);
    enqueue("payroll_runs", {
      data: historicalRun({ reviewed_at: null }),
      error: null
    });

    const res = await POST(makeRequest("authorize"), {
      params: Promise.resolve({ id: RUN })
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.message).toContain("reviewed before authorization");
  });

  it("reviewer cannot authorize (separation of duties, 403)", async () => {
    // Same user reviewed and now tries to authorize
    const sameUserSession = {
      profile: { id: USR_FINANCE, org_id: ORG, roles: ["SUPER_ADMIN"] }
    };
    getAuthenticatedSessionMock.mockResolvedValue(sameUserSession);
    enqueue("payroll_runs", {
      data: historicalRun({
        reviewed_at: "2025-01-10T00:00:00.000Z",
        reviewed_by: USR_FINANCE
      }),
      error: null
    });

    const res = await POST(makeRequest("authorize"), {
      params: Promise.resolve({ id: RUN })
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.message).toContain("reviewer cannot authorize");
  });

  it("returns 409 if already authorized", async () => {
    getAuthenticatedSessionMock.mockResolvedValue(approverSession);
    enqueue("payroll_runs", {
      data: historicalRun({
        reviewed_at: "2025-01-10T00:00:00.000Z",
        reviewed_by: USR_FINANCE,
        authorized_at: "2025-01-12T00:00:00.000Z",
        authorized_by: USR_APPROVER
      }),
      error: null
    });

    const res = await POST(makeRequest("authorize"), {
      params: Promise.resolve({ id: RUN })
    });
    expect(res.status).toBe(409);
  });

  // ─── PUBLISH ────────────────────────────────────────────────────

  it("publish sets published_at/by on run and published_at on payslips", async () => {
    getAuthenticatedSessionMock.mockResolvedValue(financeSession);
    // Load run — reviewed and authorized
    enqueue("payroll_runs", {
      data: historicalRun({
        reviewed_at: "2025-01-10T00:00:00.000Z",
        reviewed_by: USR_FINANCE,
        authorized_at: "2025-01-12T00:00:00.000Z",
        authorized_by: USR_APPROVER
      }),
      error: null
    });
    // payroll_items fetch
    enqueue("payroll_items", {
      data: [
        { id: "00000000-0000-4000-a000-000000000010" },
        { id: "00000000-0000-4000-a000-000000000011" }
      ],
      error: null
    });
    // payroll_runs update result
    enqueue("payroll_runs", {
      data: historicalRun({
        reviewed_at: "2025-01-10T00:00:00.000Z",
        reviewed_by: USR_FINANCE,
        authorized_at: "2025-01-12T00:00:00.000Z",
        authorized_by: USR_APPROVER,
        published_at: "2025-01-15T00:00:00.000Z",
        published_by: USR_FINANCE,
        provenance_note: "Historical import from legacy system"
      }),
      error: null
    });
    // payslips update result
    enqueue("payslips", { data: null, error: null });

    const res = await POST(
      makeRequest("publish", "Historical import from legacy system"),
      { params: Promise.resolve({ id: RUN }) }
    );
    expect(res.status).toBe(200);

    // Verify run update payload
    const runUpdates = updatesFor("payroll_runs");
    expect(runUpdates.length).toBe(1);
    expect(runUpdates[0]).toHaveProperty("published_at");
    expect(runUpdates[0]).toHaveProperty("published_by", USR_FINANCE);
    expect(runUpdates[0]).toHaveProperty("provenance_note", "Historical import from legacy system");

    // Verify payslips were updated with published_at and statement_type
    const payslipUpdates = updatesFor("payslips");
    expect(payslipUpdates.length).toBe(1);
    expect(payslipUpdates[0]).toHaveProperty("published_at");
    expect(payslipUpdates[0]).toHaveProperty("statement_type", "historical");

    // Two audit entries: run publication + payslip publication
    expect(logAuditMock).toHaveBeenCalledTimes(2);
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tableName: "payroll_runs",
        newValue: expect.objectContaining({
          action: "publish_historical",
          published_by: USR_FINANCE,
          provenance_note: "Historical import from legacy system"
        })
      })
    );
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tableName: "payslips",
        newValue: expect.objectContaining({
          action: "publish_historical_payslips",
          statement_type: "historical"
        })
      })
    );
  });

  it("publish fails if not authorized (409)", async () => {
    getAuthenticatedSessionMock.mockResolvedValue(financeSession);
    enqueue("payroll_runs", {
      data: historicalRun({
        reviewed_at: "2025-01-10T00:00:00.000Z",
        reviewed_by: USR_FINANCE,
        authorized_at: null
      }),
      error: null
    });

    const res = await POST(makeRequest("publish"), {
      params: Promise.resolve({ id: RUN })
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.message).toContain("authorized before publication");
  });

  it("publish fails if already published (409)", async () => {
    getAuthenticatedSessionMock.mockResolvedValue(financeSession);
    enqueue("payroll_runs", {
      data: historicalRun({
        reviewed_at: "2025-01-10T00:00:00.000Z",
        reviewed_by: USR_FINANCE,
        authorized_at: "2025-01-12T00:00:00.000Z",
        authorized_by: USR_APPROVER,
        published_at: "2025-01-14T00:00:00.000Z",
        published_by: USR_FINANCE
      }),
      error: null
    });

    const res = await POST(makeRequest("publish"), {
      params: Promise.resolve({ id: RUN })
    });
    expect(res.status).toBe(409);
  });

  it("SUPER_ADMIN can authorize (RBAC)", async () => {
    getAuthenticatedSessionMock.mockResolvedValue(superAdminSession);
    enqueue("payroll_runs", {
      data: historicalRun({
        reviewed_at: "2025-01-10T00:00:00.000Z",
        reviewed_by: USR_FINANCE
      }),
      error: null
    });
    enqueue("payroll_runs", {
      data: historicalRun({
        reviewed_at: "2025-01-10T00:00:00.000Z",
        reviewed_by: USR_FINANCE,
        authorized_at: "2025-01-15T00:00:00.000Z",
        authorized_by: USR_APPROVER
      }),
      error: null
    });

    const res = await POST(makeRequest("authorize"), {
      params: Promise.resolve({ id: RUN })
    });
    expect(res.status).toBe(200);
  });
});
