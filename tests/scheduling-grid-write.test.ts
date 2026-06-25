/**
 * SCHED-03 behavioral tests for the grid cell write route.
 *
 * Covers tenant/eligibility validation BEFORE any service-role write, weekday
 * de-duplication, and the atomic RPC's stale-cell conflict surfacing as 409.
 * (The RPC's transactional clear+insert+swap-cleanup is exercised against the
 * real database; here we assert the route's contract around it.)
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { serviceClientMock, getAuthenticatedSessionMock, checkApiAccessMock, logAuditMock } = vi.hoisted(
  () => ({
    serviceClientMock: vi.fn(),
    getAuthenticatedSessionMock: vi.fn(),
    checkApiAccessMock: vi.fn(),
    logAuditMock: vi.fn()
  })
);

vi.mock("../lib/supabase/service-role", () => ({ createSupabaseServiceRoleClient: serviceClientMock }));
vi.mock("../lib/auth/session", () => ({ getAuthenticatedSession: getAuthenticatedSessionMock }));
vi.mock("../lib/auth/check-api-access", () => ({ checkApiAccess: checkApiAccessMock }));
vi.mock("../lib/audit", () => ({ logAudit: logAuditMock.mockResolvedValue(undefined) }));

import { POST } from "../app/api/v1/scheduling/schedules/[id]/grid/route";

const ORG = "00000000-0000-4000-8000-000000000001";
const SCHEDULE = "20000000-0000-4000-8000-000000000001";
const EMP = "00000000-0000-4000-8000-00000000000b";

type Result = { data: unknown; error: unknown };

function builder(resolve: () => Result) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b: any = {};
  for (const m of ["select", "eq", "is", "in", "neq", "order", "limit", "gte", "lte"]) {
    b[m] = () => b;
  }
  b.maybeSingle = () => Promise.resolve(resolve());
  b.then = (res: (v: Result) => unknown, rej?: (e: unknown) => unknown) =>
    Promise.resolve(resolve()).then(res, rej);
  return b;
}

/**
 * Build a service-role client whose tables resolve to the given results and
 * whose .rpc() returns `rpcResult`. Records the rpc args for assertions.
 */
function wireService(opts: {
  schedule?: Result;
  employee?: Result;
  rpcResult?: { data: unknown; error: unknown };
  rpcCalls?: unknown[];
}) {
  const schedule = opts.schedule ?? {
    data: { id: SCHEDULE, org_id: ORG, department: null, start_date: "2026-07-01", end_date: "2026-07-31", status: "draft" },
    error: null
  };
  const employee = opts.employee ?? { data: { id: EMP, org_id: ORG, status: "active" }, error: null };

  serviceClientMock.mockReturnValue({
    from: (table: string) => {
      if (table === "schedules") return builder(() => schedule);
      if (table === "profiles") return builder(() => employee);
      // leave_requests / shifts (warning queries) → empty
      return builder(() => ({ data: [], error: null }));
    },
    rpc: (_name: string, args: unknown) => {
      opts.rpcCalls?.push(args);
      return Promise.resolve(opts.rpcResult ?? { data: { created: 1, removed: 0 }, error: null });
    }
  });
}

function ctx() {
  return { params: Promise.resolve({ id: SCHEDULE }) };
}

function postBody(body: unknown) {
  return new Request(`http://localhost/api/v1/scheduling/schedules/${SCHEDULE}/grid`, {
    method: "POST",
    body: JSON.stringify(body)
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  checkApiAccessMock.mockResolvedValue(true);
  getAuthenticatedSessionMock.mockResolvedValue({
    profile: { id: "mgr", org_id: ORG, roles: ["MANAGER"], department: null, full_name: "Mgr" }
  });
});

const validBody = {
  employeeId: EMP,
  slot: { name: "Morning", startTime: "08:00", endTime: "16:00" },
  weekStart: "2026-07-06",
  weekdays: [0, 1, 2]
};

describe("SCHED-03 grid write — tenant & eligibility validation before any write", () => {
  it("rejects an employee from another organization (not found in this org)", async () => {
    wireService({ employee: { data: null, error: null } });
    const res = await POST(postBody(validBody), ctx());
    const payload = await res.json();
    expect(res.status).toBe(404);
    expect(payload.error.code).toBe("EMPLOYEE_NOT_FOUND");
  });

  it("rejects an inactive/offboarded employee", async () => {
    wireService({ employee: { data: { id: EMP, org_id: ORG, status: "offboarded" }, error: null } });
    const res = await POST(postBody(validBody), ctx());
    const payload = await res.json();
    expect(res.status).toBe(422);
    expect(payload.error.code).toBe("EMPLOYEE_NOT_ELIGIBLE");
  });

  it("de-duplicates repeated weekdays before deriving target dates", async () => {
    const rpcCalls: unknown[] = [];
    wireService({ rpcCalls });
    const res = await POST(postBody({ ...validBody, weekdays: [0, 0, 1, 1, 2] }), ctx());
    expect(res.status).toBe(200);
    const args = rpcCalls[0] as { p_target_dates: string[] };
    // Three distinct in-range dates (Mon/Tue/Wed of the week), no duplicates.
    expect(new Set(args.p_target_dates).size).toBe(args.p_target_dates.length);
    expect(args.p_target_dates).toHaveLength(3);
  });

  it("surfaces the RPC's stale-cell conflict as 409", async () => {
    wireService({ rpcResult: { data: { error: "STALE_CELL" }, error: null } });
    const res = await POST(postBody({ ...validBody, expectedShiftIds: ["30000000-0000-4000-8000-000000000001"] }), ctx());
    const payload = await res.json();
    expect(res.status).toBe(409);
    expect(payload.error.code).toBe("GRID_CELL_CONFLICT");
  });

  it("passes the optimistic expected-shift-id guard through to the RPC", async () => {
    const rpcCalls: unknown[] = [];
    wireService({ rpcCalls });
    const expected = ["30000000-0000-4000-8000-000000000001"];
    await POST(postBody({ ...validBody, expectedShiftIds: expected }), ctx());
    const args = rpcCalls[0] as { p_expected_shift_ids: string[] };
    expect(args.p_expected_shift_ids).toEqual(expected);
  });
});
