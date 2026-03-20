import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Hoisted mocks (available in vi.mock factories) ──────────────────

type QResult = { data: unknown; error: unknown; count?: number | null };
type UpdateCall = { table: string; payload: Record<string, unknown> };
type InsertCall = { table: string; payload: unknown };

const {
  getAuthenticatedSessionMock,
  logAuditMock,
  fromFn,
  tableQueues,
  updateCalls,
  insertCalls
} = vi.hoisted(() => {
  const tableQueues: Record<string, QResult[]> = {};
  const updateCalls: UpdateCall[] = [];
  const insertCalls: InsertCall[] = [];

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
      "or", "order", "limit", "range"
    ];
    for (const m of passthrough) {
      obj[m] = (..._args: unknown[]) => obj;
    }
    // Capture update payloads
    obj.update = (payload: Record<string, unknown>) => {
      updateCalls.push({ table, payload });
      return obj;
    };
    // Capture insert payloads
    obj.insert = (payload: unknown) => {
      insertCalls.push({ table, payload });
      return obj;
    };
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

  // Track from() calls for assertions
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
    updateCalls,
    insertCalls
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

// ── Fixtures ────────────────────────────────────────────────────────

const ORG = "00000000-0000-4000-a000-000000000001";
const RUN = "00000000-0000-4000-a000-000000000002";
const CYC = "00000000-0000-4000-a000-000000000003";
const CYC2 = "00000000-0000-4000-a000-000000000009";
const USR = "00000000-0000-4000-a000-000000000004";
const EA = "00000000-0000-4000-a000-000000000005";
const EB = "00000000-0000-4000-a000-000000000006";
const IA = "00000000-0000-4000-a000-000000000007";
const IB = "00000000-0000-4000-a000-000000000008";

const finSess = { profile: { id: USR, org_id: ORG, roles: ["FINANCE_ADMIN"] } };
const apprSess = { profile: { id: USR, org_id: ORG, roles: ["FINANCE_APPROVER"] } };

function run(status = "approved") {
  return {
    id: RUN, org_id: ORG,
    pay_period_start: "2026-03-01", pay_period_end: "2026-03-31",
    pay_date: "2026-03-31", status, initiated_by: USR,
    first_approved_by: null, first_approved_at: null,
    final_approved_by: null, final_approved_at: null,
    total_gross: {}, total_net: {}, total_deductions: {},
    total_employer_contributions: {},
    employee_count: 2, snapshot: {}, notes: null,
    created_at: "2026-03-19T00:00:00Z", updated_at: "2026-03-19T00:00:00Z"
  };
}

const items = [
  { id: IA, employee_id: EA, pay_currency: "NGN", net_amount: 800000, gross_amount: 1000000, deductions: {} },
  { id: IB, employee_id: EB, pay_currency: "NGN", net_amount: 800000, gross_amount: 1000000, deductions: {} }
];

function pd(emp: string, last4: string, effectiveAt = "2026-03-01T00:00:00Z") {
  return {
    employee_id: emp, payment_method: "bank_transfer", currency: "NGN",
    bank_account_last4: last4, mobile_money_last4: null, crew_tag: null,
    is_primary: true, is_verified: true, change_effective_at: effectiveAt
  };
}

function cyc(id = CYC, status = "draft", totalNet = 1600000) {
  return {
    id, payroll_run_id: RUN, org_id: ORG,
    label: "Cycle 1", currency: "NGN", status,
    target_pay_date: "2026-03-31",
    prepared_at: "2026-03-19T00:00:00Z", prepared_by: USR,
    paid_at: null, paid_by: null, payment_snapshot: {},
    reconciled_at: null, reconciled_by: null, reconciliation_notes: null,
    locked_at: null, total_gross: 2000000, total_net: totalNet,
    total_deductions: 400000, employee_count: 2,
    created_at: "2026-03-19T00:00:00Z", updated_at: "2026-03-19T00:00:00Z"
  };
}

function req(body: Record<string, unknown> = {}) {
  return new Request("http://localhost/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

function par(id = RUN, cycleId?: string) {
  return cycleId
    ? { params: Promise.resolve({ id, cycleId }) }
    : { params: Promise.resolve({ id }) };
}

function setupCreate(opts?: {
  existingCycles?: { id: string }[];
  existingDisbursements?: { payroll_item_id: string; disbursement_amount: number }[];
  paymentDetails?: ReturnType<typeof pd>[];
  flaggedCount?: number;
}) {
  const o = {
    existingCycles: [] as { id: string }[],
    existingDisbursements: [] as { payroll_item_id: string; disbursement_amount: number }[],
    paymentDetails: [pd(EA, "1234"), pd(EB, "5678")],
    flaggedCount: 0,
    ...opts
  };

  enqueue("payroll_runs", { data: run(), error: null });
  enqueue("payroll_items",
    { data: items, error: null },
    { data: null, error: null, count: o.flaggedCount }
  );
  enqueue("payroll_cycles",
    { data: o.existingCycles, error: null },
    { data: cyc(), error: null }
  );
  enqueue("payroll_cycle_items",
    { data: o.existingDisbursements, error: null },
    { data: null, error: null }
  );
  enqueue("employee_payment_details",
    { data: o.paymentDetails, error: null }
  );
}

/** Helper: get all update payloads written to a given table */
function updatesFor(table: string): Record<string, unknown>[] {
  return updateCalls
    .filter((c) => c.table === table)
    .map((c) => c.payload);
}

// ── POST /cycles tests ──────────────────────────────────────────────

describe("POST /cycles — create cycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateCalls.length = 0;
    insertCalls.length = 0;
    for (const key of Object.keys(tableQueues)) {
      delete tableQueues[key];
    }
    (fromFn as unknown as { mock: { calls: string[][] } }).mock.calls.length = 0;
  });

  async function importRoute() {
    return await import("../app/api/v1/payroll/runs/[id]/cycles/route");
  }

  it("creates a full-remaining cycle when no disbursements specified", async () => {
    getAuthenticatedSessionMock.mockResolvedValueOnce(finSess);
    setupCreate();

    const { POST } = await importRoute();
    const res = await POST(req(), par());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toBeTruthy();
    expect(json.data.cycles).toBeDefined();
    expect(json.error).toBeNull();
  });

  it("creates a partial cycle with explicit per-employee disbursements", async () => {
    getAuthenticatedSessionMock.mockResolvedValueOnce(finSess);
    setupCreate();

    const { POST } = await importRoute();
    const res = await POST(
      req({
        label: "Cycle 1 - 60%",
        disbursements: [
          { employeeId: EA, amount: 480000 },
          { employeeId: EB, amount: 480000 }
        ]
      }),
      par()
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toBeTruthy();
    expect(json.error).toBeNull();
  });

  it("rejects disbursements exceeding remaining undisbursed amount", async () => {
    getAuthenticatedSessionMock.mockResolvedValueOnce(finSess);
    setupCreate({
      existingCycles: [{ id: "00000000-0000-4000-a000-0000000000aa" }],
      existingDisbursements: [{ payroll_item_id: IA, disbursement_amount: 500000 }]
    });

    const { POST } = await importRoute();
    const res = await POST(
      req({ disbursements: [{ employeeId: EA, amount: 400000 }] }),
      par()
    );
    const json = await res.json();

    expect(res.status).toBe(422);
    expect(json.error.code).toBe("AMOUNT_EXCEEDS_REMAINING");
    expect(json.error.details).toMatchObject({
      employeeId: EA,
      requested: 400000,
      remaining: 300000
    });
  });

  it("returns 409 with heldEmployeeIds when payment details are held", async () => {
    getAuthenticatedSessionMock.mockResolvedValueOnce(finSess);
    const future = new Date(Date.now() + 86400000).toISOString();
    setupCreate({ paymentDetails: [pd(EA, "1234"), pd(EB, "5678", future)] });

    const { POST } = await importRoute();
    const res = await POST(req(), par());
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.error.code).toBe("PAYMENT_DETAILS_HELD");
    expect(json.error.details).toBeDefined();
    expect(json.error.details.heldEmployeeIds).toContain(EB);
  });

  it("creates cycle with hold overrides preserving disbursements and label", async () => {
    getAuthenticatedSessionMock.mockResolvedValueOnce(apprSess);
    const future = new Date(Date.now() + 86400000).toISOString();
    setupCreate({ paymentDetails: [pd(EA, "1234"), pd(EB, "5678", future)] });

    const { POST } = await importRoute();
    const res = await POST(
      req({
        label: "Cycle with override",
        disbursements: [
          { employeeId: EA, amount: 480000 },
          { employeeId: EB, amount: 480000 }
        ],
        holdOverrides: [{ employeeId: EB, reason: "CFO approved early disbursement" }]
      }),
      par()
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toBeTruthy();
    expect(json.error).toBeNull();

    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "created",
        tableName: "payroll_cycle_hold_overrides",
        recordId: EB,
        newValue: expect.objectContaining({ reason: "CFO approved early disbursement" })
      })
    );
  });

  it("blocks hold override for FINANCE_ADMIN", async () => {
    getAuthenticatedSessionMock.mockResolvedValueOnce(finSess);
    const future = new Date(Date.now() + 86400000).toISOString();
    setupCreate({ paymentDetails: [pd(EA, "1234"), pd(EB, "5678", future)] });

    const { POST } = await importRoute();
    const res = await POST(
      req({
        disbursements: [
          { employeeId: EA, amount: 480000 },
          { employeeId: EB, amount: 480000 }
        ],
        holdOverrides: [{ employeeId: EB, reason: "Override attempt" }]
      }),
      par()
    );
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.error.code).toBe("FORBIDDEN");
  });
});

