import { beforeEach, describe, expect, it, vi } from "vitest";

type QResult = { data: unknown; error: unknown };
type InsertCall = { table: string; payload: Record<string, unknown> };

const { getAuthenticatedSessionMock, fromFn, tableQueues, insertCalls } = vi.hoisted(() => {
  const tableQueues: Record<string, QResult[]> = {};
  const insertCalls: InsertCall[] = [];

  function dequeue(table: string): QResult {
    const queue = tableQueues[table];
    if (!queue || queue.length === 0) {
      return { data: null, error: null };
    }
    return queue.shift()!;
  }

  function chain(table: string): Record<string, unknown> {
    const obj: Record<string, unknown> = {};
    for (const method of ["select", "eq", "in", "is", "order", "limit", "gte", "lte", "not", "or"]) {
      obj[method] = (..._args: unknown[]) => obj;
    }
    obj.maybeSingle = () => Promise.resolve(dequeue(table));
    obj.single = () => Promise.resolve(dequeue(table));
    obj.insert = (payload: Record<string, unknown>) => {
      insertCalls.push({ table, payload });
      return obj;
    };
    obj.update = (_payload: Record<string, unknown>) => obj;
    obj.then = (resolve?: (value: QResult) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(dequeue(table)).then(resolve, reject);
    return obj;
  }

  return {
    getAuthenticatedSessionMock: vi.fn(),
    fromFn: (table: string) => chain(table),
    tableQueues,
    insertCalls
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

vi.mock("../lib/supabase/server", () => ({
  createSupabaseServerClient: () => Promise.resolve({ from: fromFn })
}));

vi.mock("../lib/supabase/service-role", () => ({
  createSupabaseServiceRoleClient: () => ({ from: fromFn })
}));

vi.mock("../lib/audit", () => ({
  logAudit: vi.fn().mockResolvedValue(undefined),
  logAuditBatch: vi.fn().mockResolvedValue(undefined)
}));

vi.mock("../lib/notifications/service", () => ({
  createNotification: vi.fn().mockResolvedValue(undefined),
  createBulkNotifications: vi.fn().mockResolvedValue(undefined)
}));

vi.mock("../lib/notifications/email", () => ({
  sendLeaveRequestedEmail: vi.fn().mockResolvedValue(undefined),
  sendExpenseSubmittedEmail: vi.fn().mockResolvedValue(undefined),
  sendExpenseDisbursedEmail: vi.fn().mockResolvedValue(undefined)
}));

const ORG = "00000000-0000-4000-a000-000000000001";
const USR = "00000000-0000-4000-a000-000000000004";
const CLIENT_REQUEST_ID = "00000000-0000-4000-a000-00000000aaaa";
const EXISTING_REQUEST_ID = "00000000-0000-4000-a000-00000000bbbb";

const session = { profile: { id: USR, org_id: ORG, roles: ["EMPLOYEE"] } };

const employeeProfileRow = {
  id: USR,
  org_id: ORG,
  email: "employee@example.com",
  full_name: "Test Employee",
  department: "Engineering",
  country_code: "NG",
  manager_id: null,
  status: "active"
};

const existingLeaveRequestRow = {
  id: EXISTING_REQUEST_ID,
  employee_id: USR,
  leave_type: "annual_leave",
  start_date: "2026-07-06",
  end_date: "2026-07-08",
  total_days: 3,
  status: "pending",
  reason: "Family trip",
  approver_id: null,
  rejection_reason: null,
  created_at: "2026-06-10T00:00:00Z",
  updated_at: "2026-06-10T00:00:00Z"
};

describe("offline submission idempotency — leave requests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(tableQueues)) delete tableQueues[key];
    insertCalls.length = 0;
  });

  async function importRoute() {
    return await import("../app/api/v1/time-off/requests/route");
  }

  function postRequest(body: Record<string, unknown>) {
    return new Request("http://localhost/api/v1/time-off/requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
  }

  it("returns the existing request instead of creating a duplicate when clientRequestId matches", async () => {
    getAuthenticatedSessionMock.mockResolvedValueOnce(session);
    enqueue("profiles", { data: employeeProfileRow, error: null });
    /* Replay lookup finds the previously created request */
    enqueue("leave_requests", { data: existingLeaveRequestRow, error: null });

    const { POST } = await importRoute();
    const res = await POST(
      postRequest({
        leaveType: "annual_leave",
        startDate: "2026-07-06",
        endDate: "2026-07-08",
        reason: "Family trip",
        clientRequestId: CLIENT_REQUEST_ID
      })
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.error).toBeNull();
    expect(json.data.request.id).toBe(EXISTING_REQUEST_ID);
    /* The whole point: no second insert happened */
    expect(insertCalls.filter((call) => call.table === "leave_requests")).toHaveLength(0);
  });

  it("rejects a malformed clientRequestId", async () => {
    getAuthenticatedSessionMock.mockResolvedValueOnce(session);

    const { POST } = await importRoute();
    const res = await POST(
      postRequest({
        leaveType: "annual_leave",
        startDate: "2026-07-06",
        endDate: "2026-07-08",
        reason: "Family trip",
        clientRequestId: "not-a-uuid"
      })
    );

    expect(res.status).toBe(422);
  });
});
