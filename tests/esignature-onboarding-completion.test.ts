/**
 * W1.1: Verifies that when an e-signature completion causes the final onboarding
 * task to be marked complete, the system calls completeOnboarding() — producing
 * the same outcome as the normal task completion path (profile activation, leave
 * balances, audit log, in-app notification).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Hoisted mocks ─────────────────────────────────────────────────────
const {
  getAuthenticatedSessionMock,
  supabaseFromMock,
  serviceRoleFromMock,
  completeOnboardingMock,
  serviceRoleStorageMock
} = vi.hoisted(() => ({
  getAuthenticatedSessionMock: vi.fn(),
  supabaseFromMock: vi.fn(),
  serviceRoleFromMock: vi.fn(),
  completeOnboardingMock: vi.fn(),
  serviceRoleStorageMock: vi.fn()
}));

vi.mock("../lib/auth/session", () => ({
  getAuthenticatedSession: getAuthenticatedSessionMock
}));

vi.mock("../lib/audit", () => ({
  logAudit: vi.fn().mockResolvedValue(undefined)
}));

vi.mock("../lib/notifications/email", () => ({
  sendOnboardingCompleteEmail: vi.fn().mockResolvedValue(undefined)
}));

vi.mock("../lib/notifications/service", () => ({
  createNotification: vi.fn().mockResolvedValue(undefined)
}));

vi.mock("../lib/onboarding/auto-transition", () => ({
  completeOnboarding: completeOnboardingMock
}));

vi.mock("../lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(async () => ({
    from: (...args: unknown[]) => supabaseFromMock(...args)
  }))
}));

vi.mock("../lib/supabase/service-role", () => ({
  createSupabaseServiceRoleClient: vi.fn(() => ({
    from: (...args: unknown[]) => serviceRoleFromMock(...args),
    storage: {
      from: () => serviceRoleStorageMock()
    }
  }))
}));

import { POST } from "../app/api/v1/signatures/[requestId]/sign/route";

// ── Test data ─────────────────────────────────────────────────────────
const ORG_ID = "a0000000-0000-4000-8000-000000000001";
const USER_ID = "b0000000-0000-4000-8000-000000000001";
const REQUEST_ID = "c0000000-0000-4000-8000-000000000001";
const SIGNER_ID = "d0000000-0000-4000-8000-000000000001";
const INSTANCE_ID = "e0000000-0000-4000-8000-000000000001";
const TASK_ID = "f0000000-0000-4000-8000-000000000001";
const EMPLOYEE_ID = "a1000000-0000-4000-8000-000000000001";

function makeSession() {
  return {
    profile: {
      id: USER_ID,
      org_id: ORG_ID,
      email: "test@example.com",
      full_name: "Test User",
      roles: ["EMPLOYEE"],
      manager_id: null,
      status: "onboarding"
    },
    org: { id: ORG_ID, name: "Test Org", logo_url: null }
  };
}

function makeRequest(): Request {
  return new Request(
    `http://localhost/api/v1/signatures/${REQUEST_ID}/sign`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        signatureMode: "typed",
        signatureText: "Test User"
      })
    }
  );
}

function makeContext() {
  return { params: Promise.resolve({ requestId: REQUEST_ID }) };
}

// Chainable supabase mock
function chainable(resolvedValue: { data: unknown; error: unknown }) {
  const self = {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    eq: vi.fn(),
    neq: vi.fn(),
    is: vi.fn(),
    in: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    maybeSingle: vi.fn(),
    single: vi.fn(),
    then: (resolve: (v: unknown) => void) => resolve(resolvedValue)
  };
  for (const method of ["select", "insert", "update", "eq", "neq", "is", "in", "order", "limit"]) {
    (self as Record<string, ReturnType<typeof vi.fn>>)[method].mockReturnValue(self);
  }
  self.maybeSingle.mockResolvedValue(resolvedValue);
  self.single.mockResolvedValue(resolvedValue);
  return self;
}

/**
 * Set up the full mock chain for the signature sign route.
 * The route queries many tables in sequence; we need to return
 * the right data for each table call.
 */
function setupMocks(opts: {
  linkedTasks: Array<{ id: string; instance_id: string; org_id: string }>;
  allInstanceTasks: Array<{ id: string; status: string; track: string }>;
  instanceType: "onboarding" | "offboarding";
  employeeId: string;
}) {
  // Regular supabase client (used for reads and signer update)
  const supabaseCalls: string[] = [];
  supabaseFromMock.mockImplementation((table: string) => {
    supabaseCalls.push(table);
    if (table === "signature_requests") {
      return chainable({
        data: {
          id: REQUEST_ID,
          org_id: ORG_ID,
          status: "pending",
          title: "Test Document",
          created_by: USER_ID
        },
        error: null
      });
    }
    if (table === "signature_signers") {
      return chainable({
        data: { id: SIGNER_ID, status: "pending" },
        error: null
      });
    }
    return chainable({ data: null, error: null });
  });

  // Service role client (used for writes and post-sign queries)
  const serviceRoleCalls: string[] = [];
  let onboardingTaskCallCount = 0;

  serviceRoleFromMock.mockImplementation((table: string) => {
    serviceRoleCalls.push(table);

    if (table === "signature_signers") {
      // Check for pending signers — return none (all signed)
      return chainable({ data: [], error: null });
    }
    if (table === "signature_requests") {
      return chainable({ data: null, error: null });
    }
    if (table === "signature_events") {
      return chainable({ data: null, error: null });
    }
    if (table === "onboarding_tasks") {
      onboardingTaskCallCount++;
      if (onboardingTaskCallCount === 1) {
        // First call: find linked tasks by signature_request_id
        return chainable({ data: opts.linkedTasks, error: null });
      }
      if (onboardingTaskCallCount === 2) {
        // Second call: update task status (returns from .update().eq().eq())
        return chainable({ data: null, error: null });
      }
      if (onboardingTaskCallCount === 3) {
        // Third call: recount all instance tasks for progress check
        return chainable({ data: opts.allInstanceTasks, error: null });
      }
      return chainable({ data: [], error: null });
    }
    if (table === "onboarding_instances") {
      // Fetch instance type + employee_id, or update instance
      return chainable({
        data: {
          employee_id: opts.employeeId,
          type: opts.instanceType
        },
        error: null
      });
    }
    if (table === "profiles") {
      return chainable({
        data: {
          id: opts.employeeId,
          full_name: "Test Employee",
          manager_id: USER_ID
        },
        error: null
      });
    }
    return chainable({ data: null, error: null });
  });
}

