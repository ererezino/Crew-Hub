/**
 * SCHED-01 behavioral tests — the exact screenshot failure.
 *
 * An ordinary employee receives authorized shift rows for teammates, but profile
 * RLS lets them read only their OWN profile, so every other assignee rendered as
 * "Unknown". The fix resolves identities through a narrow, org-scoped,
 * minimum-field service-role resolver. These tests assert behavior at:
 *   1. the resolver (tenant boundary + minimal projection), and
 *   2. the GET /api/v1/scheduling/shifts route (A sees B's real name; open
 *      shifts stay open; an assigned shift with an unresolved name stays
 *      assigned — never relabelled open).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const {
  serviceClientMock,
  serverClientMock,
  getAuthenticatedSessionMock,
  checkApiAccessMock,
  logAuditMock
} = vi.hoisted(() => ({
  serviceClientMock: vi.fn(),
  serverClientMock: vi.fn(),
  getAuthenticatedSessionMock: vi.fn(),
  checkApiAccessMock: vi.fn(),
  logAuditMock: vi.fn()
}));

vi.mock("../lib/supabase/service-role", () => ({
  createSupabaseServiceRoleClient: serviceClientMock
}));
vi.mock("../lib/supabase/server", () => ({
  createSupabaseServerClient: serverClientMock
}));
vi.mock("../lib/auth/session", () => ({ getAuthenticatedSession: getAuthenticatedSessionMock }));
vi.mock("../lib/auth/check-api-access", () => ({ checkApiAccess: checkApiAccessMock }));
vi.mock("../lib/audit", () => ({ logAudit: logAuditMock.mockResolvedValue(undefined) }));

import { resolveSchedulingIdentities } from "../lib/scheduling/identity-resolver";
import { GET } from "../app/api/v1/scheduling/shifts/route";

const ORG = "00000000-0000-4000-8000-000000000001";
const OTHER_ORG = "00000000-0000-4000-8000-0000000000ff";
const A = "00000000-0000-4000-8000-00000000000a"; // signed-in ordinary employee
const B = "00000000-0000-4000-8000-00000000000b"; // teammate
const DELETED = "00000000-0000-4000-8000-00000000000d";

type Result = { data: unknown; error: unknown };

/** Chainable, thenable Supabase builder mock that records its filter calls. */
function builder(resolve: (calls: Record<string, unknown[][]>) => Result) {
  const calls: Record<string, unknown[][]> = {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b: any = {};
  for (const m of ["select", "eq", "is", "in", "order", "limit", "neq", "ilike", "gte", "lte"]) {
    b[m] = (...args: unknown[]) => {
      (calls[m] ??= []).push(args);
      return b;
    };
  }
  b.then = (res: (v: Result) => unknown, rej?: (e: unknown) => unknown) =>
    Promise.resolve(resolve(calls)).then(res, rej);
  return b;
}

beforeEach(() => {
  vi.clearAllMocks();
  checkApiAccessMock.mockResolvedValue(true);
});

describe("resolveSchedulingIdentities (tenant boundary + minimal fields)", () => {
  it("queries profiles constrained to org + not-deleted + the exact ids, projecting only safe fields", async () => {
    let captured: Record<string, unknown[][]> = {};
    serviceClientMock.mockReturnValue({
      from: () =>
        builder((calls) => {
          captured = calls;
          return {
            data: [{ id: B, full_name: "Bola Ade", department: "Customer Success", country_code: "NG" }],
            error: null
          };
        })
    });

    const map = await resolveSchedulingIdentities([B, B], ORG);

    // Exactly the safe projection, keyed by id.
    expect(map.get(B)).toEqual({
      id: B,
      fullName: "Bola Ade",
      department: "Customer Success",
      countryCode: "NG"
    });
    // org_id + deleted_at + id-set constraints were applied.
    expect(captured.eq?.some(([col, val]) => col === "org_id" && val === ORG)).toBe(true);
    expect(captured.is?.some(([col, val]) => col === "deleted_at" && val === null)).toBe(true);
    expect(captured.in?.[0]?.[0]).toBe("id");
    expect(captured.in?.[0]?.[1]).toEqual([B]); // de-duplicated
    // Only the four safe columns were selected — no email/comp/personal fields.
    expect(captured.select?.[0]?.[0]).toBe("id, full_name, department, country_code");
  });

  it("returns nothing for an empty id set without querying", async () => {
    serviceClientMock.mockReturnValue({ from: () => builder(() => ({ data: [], error: null })) });
    const map = await resolveSchedulingIdentities([], ORG);
    expect(map.size).toBe(0);
  });

  it("a cross-org lookup yields no identities (DB returns no rows for the wrong org)", async () => {
    serviceClientMock.mockReturnValue({
      from: () => builder(() => ({ data: [], error: null })) // org filter excludes them
    });
    const map = await resolveSchedulingIdentities([B], OTHER_ORG);
    expect(map.size).toBe(0);
  });
});

describe("GET /api/v1/scheduling/shifts (SCHED-01 end to end)", () => {
  function sessionAsA() {
    getAuthenticatedSessionMock.mockResolvedValue({
      profile: { id: A, org_id: ORG, roles: ["EMPLOYEE"], department: "Customer Success", full_name: "Ada" }
    });
  }

  /** RLS-authorized shift rows the server client returns, and the identities the
   *  service-role resolver returns for the assignees among them. */
  function wireClients(shiftRows: unknown[], identities: unknown[]) {
    serverClientMock.mockResolvedValue({
      from: (table: string) => {
        if (table === "shifts") return builder(() => ({ data: shiftRows, error: null }));
        if (table === "schedules") return builder(() => ({ data: [], error: null }));
        if (table === "shift_templates") return builder(() => ({ data: [], error: null }));
        return builder(() => ({ data: [], error: null }));
      }
    });
    serviceClientMock.mockReturnValue({
      from: () => builder(() => ({ data: identities, error: null }))
    });
  }

  function shiftRow(over: Record<string, unknown>) {
    return {
      id: "10000000-0000-4000-8000-000000000001",
      org_id: ORG,
      schedule_id: "20000000-0000-4000-8000-000000000001",
      template_id: null,
      employee_id: B,
      shift_date: "2026-07-01",
      start_time: "2026-07-01T08:00:00.000Z",
      end_time: "2026-07-01T16:00:00.000Z",
      break_minutes: 0,
      status: "scheduled",
      notes: null,
      color: null,
      created_at: "2026-06-01T00:00:00.000Z",
      updated_at: "2026-06-01T00:00:00.000Z",
      ...over
    };
  }

  it("ordinary employee A sees teammate B's REAL name on a published schedule", async () => {
    sessionAsA();
    wireClients(
      [shiftRow({ id: "10000000-0000-4000-8000-00000000000b", employee_id: B })],
      [{ id: B, full_name: "Bola Ade", department: "Customer Success", country_code: "NG" }]
    );

    const res = await GET(new Request("http://localhost/api/v1/scheduling/shifts?scope=team"));
    const payload = await res.json();

    expect(res.status).toBe(200);
    const shift = payload.data.shifts[0];
    expect(shift.employeeId).toBe(B);
    expect(shift.employeeName).toBe("Bola Ade"); // NOT "Unknown"
    expect(shift.isOpenShift).toBe(false);
  });

  it("a genuinely open shift (employee_id null) renders open, with no assignee", async () => {
    sessionAsA();
    wireClients([shiftRow({ id: "10000000-0000-4000-8000-00000000000c", employee_id: null })], []);

    const res = await GET(new Request("http://localhost/api/v1/scheduling/shifts?scope=team"));
    const payload = await res.json();

    const shift = payload.data.shifts[0];
    expect(shift.employeeId).toBeNull();
    expect(shift.isOpenShift).toBe(true);
    expect(shift.employeeName).toBeNull();
  });

  it("an assigned shift whose name fails to resolve STAYS assigned (never relabelled open)", async () => {
    sessionAsA();
    // Shift assigned to B, but the resolver returns NOTHING for B (resolution gap).
    wireClients([shiftRow({ employee_id: B })], []);

    const res = await GET(new Request("http://localhost/api/v1/scheduling/shifts?scope=team"));
    const payload = await res.json();

    const shift = payload.data.shifts[0];
    expect(shift.employeeId).toBe(B); // still assigned
    expect(shift.isOpenShift).toBe(false); // NOT open — open depends only on employee_id
    expect(shift.employeeName).toBeNull(); // downstream renders the defensive crew label
  });

  it("deleted employees do not leak profile data (resolver returns nothing → name null, still assigned)", async () => {
    sessionAsA();
    wireClients([shiftRow({ employee_id: DELETED })], []); // deleted_at filter excludes them
    const res = await GET(new Request("http://localhost/api/v1/scheduling/shifts?scope=team"));
    const payload = await res.json();
    const shift = payload.data.shifts[0];
    expect(shift.employeeId).toBe(DELETED);
    expect(shift.employeeName).toBeNull();
    expect(shift.isOpenShift).toBe(false);
  });
});