// ── mark_paid tests ─────────────────────────────────────────────────

describe("POST /cycles/[cycleId]/actions — mark_paid", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateCalls.length = 0;
    insertCalls.length = 0;
    for (const key of Object.keys(tableQueues)) {
      delete tableQueues[key];
    }
    (fromFn as unknown as { mock: { calls: string[][] } }).mock.calls.length = 0;
  });

  async function importRoute() {
    return await import("../app/api/v1/payroll/runs/[id]/cycles/[cycleId]/actions/route");
  }

  it("requires a payment reference before mark_paid", async () => {
    getAuthenticatedSessionMock.mockResolvedValueOnce(finSess);

    const { POST } = await importRoute();
    const res = await POST(
      req({ action: "mark_paid" }),
      par(RUN, CYC) as { params: Promise<{ id: string; cycleId: string }> }
    );
    const json = await res.json();

    expect(res.status).toBe(422);
    expect(json.error.code).toBe("VALIDATION_ERROR");
    expect(json.error.message).toContain("Payment reference");
    expect(updateCalls).toHaveLength(0);
    expect(logAuditMock).not.toHaveBeenCalled();
  });

  it("partial cycle paid → payroll_items updated with payment_status = partially_paid", async () => {
    getAuthenticatedSessionMock.mockResolvedValueOnce(finSess);

    // Queue: load cycle (maybeSingle) → update cycle to paid (single) →
    //   get paid cycle ids for this run → unpaid count check (head) →
    //   completion check: paid cycles again
    enqueue("payroll_cycles",
      { data: cyc(CYC, "ready", 960000), error: null },     // load cycle
      { data: cyc(CYC, "paid", 960000), error: null },       // update → paid
      { data: [{ id: CYC }], error: null },                  // paid cycles for disbursement sum
      { data: null, error: null, count: 0 },                 // unpaid count = 0
      { data: [{ id: CYC }], error: null },                  // paid cycles for completion check
      { data: [{ status: "paid" }, { status: "draft" }], error: null } // aggregate run status sync
    );
    enqueue("payroll_cycle_items",
      { data: null, error: null },                            // update cycle_items → paid
      { data: [{ payroll_item_id: IA }, { payroll_item_id: IB }], error: null },  // 2b: select for publish
      { data: [{ payroll_item_id: IA }, { payroll_item_id: IB }], error: null },  // cycle items list
      { data: [                                               // all paid disbursements (partial)
        { payroll_item_id: IA, disbursement_amount: 480000 },
        { payroll_item_id: IB, disbursement_amount: 480000 }
      ], error: null },
      { data: [                                               // completion check disbursements
        { payroll_item_id: IA, disbursement_amount: 480000 },
        { payroll_item_id: IB, disbursement_amount: 480000 }
      ], error: null }
    );
    enqueue("payslips",
      { data: null, error: null }    // 2b: update payslips.published_at
    );
    // payroll_items dequeue order:
    //  1. select affected items (id, net_amount)
    //  2. update({ payment_status: "partially_paid" }) result
    //  3. select allRunItems for completion check
    enqueue("payroll_items",
      { data: [{ id: IA, net_amount: 800000 }, { id: IB, net_amount: 800000 }], error: null },
      { data: null, error: null },
      { data: [{ id: IA, net_amount: 800000 }, { id: IB, net_amount: 800000 }], error: null }
    );
    enqueue("payroll_runs",
      { data: null, error: null },   // update run → processing
      { data: { status: "processing", completed_at: null, completed_by: null, locked_at: null }, error: null }, // sync select
      { data: null, error: null }    // sync update run status
    );

    const { POST } = await importRoute();
    const res = await POST(
      req({ action: "mark_paid", paymentReference: "BATCH-001" }),
      par(RUN, CYC) as { params: Promise<{ id: string; cycleId: string }> }
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toBeTruthy();
    expect(json.data.cycle).toBeDefined();

    // ── Assert: payroll_items received partially_paid update ──
    const piUpdates = updatesFor("payroll_items");
    const partiallyPaidUpdate = piUpdates.find(
      (u) => u.payment_status === "partially_paid"
    );
    expect(partiallyPaidUpdate).toBeDefined();
    expect(partiallyPaidUpdate).toEqual({ payment_status: "partially_paid" });

    // ── Assert: NO fully-paid update was written to payroll_items ──
    const fullyPaidUpdate = piUpdates.find(
      (u) => u.payment_status === "paid"
    );
    expect(fullyPaidUpdate).toBeUndefined();

    // ── Assert: cycle itself was updated to paid with timestamps ──
    const cycleUpdates = updatesFor("payroll_cycles");
    const cyclePaidUpdate = cycleUpdates.find((u) => u.status === "paid");
    expect(cyclePaidUpdate).toBeDefined();
    expect(cyclePaidUpdate).toEqual(
      expect.objectContaining({
        status: "paid",
        paid_by: USR,
        paid_at: expect.any(String),
        locked_at: expect.any(String)
      })
    );

    // ── Assert: cycle_items disbursement_status set to paid ──
    const ciUpdates = updatesFor("payroll_cycle_items");
    expect(ciUpdates).toContainEqual({ disbursement_status: "paid" });

    // ── Assert: run NOT completed (only partially disbursed) ──
    const runUpdates = updatesFor("payroll_runs");
    const completedUpdate = runUpdates.find((u) => u.status === "completed");
    expect(completedUpdate).toBeUndefined();

    // ── Assert: audit log recorded cycle paid ──
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tableName: "payroll_cycles",
        recordId: CYC,
        newValue: expect.objectContaining({ status: "paid", action: "mark_paid" })
      })
    );
  });

  it("final cycle paid → payroll_items updated with payment_status = paid, run completed", async () => {
    getAuthenticatedSessionMock.mockResolvedValueOnce(finSess);

    // Scenario: CYC was already paid (480k each). CYC2 is being marked paid
    // with the remaining 320k each. Total = 800k = net, so fully paid.
    enqueue("payroll_cycles",
      { data: cyc(CYC2, "ready", 640000), error: null },      // load cycle
      { data: cyc(CYC2, "paid", 640000), error: null },        // update → paid
      { data: [{ id: CYC }, { id: CYC2 }], error: null },      // paid cycles for disbursement sum
      { data: null, error: null, count: 0 },                   // unpaid count = 0 (all paid)
      { data: [{ id: CYC }, { id: CYC2 }], error: null },      // paid cycles for completion check
      { data: [{ status: "paid" }, { status: "paid" }], error: null } // aggregate run status sync
    );
    enqueue("payroll_cycle_items",
      { data: null, error: null },                              // update cycle_items → paid
      { data: [{ payroll_item_id: IA }, { payroll_item_id: IB }], error: null },  // 2b: select for publish
      { data: [{ payroll_item_id: IA }, { payroll_item_id: IB }], error: null },  // cycle items list
      { data: [                                                 // all paid disbursements (full)
        { payroll_item_id: IA, disbursement_amount: 480000 },
        { payroll_item_id: IB, disbursement_amount: 480000 },
        { payroll_item_id: IA, disbursement_amount: 320000 },
        { payroll_item_id: IB, disbursement_amount: 320000 }
      ], error: null },
      { data: [                                                 // completion check disbursements
        { payroll_item_id: IA, disbursement_amount: 480000 },
        { payroll_item_id: IB, disbursement_amount: 480000 },
        { payroll_item_id: IA, disbursement_amount: 320000 },
        { payroll_item_id: IB, disbursement_amount: 320000 }
      ], error: null }
    );
    enqueue("payslips",
      { data: null, error: null }    // 2b: update payslips.published_at
    );
    // payroll_items dequeue order:
    //  1. select affected items (id, net_amount)
    //  2. update({ payment_status: "paid" }) result — all items fully covered
    //  3. select allRunItems for completion check
    enqueue("payroll_items",
      { data: [{ id: IA, net_amount: 800000 }, { id: IB, net_amount: 800000 }], error: null },
      { data: null, error: null },
      { data: [{ id: IA, net_amount: 800000 }, { id: IB, net_amount: 800000 }], error: null }
    );
    enqueue("payroll_runs",
      { data: null, error: null },   // update run → processing
      { data: null, error: null },   // update run → completed
      { data: { status: "completed", completed_at: "2026-03-20T00:00:00Z", completed_by: USR, locked_at: "2026-03-20T00:00:00Z" }, error: null }, // sync select
      { data: null, error: null }    // sync update run status
    );

    const { POST } = await importRoute();
    const res = await POST(
      req({ action: "mark_paid", paymentReference: "BATCH-002" }),
      par(RUN, CYC2) as { params: Promise<{ id: string; cycleId: string }> }
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toBeTruthy();

    // ── Assert: payroll_items received payment_status = "paid" ──
    const piUpdates = updatesFor("payroll_items");
    const fullyPaidUpdate = piUpdates.find(
      (u) => u.payment_status === "paid"
    );
    expect(fullyPaidUpdate).toBeDefined();
    expect(fullyPaidUpdate).toEqual({ payment_status: "paid" });

    // ── Assert: NO partially_paid update (all items fully covered) ──
    const partialUpdate = piUpdates.find(
      (u) => u.payment_status === "partially_paid"
    );
    expect(partialUpdate).toBeUndefined();

    // ── Assert: payroll_runs updated to completed with timestamps ──
    const runUpdates = updatesFor("payroll_runs");
    const completedUpdate = runUpdates.find((u) => u.status === "completed");
    expect(completedUpdate).toBeDefined();
    expect(completedUpdate).toEqual(
      expect.objectContaining({
        status: "completed",
        completed_at: expect.any(String),
        completed_by: USR,
        locked_at: expect.any(String)
      })
    );

    // ── Assert: cycle updated to paid with lock ──
    const cycleUpdates = updatesFor("payroll_cycles");
    const cyclePaidUpdate = cycleUpdates.find((u) => u.status === "paid");
    expect(cyclePaidUpdate).toEqual(
      expect.objectContaining({
        status: "paid",
        paid_at: expect.any(String),
        paid_by: USR,
        locked_at: expect.any(String)
      })
    );

    // ── Assert: audit log recorded BOTH cycle paid AND run completed ──
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tableName: "payroll_cycles",
        recordId: CYC2,
        newValue: expect.objectContaining({ status: "paid", action: "mark_paid" })
      })
    );
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tableName: "payroll_runs",
        recordId: RUN,
        newValue: expect.objectContaining({
          status: "completed",
          action: "all_cycles_paid",
          completedBy: USR
        })
      })
    );
  });

  it("payslip publication failure → 500, cycle AND cycle items rolled back, no paid residue", async () => {
    getAuthenticatedSessionMock.mockResolvedValueOnce(finSess);

    enqueue("payroll_cycles",
      { data: cyc(CYC, "ready", 960000), error: null },     // load cycle
      { data: cyc(CYC, "paid", 960000), error: null },       // update → paid
      { data: null, error: null }                             // rollback cycle header
    );
    enqueue("payroll_cycle_items",
      { data: null, error: null },                            // step 2: update cycle_items → paid
      { data: [{ payroll_item_id: IA }, { payroll_item_id: IB }], error: null },  // 2b: select for publish
      { data: null, error: null }                             // rollback cycle_items → pending
    );
    // Payslip publication fails
    enqueue("payslips",
      { data: null, error: { message: "DB write failed" } }  // 2b: publish fails
    );

    const { POST } = await importRoute();
    const res = await POST(
      req({ action: "mark_paid", paymentReference: "BATCH-ERR" }),
      par(RUN, CYC) as { params: Promise<{ id: string; cycleId: string }> }
    );

    expect(res.status).toBe(500);

    const json = await res.json();
    expect(json.error.code).toBe("PAYSLIP_PUBLICATION_FAILED");

    // ── Assert: cycle header was rolled back to previous status ──
    const cycleUpdates = updatesFor("payroll_cycles");
    const rollbackCycleUpdate = cycleUpdates.find(
      (u) => u.status === "ready" && u.paid_at === null
    );
    expect(rollbackCycleUpdate).toBeDefined();
    expect(rollbackCycleUpdate).toEqual(
      expect.objectContaining({
        status: "ready",
        paid_at: null,
        paid_by: null,
        locked_at: null
      })
    );

    // ── Assert: cycle items were rolled back to pending ──
    // This is critical: without this rollback, My Pay would see
    // disbursement_status = "paid" on cycle items from a failed operation,
    // overstating the employee's confirmed disbursements.
    const ciUpdates = updatesFor("payroll_cycle_items");
    const rollbackCiUpdate = ciUpdates.find(
      (u) => u.disbursement_status === "pending"
    );
    expect(rollbackCiUpdate).toBeDefined();
    expect(rollbackCiUpdate).toEqual({ disbursement_status: "pending" });

    // ── Assert: NO audit log (failed operation) ──
    expect(logAuditMock).not.toHaveBeenCalled();
  });
});
