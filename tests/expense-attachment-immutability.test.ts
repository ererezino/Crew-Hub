/**
 * EXPENSE-01 — approved evidence is immutable to the owner, and the last-file /
 * concurrent-delete races are closed.
 *
 * These assert the route's authorization/state contract. The count-cap and
 * last-evidence races are additionally enforced race-free by a DB trigger
 * (20260624160000_expense_attachment_limits.sql); here we verify the route's
 * conditional soft-delete and state guards behaviorally.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { serverClientMock, serviceClientMock, getAuthenticatedSessionMock, logAuditMock } = vi.hoisted(
  () => ({
    serverClientMock: vi.fn(),
    serviceClientMock: vi.fn(),
    getAuthenticatedSessionMock: vi.fn(),
    logAuditMock: vi.fn()
  })
);

vi.mock("../lib/supabase/server", () => ({ createSupabaseServerClient: serverClientMock }));
vi.mock("../lib/supabase/service-role", () => ({ createSupabaseServiceRoleClient: serviceClientMock }));
vi.mock("../lib/auth/session", () => ({ getAuthenticatedSession: getAuthenticatedSessionMock }));
vi.mock("../lib/audit", () => ({ logAudit: logAuditMock.mockResolvedValue(undefined) }));
vi.mock("../lib/expenses/fetch-expense-attachments", () => ({
  loadExpenseAttachments: vi.fn(async () => new Map())
}));

import { DELETE } from "../app/api/v1/expenses/[id]/attachments/[attachmentId]/route";

const ORG = "00000000-0000-4000-8000-000000000001";
const OWNER = "00000000-0000-4000-8000-0000000000a1";
const EXPENSE = "20000000-0000-4000-8000-000000000001";
const ATT_1 = "30000000-0000-4000-8000-000000000001";
const ATT_2 = "30000000-0000-4000-8000-000000000002";

type Result = { data: unknown; error: unknown };

function builder(result: Result | (() => Result)) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b: any = {};
  const resolve = () => (typeof result === "function" ? (result as () => Result)() : result);
  for (const m of ["select", "eq", "is", "order", "update", "in"]) b[m] = () => b;
  b.maybeSingle = () => Promise.resolve(resolve());
  b.then = (res: (v: Result) => unknown, rej?: (e: unknown) => unknown) =>
    Promise.resolve(resolve()).then(res, rej);
  return b;
}

function ctx() {
  return { params: Promise.resolve({ id: EXPENSE, attachmentId: ATT_1 }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  serviceClientMock.mockReturnValue({ from: () => builder({ data: null, error: null }) });
  getAuthenticatedSessionMock.mockResolvedValue({
    profile: { id: OWNER, org_id: ORG, roles: ["EMPLOYEE"], full_name: "Owner" }
  });
});

/** Wire the server client: expense lookup + attachment list + the conditional delete result. */
function wire(expense: Result, liveAttachments: Result, deleteResult: Result) {
  let attCall = 0;
  serverClientMock.mockResolvedValue({
    from: (table: string) => {
      if (table === "expenses") return builder(expense);
      if (table === "expense_attachments") {
        attCall += 1;
        return builder(attCall === 1 ? liveAttachments : deleteResult);
      }
      return builder({ data: [], error: null });
    }
  });
}

describe("EXPENSE-01 owner evidence immutability after approval", () => {
  it("denies an owner deleting evidence once the expense is approved (EVIDENCE_LOCKED)", async () => {
    wire(
      { data: { id: EXPENSE, employee_id: OWNER, status: "approved", receipt_file_path: "p/1" }, error: null },
      { data: [{ id: ATT_1, file_path: "p/1" }, { id: ATT_2, file_path: "p/2" }], error: null },
      { data: [{ id: ATT_1 }], error: null }
    );

    const res = await DELETE(new Request("http://localhost", { method: "DELETE" }), ctx());
    const payload = await res.json();
    expect(res.status).toBe(409);
    expect(payload.error.code).toBe("EVIDENCE_LOCKED");
  });

  it("denies an owner deleting evidence once reimbursed", async () => {
    wire(
      { data: { id: EXPENSE, employee_id: OWNER, status: "reimbursed", receipt_file_path: "p/1" }, error: null },
      { data: [{ id: ATT_1, file_path: "p/1" }, { id: ATT_2, file_path: "p/2" }], error: null },
      { data: [{ id: ATT_1 }], error: null }
    );
    const res = await DELETE(new Request("http://localhost", { method: "DELETE" }), ctx());
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("EVIDENCE_LOCKED");
  });
});

describe("EXPENSE-01 concurrent delete race", () => {
  it("allows deleting a non-primary attachment while the expense is still editable", async () => {
    wire(
      { data: { id: EXPENSE, employee_id: OWNER, status: "pending", receipt_file_path: "p/2" }, error: null },
      { data: [{ id: ATT_1, file_path: "p/1" }, { id: ATT_2, file_path: "p/2" }], error: null },
      { data: [{ id: ATT_1 }], error: null } // conditional delete affected one row
    );
    const res = await DELETE(new Request("http://localhost", { method: "DELETE" }), ctx());
    expect(res.status).toBe(200);
  });

  it("a second concurrent delete of the SAME attachment is rejected (conditional delete affected nothing)", async () => {
    wire(
      { data: { id: EXPENSE, employee_id: OWNER, status: "pending", receipt_file_path: "p/2" }, error: null },
      { data: [{ id: ATT_1, file_path: "p/1" }, { id: ATT_2, file_path: "p/2" }], error: null },
      { data: [], error: null } // already soft-deleted by the first request → no rows
    );
    const res = await DELETE(new Request("http://localhost", { method: "DELETE" }), ctx());
    const payload = await res.json();
    expect(res.status).toBe(409);
    expect(payload.error.code).toBe("INVALID_STATE");
  });

  it("surfaces the DB trigger's last-evidence guard as a 409", async () => {
    wire(
      { data: { id: EXPENSE, employee_id: OWNER, status: "pending", receipt_file_path: "p/1" }, error: null },
      { data: [{ id: ATT_1, file_path: "p/1" }, { id: ATT_2, file_path: "p/2" }], error: null },
      { data: null, error: { code: "23514", message: "cannot remove the last evidence attachment" } }
    );
    const res = await DELETE(new Request("http://localhost", { method: "DELETE" }), ctx());
    const payload = await res.json();
    expect(res.status).toBe(409);
    expect(payload.error.code).toBe("INVALID_STATE");
  });
});
