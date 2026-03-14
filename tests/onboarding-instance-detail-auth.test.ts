import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Hoisted mocks ─────────────────────────────────────────────────────
const { getAuthenticatedSessionMock, supabaseFromMock } = vi.hoisted(() => ({
  getAuthenticatedSessionMock: vi.fn(),
  supabaseFromMock: vi.fn()
}));

vi.mock("../lib/auth/session", () => ({
  getAuthenticatedSession: getAuthenticatedSessionMock
}));

vi.mock("../lib/notifications/service", () => ({
  createNotification: vi.fn().mockResolvedValue(undefined)
}));

vi.mock("../lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(async () => ({
    from: (...args: unknown[]) => supabaseFromMock(...args)
  }))
}));

// Build a chainable Supabase query mock
function chainable(resolvedValue: { data: unknown; error: unknown }) {
  const self = {
    select: vi.fn(),
    eq: vi.fn(),
    is: vi.fn(),
    in: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    maybeSingle: vi.fn(),
    single: vi.fn(),
    // Make the chain itself thenable (for queries without terminal like .order())
    then: (resolve: (v: unknown) => void) => resolve(resolvedValue)
  };
  // All chainable methods return self
  self.select.mockReturnValue(self);
  self.eq.mockReturnValue(self);
  self.is.mockReturnValue(self);
  self.in.mockReturnValue(self);
  self.order.mockReturnValue(self);
  self.limit.mockReturnValue(self);
  // Terminal methods return a promise
  self.maybeSingle.mockResolvedValue(resolvedValue);
  self.single.mockResolvedValue(resolvedValue);
  return self;
}

import { GET } from "../app/api/v1/onboarding/instances/[instanceId]/route";

// ── Test data ─────────────────────────────────────────────────────────
// Valid RFC 4122 v4 UUIDs (version nibble = 4, variant nibble = 8-b)
const ORG_ID = "a0000000-0000-4000-8000-000000000001";
const INSTANCE_ID = "b0000000-0000-4000-8000-000000000001";
const EMPLOYEE_ID = "c0000000-0000-4000-8000-000000000001";
const MANAGER_ID = "d0000000-0000-4000-8000-000000000001";
const OTHER_USER_ID = "e0000000-0000-4000-8000-000000000001";
const HR_ADMIN_ID = "f0000000-0000-4000-8000-000000000001";
const SUPER_ADMIN_ID = "a1000000-0000-4000-8000-000000000001";
const TEAM_LEAD_ID = "b1000000-0000-4000-8000-000000000001";

const INSTANCE_ROW = {
  id: INSTANCE_ID,
  employee_id: EMPLOYEE_ID,
  template_id: null,
  type: "onboarding",
  status: "active",
  started_at: "2026-01-01T00:00:00.000Z",
  completed_at: null
};

function makeSession(userId: string, roles: string[]) {
  return {
    profile: {
      id: userId,
      org_id: ORG_ID,
      email: "test@example.com",
      full_name: "Test User",
      roles,
      manager_id: null,
      status: "active"
    },
    org: { id: ORG_ID, name: "Test Org", logo_url: null }
  };
}

function makeContext(): { params: Promise<{ instanceId: string }> } {
  return { params: Promise.resolve({ instanceId: INSTANCE_ID }) };
}

function makeRequest(): Request {
  return new Request(
    `http://localhost/api/v1/onboarding/instances/${INSTANCE_ID}`,
    { method: "GET" }
  );
}

// Track call count to distinguish between authorization lookup and metadata lookup
function setupSupabaseMocks(opts: {
  instanceRow?: typeof INSTANCE_ROW | null;
  employeeManagerId?: string | null;
}) {
  let profileCallCount = 0;

  supabaseFromMock.mockImplementation((table: string) => {
    if (table === "onboarding_instances") {
      return chainable({
        data: opts.instanceRow ?? null,
        error: null
      });
    }
    if (table === "onboarding_tasks") {
      return chainable({ data: [], error: null });
    }
    if (table === "profiles") {
      profileCallCount++;
      if (profileCallCount === 1 && opts.employeeManagerId !== undefined) {
        // First call: authorization lookup (manager_id check)
        return chainable({
          data: { manager_id: opts.employeeManagerId },
          error: null
        });
      }
      // Subsequent calls or no manager lookup: profile names
      return chainable({ data: [], error: null });
    }
    if (table === "onboarding_templates") {
      return chainable({ data: null, error: null });
    }
    return chainable({ data: null, error: null });
  });
}

