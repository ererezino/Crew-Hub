import { beforeEach, describe, expect, it, vi } from "vitest";

type QResult = { data: unknown; error: unknown };
type UpdateCall = { table: string; payload: Record<string, unknown> };

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
    for (const method of ["select", "eq", "in", "is", "not", "order", "limit"]) {
      obj[method] = (..._args: unknown[]) => obj;
    }
    obj.maybeSingle = () => Promise.resolve(dequeue(table));
    obj.single = () => Promise.resolve(dequeue(table));
    obj.update = (payload: Record<string, unknown>) => {
      updateCalls.push({ table, payload });
      return obj;
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

vi.mock("../lib/supabase/service-role", () => ({
  createSupabaseServiceRoleClient: () => ({ from: fromFn })
}));

vi.mock("../lib/supabase/server", () => ({
  createSupabaseServerClient: () => Promise.resolve({ from: fromFn })
}));

vi.mock("../lib/audit", () => ({
  logAudit: vi.fn().mockResolvedValue(undefined),
  logAuditBatch: vi.fn().mockResolvedValue(undefined),
  AUDIT_REDACTED: "[redacted]",
  diffAuditValues: (oldRecord: Record<string, unknown>, newRecord: Record<string, unknown>) => ({
    oldValue: oldRecord,
    newValue: newRecord,
    changedFields: Object.keys(newRecord)
  })
}));

vi.mock("../lib/notifications/service", () => ({
  createNotification: vi.fn(async () => undefined),
  createBulkNotifications: vi.fn(async () => undefined)
}));

const ORG = "00000000-0000-4000-a000-000000000001";
const HR = "00000000-0000-4000-a000-000000000002";
const FROM = "00000000-0000-4000-a000-000000000003";
const TO = "00000000-0000-4000-a000-000000000004";
const EMP = "00000000-0000-4000-a000-000000000005";

const hrSession = { profile: { id: HR, org_id: ORG, roles: ["HR_ADMIN"] } };
const employeeSession = { profile: { id: EMP, org_id: ORG, roles: ["EMPLOYEE"] } };

describe("POST /api/v1/approvals/reassign", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(tableQueues)) delete tableQueues[key];
    updateCalls.length = 0;
  });

  async function importRoute() {
    return await import("../app/api/v1/approvals/reassign/route");
  }

  function post(body: Record<string, unknown>) {
    return new Request("http://localhost/api/v1/approvals/reassign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
  }

  it("rejects non-HR/non-super-admin callers", async () => {
    getAuthenticatedSessionMock.mockResolvedValueOnce(employeeSession);

    const { POST } = await importRoute();
    const res = await POST(post({ fromApproverId: FROM, toApproverId: TO }));

    expect(res.status).toBe(403);
  });

  it("rejects reassignment to an inactive approver", async () => {
    getAuthenticatedSessionMock.mockResolvedValueOnce(hrSession);
    enqueue("profiles", {
      data: [
        { id: FROM, full_name: "Old Approver", status: "offboarding" },
        { id: TO, full_name: "New Approver", status: "inactive" }
      ],
      error: null
    });

    const { POST } = await importRoute();
    const res = await POST(post({ fromApproverId: FROM, toApproverId: TO }));
    const json = await res.json();

    expect(res.status).toBe(422);
    expect(json.error.code).toBe("VALIDATION_ERROR");
  });

  it("reassigns pending additional-stage expenses and skips the new approver's own expenses", async () => {
    getAuthenticatedSessionMock.mockResolvedValueOnce(hrSession);
    enqueue("profiles", {
      data: [
        { id: FROM, full_name: "Old Approver", status: "offboarding" },
        { id: TO, full_name: "New Approver", status: "active" }
      ],
      error: null
    });
    /* Target fetch: two reassignable, one submitted BY the new approver */
    enqueue("expenses", {
      data: [
        { id: "00000000-0000-4000-a000-00000000e001", employee_id: EMP },
        { id: "00000000-0000-4000-a000-00000000e002", employee_id: EMP },
        { id: "00000000-0000-4000-a000-00000000e003", employee_id: TO }
      ],
      error: null
    });
    /* Update result */
    enqueue("expenses", {
      data: [
        { id: "00000000-0000-4000-a000-00000000e001" },
        { id: "00000000-0000-4000-a000-00000000e002" }
      ],
      error: null
    });

    const { POST } = await importRoute();
    const res = await POST(post({ fromApproverId: FROM, toApproverId: TO }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.reassignedCount).toBe(2);
    expect(json.data.skippedSelfApproval).toBe(1);

    const update = updateCalls.find((call) => call.table === "expenses");
    expect(update?.payload).toEqual({ additional_approver_id: TO });
  });

  it("rejects reassigning to the same approver", async () => {
    getAuthenticatedSessionMock.mockResolvedValueOnce(hrSession);

    const { POST } = await importRoute();
    const res = await POST(post({ fromApproverId: FROM, toApproverId: FROM }));

    expect(res.status).toBe(422);
  });
});
