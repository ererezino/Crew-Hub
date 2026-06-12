import { beforeEach, describe, expect, it, vi } from "vitest";

import { logAudit } from "../lib/audit";

type QResult = { data: unknown; error: unknown };
type UpdateCall = {
  table: string;
  payload: Record<string, unknown>;
  filters: Array<{ method: string; args: unknown[] }>;
};

const { getAuthenticatedSessionMock, fromFn, tableQueues, updateCalls } = vi.hoisted(() => {
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
    for (const method of [
      "select",
      "eq",
      "neq",
      "in",
      "is",
      "not",
      "or",
      "order",
      "limit",
      "gte",
      "lte",
      "ilike"
    ]) {
      obj[method] = (..._args: unknown[]) => obj;
    }
    obj.maybeSingle = () => Promise.resolve(dequeue(table));
    obj.single = () => Promise.resolve(dequeue(table));
    obj.insert = (_payload: Record<string, unknown>) => obj;
    obj.update = (payload: Record<string, unknown>) => {
      const call: UpdateCall = { table, payload, filters: [] };
      updateCalls.push(call);

      /* Sub-chain that records the WHERE filters guarding this update so tests
       * can assert optimistic-state guards (.eq("status", ...)) are present. */
      const sub: Record<string, unknown> = {};
      for (const method of ["eq", "neq", "in", "is"]) {
        sub[method] = (...args: unknown[]) => {
          call.filters.push({ method, args });
          return sub;
        };
      }
      sub.select = (..._args: unknown[]) => sub;
      sub.single = () => Promise.resolve(dequeue(table));
      sub.maybeSingle = () => Promise.resolve(dequeue(table));
      sub.then = (
        resolve?: (value: QResult) => unknown,
        reject?: (reason: unknown) => unknown
      ) => Promise.resolve(dequeue(table)).then(resolve, reject);
      return sub;
    };
    obj.then = (resolve?: (value: QResult) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(dequeue(table)).then(resolve, reject);
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

vi.mock("server-only", () => ({}));

vi.mock("../lib/auth/session", () => ({
  getAuthenticatedSession: getAuthenticatedSessionMock
}));

vi.mock("../lib/auth/check-api-access", () => ({
  checkApiAccess: vi.fn(async () => true)
}));

vi.mock("../lib/supabase/server", () => ({
  createSupabaseServerClient: () => Promise.resolve({ from: fromFn })
}));

vi.mock("../lib/supabase/service-role", () => ({
  createSupabaseServiceRoleClient: () => ({ from: fromFn })
}));

vi.mock("../lib/audit", () => ({
  logAudit: vi.fn().mockResolvedValue(undefined),
  logAuditBatch: vi.fn().mockResolvedValue(undefined),
  AUDIT_REDACTED: "[redacted]",
  /* Structural diff matching lib/audit.diffAuditValues semantics (the real
   * implementation is covered by tests/audit-diff.test.ts). */
  diffAuditValues: (oldRecord: Record<string, unknown>, newRecord: Record<string, unknown>) => {
    const oldValue: Record<string, unknown> = {};
    const newValue: Record<string, unknown> = {};
    const changedFields: string[] = [];
    const keys = new Set([...Object.keys(oldRecord), ...Object.keys(newRecord)]);

    for (const key of keys) {
      const before = oldRecord[key] === undefined ? null : oldRecord[key];
      const after = newRecord[key] === undefined ? null : newRecord[key];

      if (JSON.stringify(before) !== JSON.stringify(after)) {
        oldValue[key] = before;
        newValue[key] = after;
        changedFields.push(key);
      }
    }

    return { oldValue, newValue, changedFields };
  }
}));

vi.mock("../lib/notifications/service", () => ({
  createNotification: vi.fn(async () => undefined),
  createBulkNotifications: vi.fn(async () => undefined)
}));

vi.mock("../lib/notifications/email", () => ({
  sendSwapAcceptedEmail: vi.fn(async () => undefined),
  sendSwapRequestedEmail: vi.fn(async () => undefined)
}));

const ORG = "00000000-0000-4000-a000-000000000001";
const MGR = "00000000-0000-4000-a000-000000000002";
const REQ = "00000000-0000-4000-a000-000000000003";
const TGT = "00000000-0000-4000-a000-000000000004";
const SWAP = "00000000-0000-4000-a000-00000000a001";
const SHIFT = "00000000-0000-4000-a000-00000000b001";
const SCHED = "00000000-0000-4000-a000-00000000c001";

const NOW = "2026-06-10T12:00:00+00:00";

const managerSession = {
  profile: { id: MGR, org_id: ORG, roles: ["HR_ADMIN"], department: null, full_name: "Mgr Person" }
};
const targetSession = {
  profile: { id: TGT, org_id: ORG, roles: ["EMPLOYEE"], department: null, full_name: "Target One" }
};

function pendingSwapRow(overrides: Record<string, unknown> = {}) {
  return {
    id: SWAP,
    org_id: ORG,
    shift_id: SHIFT,
    requester_id: REQ,
    target_id: TGT,
    reason: null,
    status: "pending",
    approved_by: null,
    approved_at: null,
    created_at: NOW,
    updated_at: NOW,
    ...overrides
  };
}

function swapShiftRow(overrides: Record<string, unknown> = {}) {
  return {
    id: SHIFT,
    org_id: ORG,
    employee_id: REQ,
    shift_date: "2026-06-20",
    start_time: "2026-06-20T09:00:00+00:00",
    end_time: "2026-06-20T17:00:00+00:00",
    status: "swap_requested",
    ...overrides
  };
}

function fullShiftRow(overrides: Record<string, unknown> = {}) {
  return {
    id: SHIFT,
    org_id: ORG,
    schedule_id: SCHED,
    template_id: null,
    employee_id: REQ,
    shift_date: "2026-06-20",
    start_time: "2026-06-20T09:00:00+00:00",
    end_time: "2026-06-20T17:00:00+00:00",
    break_minutes: 0,
    status: "scheduled",
    notes: null,
    color: null,
    created_at: NOW,
    updated_at: NOW,
    ...overrides
  };
}

function swapPut(body: Record<string, unknown>) {
  return new Request(`http://localhost/api/v1/scheduling/swaps/${SWAP}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

function shiftPut(body: Record<string, unknown>) {
  return new Request(`http://localhost/api/v1/scheduling/shifts/${SHIFT}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

async function importSwapRoute() {
  return await import("../app/api/v1/scheduling/swaps/[id]/route");
}

async function importShiftRoute() {
  return await import("../app/api/v1/scheduling/shifts/[id]/route");
}

describe("Shift swap state machine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(tableQueues)) delete tableQueues[key];
    updateCalls.length = 0;
  });

  it("manager accept applies the shift reassignment atomically with status guards and audits the transition", async () => {
    getAuthenticatedSessionMock.mockResolvedValueOnce(managerSession);

    enqueue("shift_swaps", { data: pendingSwapRow(), error: null });
    enqueue("shifts", { data: swapShiftRow(), error: null });
    /* Transfer path: target profile, leave re-check, overlap re-check */
    enqueue("profiles", { data: { id: TGT, full_name: "Target One" }, error: null });
    enqueue("leave_requests", { data: [], error: null });
    enqueue("shifts", { data: [], error: null });
    /* Guarded shift transfer */
    enqueue("shifts", { data: { id: SHIFT, employee_id: TGT, status: "swapped" }, error: null });
    /* Guarded swap transition */
    enqueue("shift_swaps", {
      data: pendingSwapRow({ status: "accepted", approved_by: MGR, approved_at: NOW }),
      error: null
    });
    /* mapSwap metadata */
    enqueue("shifts", {
      data: {
        id: SHIFT,
        shift_date: "2026-06-20",
        start_time: "2026-06-20T09:00:00+00:00",
        end_time: "2026-06-20T17:00:00+00:00"
      },
      error: null
    });
    enqueue("profiles", {
      data: [
        { id: REQ, full_name: "Requester" },
        { id: TGT, full_name: "Target One" },
        { id: MGR, full_name: "Mgr Person" }
      ],
      error: null
    });

    const { PUT } = await importSwapRoute();
    const res = await PUT(swapPut({ action: "accept" }), {
      params: Promise.resolve({ id: SWAP })
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.swap.status).toBe("accepted");

    const shiftUpdate = updateCalls.find((call) => call.table === "shifts");
    expect(shiftUpdate?.payload).toMatchObject({ employee_id: TGT, status: "swapped" });
    expect(shiftUpdate?.filters).toContainEqual({
      method: "eq",
      args: ["status", "swap_requested"]
    });

    const swapUpdate = updateCalls.find((call) => call.table === "shift_swaps");
    expect(swapUpdate?.payload).toMatchObject({ status: "accepted", target_id: TGT });
    expect(swapUpdate?.filters).toContainEqual({ method: "eq", args: ["status", "pending"] });

    const auditCalls = vi.mocked(logAudit).mock.calls.map((call) => call[0]);
    const swapAudit = auditCalls.find((entry) => entry.tableName === "shift_swaps");
    expect(swapAudit?.action).toBe("approved");
    expect(swapAudit?.oldValue).toMatchObject({
      status: "pending",
      shiftEmployeeId: REQ,
      shiftStatus: "swap_requested"
    });
    expect(swapAudit?.newValue).toMatchObject({
      status: "accepted",
      shiftEmployeeId: TGT,
      shiftStatus: "swapped"
    });

    const shiftAudit = auditCalls.find((entry) => entry.tableName === "shifts");
    expect(shiftAudit?.oldValue).toMatchObject({ employeeId: REQ });
    expect(shiftAudit?.newValue).toMatchObject({ employeeId: TGT, status: "swapped" });
  });

  it("rejects accept on an already-finalized swap with 409", async () => {
    getAuthenticatedSessionMock.mockResolvedValueOnce(targetSession);

    enqueue("shift_swaps", { data: pendingSwapRow({ status: "rejected" }), error: null });

    const { PUT } = await importSwapRoute();
    const res = await PUT(swapPut({ action: "accept" }), {
      params: Promise.resolve({ id: SWAP })
    });
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.error.code).toBe("SHIFT_SWAP_FINALIZED");
    expect(updateCalls).toHaveLength(0);
  });

  it("returns 409 when a concurrent writer resolved the swap between read and guarded write", async () => {
    getAuthenticatedSessionMock.mockResolvedValueOnce(targetSession);

    enqueue("shift_swaps", { data: pendingSwapRow(), error: null });
    enqueue("shifts", { data: swapShiftRow(), error: null });
    /* Guarded swap update matches zero rows → PostgREST PGRST116 */
    enqueue("shift_swaps", { data: null, error: { code: "PGRST116" } });

    const { PUT } = await importSwapRoute();
    const res = await PUT(swapPut({ action: "accept" }), {
      params: Promise.resolve({ id: SWAP })
    });
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.error.code).toBe("SHIFT_SWAP_STATE_CHANGED");
    expect(json.error.message).toContain("modified by someone else");
    /* Target acceptance does not touch the shift, so nothing to roll back */
    expect(updateCalls.filter((call) => call.table === "shifts")).toHaveLength(0);
  });
});

describe("Shift edits under a pending swap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(tableQueues)) delete tableQueues[key];
    updateCalls.length = 0;
  });

  it("blocks shift edits with 409 while the shift has a pending swap request", async () => {
    getAuthenticatedSessionMock.mockResolvedValueOnce(managerSession);

    enqueue("shifts", { data: fullShiftRow({ status: "swap_requested" }), error: null });
    enqueue("schedules", { data: { id: SCHED, department: "ops" }, error: null });

    const { PUT } = await importShiftRoute();
    const res = await PUT(shiftPut({ employeeId: TGT }), {
      params: Promise.resolve({ id: SHIFT })
    });
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.error.code).toBe("SHIFT_HAS_PENDING_SWAP");
    expect(updateCalls).toHaveLength(0);
  });

  it("records acknowledged conflict warnings in the audit entry when a shift edit proceeds past warnings", async () => {
    getAuthenticatedSessionMock.mockResolvedValueOnce(managerSession);

    enqueue("shifts", { data: fullShiftRow(), error: null });
    enqueue("schedules", { data: { id: SCHED, department: "ops" }, error: null });
    /* Conflict detection: the new assignee already works an overlapping shift */
    enqueue("shifts", {
      data: [
        {
          id: "00000000-0000-4000-a000-00000000b002",
          start_time: "2026-06-20T10:00:00+00:00",
          end_time: "2026-06-20T18:00:00+00:00"
        }
      ],
      error: null
    });
    enqueue("leave_requests", { data: [], error: null });
    /* Update result */
    enqueue("shifts", { data: fullShiftRow({ employee_id: TGT }), error: null });
    /* mapShift metadata */
    enqueue("schedules", { data: { id: SCHED, name: "Ops" }, error: null });
    enqueue("profiles", {
      data: { id: TGT, full_name: "Target One", department: "ops", country_code: null },
      error: null
    });

    const { PUT } = await importShiftRoute();
    const res = await PUT(shiftPut({ employeeId: TGT }), {
      params: Promise.resolve({ id: SHIFT })
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.warnings).toEqual([
      "This crew member already has an overlapping shift at this time."
    ]);

    const auditCalls = vi.mocked(logAudit).mock.calls.map((call) => call[0]);
    const shiftAudit = auditCalls.find((entry) => entry.tableName === "shifts");
    expect(shiftAudit?.newValue).toMatchObject({
      employee_id: TGT,
      warningsAcknowledged: ["This crew member already has an overlapping shift at this time."]
    });
  });
});