// ── Tests ─────────────────────────────────────────────────────────────
describe("Onboarding instance detail — object-level authorization", () => {
  beforeEach(() => {
    getAuthenticatedSessionMock.mockReset();
    supabaseFromMock.mockReset();
  });

  it("returns 200 when employee views their own instance", async () => {
    getAuthenticatedSessionMock.mockResolvedValueOnce(
      makeSession(EMPLOYEE_ID, ["EMPLOYEE"])
    );
    setupSupabaseMocks({ instanceRow: INSTANCE_ROW });

    const response = await GET(makeRequest(), makeContext());
    expect(response.status).toBe(200);
  });

  it("returns 403 when employee views another employee's instance", async () => {
    getAuthenticatedSessionMock.mockResolvedValueOnce(
      makeSession(OTHER_USER_ID, ["EMPLOYEE"])
    );
    setupSupabaseMocks({ instanceRow: INSTANCE_ROW });

    const response = await GET(makeRequest(), makeContext());
    expect(response.status).toBe(403);

    const body = await response.json();
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("returns 200 when manager views direct report's instance", async () => {
    getAuthenticatedSessionMock.mockResolvedValueOnce(
      makeSession(MANAGER_ID, ["EMPLOYEE", "MANAGER"])
    );
    setupSupabaseMocks({
      instanceRow: INSTANCE_ROW,
      employeeManagerId: MANAGER_ID
    });

    const response = await GET(makeRequest(), makeContext());
    expect(response.status).toBe(200);
  });

  it("returns 403 when manager views non-report's instance", async () => {
    getAuthenticatedSessionMock.mockResolvedValueOnce(
      makeSession(MANAGER_ID, ["EMPLOYEE", "MANAGER"])
    );
    setupSupabaseMocks({
      instanceRow: INSTANCE_ROW,
      employeeManagerId: OTHER_USER_ID // different manager
    });

    const response = await GET(makeRequest(), makeContext());
    expect(response.status).toBe(403);
  });

  it("returns 200 when manager views their own instance", async () => {
    const managerInstance = { ...INSTANCE_ROW, employee_id: MANAGER_ID };
    getAuthenticatedSessionMock.mockResolvedValueOnce(
      makeSession(MANAGER_ID, ["EMPLOYEE", "MANAGER"])
    );
    setupSupabaseMocks({ instanceRow: managerInstance });

    const response = await GET(makeRequest(), makeContext());
    expect(response.status).toBe(200);
  });

  it("returns 200 when HR_ADMIN views any instance", async () => {
    getAuthenticatedSessionMock.mockResolvedValueOnce(
      makeSession(HR_ADMIN_ID, ["EMPLOYEE", "HR_ADMIN"])
    );
    setupSupabaseMocks({ instanceRow: INSTANCE_ROW });

    const response = await GET(makeRequest(), makeContext());
    expect(response.status).toBe(200);
  });

  it("returns 200 when SUPER_ADMIN views any instance", async () => {
    getAuthenticatedSessionMock.mockResolvedValueOnce(
      makeSession(SUPER_ADMIN_ID, ["EMPLOYEE", "SUPER_ADMIN"])
    );
    setupSupabaseMocks({ instanceRow: INSTANCE_ROW });

    const response = await GET(makeRequest(), makeContext());
    expect(response.status).toBe(200);
  });

  it("returns 403 when TEAM_LEAD (no MANAGER role) views another's instance", async () => {
    getAuthenticatedSessionMock.mockResolvedValueOnce(
      makeSession(TEAM_LEAD_ID, ["EMPLOYEE", "TEAM_LEAD"])
    );
    setupSupabaseMocks({ instanceRow: INSTANCE_ROW });

    const response = await GET(makeRequest(), makeContext());
    expect(response.status).toBe(403);
  });

  it("returns 401 for unauthenticated requests", async () => {
    getAuthenticatedSessionMock.mockResolvedValueOnce(null);

    const response = await GET(makeRequest(), makeContext());
    expect(response.status).toBe(401);
  });
});