// ── Tests ─────────────────────────────────────────────────────────────
describe("E-signature completion — onboarding auto-transition (W1.1)", () => {
  beforeEach(() => {
    getAuthenticatedSessionMock.mockReset();
    supabaseFromMock.mockReset();
    serviceRoleFromMock.mockReset();
    completeOnboardingMock.mockReset();
    completeOnboardingMock.mockResolvedValue(undefined);
  });

  it("calls completeOnboarding() when e-signature is the last onboarding task", async () => {
    getAuthenticatedSessionMock.mockResolvedValueOnce(makeSession());
    setupMocks({
      linkedTasks: [{ id: TASK_ID, instance_id: INSTANCE_ID, org_id: ORG_ID }],
      allInstanceTasks: [
        { id: TASK_ID, status: "completed", track: "employee" },
        { id: "f1000000-0000-4000-8000-000000000001", status: "completed", track: "operations" }
      ],
      instanceType: "onboarding",
      employeeId: EMPLOYEE_ID
    });

    const response = await POST(makeRequest(), makeContext());
    expect(response.status).toBe(200);

    // completeOnboarding must have been called with the right args
    expect(completeOnboardingMock).toHaveBeenCalledTimes(1);
    expect(completeOnboardingMock).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: ORG_ID,
        instanceId: INSTANCE_ID,
        employeeId: EMPLOYEE_ID
      })
    );
  });

  it("does NOT call completeOnboarding() when there are still incomplete tasks", async () => {
    getAuthenticatedSessionMock.mockResolvedValueOnce(makeSession());
    setupMocks({
      linkedTasks: [{ id: TASK_ID, instance_id: INSTANCE_ID, org_id: ORG_ID }],
      allInstanceTasks: [
        { id: TASK_ID, status: "completed", track: "employee" },
        { id: "f1000000-0000-4000-8000-000000000001", status: "pending", track: "operations" }
      ],
      instanceType: "onboarding",
      employeeId: EMPLOYEE_ID
    });

    const response = await POST(makeRequest(), makeContext());
    expect(response.status).toBe(200);
    expect(completeOnboardingMock).not.toHaveBeenCalled();
  });

  it("does NOT call completeOnboarding() for offboarding instances", async () => {
    getAuthenticatedSessionMock.mockResolvedValueOnce(makeSession());
    setupMocks({
      linkedTasks: [{ id: TASK_ID, instance_id: INSTANCE_ID, org_id: ORG_ID }],
      allInstanceTasks: [
        { id: TASK_ID, status: "completed", track: "employee" }
      ],
      instanceType: "offboarding",
      employeeId: EMPLOYEE_ID
    });

    const response = await POST(makeRequest(), makeContext());
    expect(response.status).toBe(200);
    expect(completeOnboardingMock).not.toHaveBeenCalled();
  });

  it("does NOT call completeOnboarding() when employee track is done but operations track is not", async () => {
    getAuthenticatedSessionMock.mockResolvedValueOnce(makeSession());
    setupMocks({
      linkedTasks: [{ id: TASK_ID, instance_id: INSTANCE_ID, org_id: ORG_ID }],
      allInstanceTasks: [
        { id: TASK_ID, status: "completed", track: "employee" },
        { id: "f1000000-0000-4000-8000-000000000001", status: "completed", track: "employee" },
        { id: "f2000000-0000-4000-8000-000000000001", status: "pending", track: "operations" }
      ],
      instanceType: "onboarding",
      employeeId: EMPLOYEE_ID
    });

    const response = await POST(makeRequest(), makeContext());
    expect(response.status).toBe(200);
    expect(completeOnboardingMock).not.toHaveBeenCalled();
  });

  it("does NOT call completeOnboarding() when no tasks are linked to the signature request", async () => {
    getAuthenticatedSessionMock.mockResolvedValueOnce(makeSession());
    setupMocks({
      linkedTasks: [],
      allInstanceTasks: [],
      instanceType: "onboarding",
      employeeId: EMPLOYEE_ID
    });

    const response = await POST(makeRequest(), makeContext());
    expect(response.status).toBe(200);
    expect(completeOnboardingMock).not.toHaveBeenCalled();
  });
});
