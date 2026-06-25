/**
 * Behavioral tests for POST /api/v1/people/[id]/remove — the quick-remove that
 * archives a departed employee, revokes access, and bans the auth account.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { getAuthenticatedSessionMock, serviceFromMock, signOutMock, updateUserByIdMock, logAuditMock } =
  vi.hoisted(() => ({
    getAuthenticatedSessionMock: vi.fn(),
    serviceFromMock: vi.fn(),
    signOutMock: vi.fn(),
    updateUserByIdMock: vi.fn(),
    logAuditMock: vi.fn()
  }));

vi.mock("../lib/auth/session", () => ({ getAuthenticatedSession: getAuthenticatedSessionMock }));
vi.mock("../lib/audit", () => ({ logAudit: logAuditMock.mockResolvedValue(undefined) }));
vi.mock("../lib/logger", () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));
vi.mock("../lib/supabase/service-role", () => ({
  createSupabaseServiceRoleClient: () => ({
    from: (table: string) => serviceFromMock(table),
    auth: { admin: { signOut: signOutMock, updateUserById: updateUserByIdMock } }
  })
}));

import { POST } from "../app/api/v1/people/[id]/remove/route";

const ORG = "00000000-0000-4000-8000-00000000000a";
const ADMIN = "00000000-0000-4000-8000-0000000000ad";
const EMP = "00000000-0000-4000-8000-00000000000e";

type Result = { data?: unknown; error?: unknown };

function builder(opts: { maybeSingle?: Result; thenable?: Result } = {}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b: any = {};
  for (const m of ["select", "update", "insert", "eq", "is", "in", "neq", "order", "limit"]) {
    b[m] = vi.fn(() => b);
  }
  b.maybeSingle = vi.fn(async () => opts.maybeSingle ?? { data: null, error: null });
  b.then = (resolve: (v: Result) => unknown) => Promise.resolve(opts.thenable ?? { error: null }).then(resolve);
  return b;
}

/** profiles: 1st from() = fetch (maybeSingle), 2nd = update (thenable). */
function wire(opts: { employee?: Result; updateError?: unknown } = {}) {
  let profilesCall = 0;
  serviceFromMock.mockImplementation((table: string) => {
    if (table === "profiles") {
      profilesCall += 1;
      if (profilesCall === 1) {
        return builder({
          maybeSingle: opts.employee ?? {
            data: { id: EMP, full_name: "Esse Udubrah", status: "active", org_id: ORG },
            error: null
          }
        });
      }
      return builder({ thenable: { error: opts.updateError ?? null } });
    }
    // onboarding_instances updates
    return builder({ thenable: { error: null } });
  });
}

function req(body: unknown) {
  return new Request(`http://localhost/api/v1/people/${EMP}/remove`, {
    method: "POST",
    body: JSON.stringify(body)
  });
}
const ctx = () => ({ params: Promise.resolve({ id: EMP }) });

function adminSession() {
  getAuthenticatedSessionMock.mockResolvedValue({
    profile: { id: ADMIN, org_id: ORG, roles: ["HR_ADMIN"], full_name: "Admin" }
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  signOutMock.mockResolvedValue({ data: null, error: null });
  updateUserByIdMock.mockResolvedValue({ data: {}, error: null });
  logAuditMock.mockResolvedValue(undefined);
});

describe("POST /api/v1/people/[id]/remove", () => {
  it("rejects non-admins with 403", async () => {
    getAuthenticatedSessionMock.mockResolvedValue({
      profile: { id: ADMIN, org_id: ORG, roles: ["EMPLOYEE"], full_name: "Nope" }
    });
    wire();
    const res = await POST(req({ confirmName: "Esse Udubrah" }), ctx());
    expect(res.status).toBe(403);
  });

  it("refuses to remove your own account (422)", async () => {
    getAuthenticatedSessionMock.mockResolvedValue({
      profile: { id: EMP, org_id: ORG, roles: ["SUPER_ADMIN"], full_name: "Self" }
    });
    wire();
    const res = await POST(req({ confirmName: "Self" }), ctx());
    const body = await res.json();
    expect(res.status).toBe(422);
    expect(body.error.code).toBe("CANNOT_REMOVE_SELF");
  });

  it("rejects a confirm-name that does not match (422), and does NOT touch auth", async () => {
    adminSession();
    wire();
    const res = await POST(req({ confirmName: "Wrong Name" }), ctx());
    const body = await res.json();
    expect(res.status).toBe(422);
    expect(body.error.code).toBe("NAME_MISMATCH");
    expect(signOutMock).not.toHaveBeenCalled();
    expect(updateUserByIdMock).not.toHaveBeenCalled();
  });

  it("404 when the person is not found (already removed)", async () => {
    adminSession();
    wire({ employee: { data: null, error: null } });
    const res = await POST(req({ confirmName: "Esse Udubrah" }), ctx());
    expect(res.status).toBe(404);
  });

  it("archives, deactivates, revokes sessions and bans the account on success", async () => {
    adminSession();
    wire();
    const res = await POST(req({ confirmName: "esse udubrah", reason: "termination" }), ctx());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toMatchObject({ profileId: EMP, status: "inactive", archived: true, accessRevoked: true });
    // Sessions revoked + account banned (effectively permanent).
    expect(signOutMock).toHaveBeenCalledWith(EMP, "global");
    expect(updateUserByIdMock).toHaveBeenCalledWith(EMP, { ban_duration: expect.any(String) });
    expect(updateUserByIdMock.mock.calls[0]?.[1]?.ban_duration).not.toBe("none");
  });

  it("still archives (200, accessRevoked false) when the ban call fails — best effort", async () => {
    adminSession();
    wire();
    updateUserByIdMock.mockResolvedValue({ data: null, error: { message: "ban failed" } });
    const res = await POST(req({ confirmName: "Esse Udubrah" }), ctx());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.archived).toBe(true);
    expect(body.data.accessRevoked).toBe(false);
  });

  it("returns 500 if the archive update fails", async () => {
    adminSession();
    wire({ updateError: { message: "db down" } });
    const res = await POST(req({ confirmName: "Esse Udubrah" }), ctx());
    expect(res.status).toBe(500);
  });
});
