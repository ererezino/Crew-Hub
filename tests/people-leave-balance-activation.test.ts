/**
 * W2.3: Regression guard verifying that the People PUT handler invokes the
 * shared `createLeaveBalancesForActivation()` helper in exactly the right
 * cases after the inline duplication was removed.
 *
 * Covered scenarios:
 *   1. onboarding → active   → CALLS createLeaveBalancesForActivation
 *   2. inactive   → active   → CALLS createLeaveBalancesForActivation
 *   3. onboarding → inactive → does NOT call it
 *   4. active     → active   → does NOT call it (no-op)
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Hoisted mocks ────────────────────────────────────────────────────

const {
  getAuthenticatedSessionMock,
  serviceRoleFromMock,
  createLeaveBalancesForActivationMock,
  signOutMock
} = vi.hoisted(() => ({
  getAuthenticatedSessionMock: vi.fn(),
  serviceRoleFromMock: vi.fn(),
  createLeaveBalancesForActivationMock: vi.fn(),
  signOutMock: vi.fn()
}));

vi.mock("../lib/auth/session", () => ({
  getAuthenticatedSession: getAuthenticatedSessionMock
}));

vi.mock("../lib/onboarding/auto-transition", () => ({
  createLeaveBalancesForActivation: createLeaveBalancesForActivationMock
}));

vi.mock("../lib/audit", () => ({
  logAudit: vi.fn().mockResolvedValue(undefined)
}));

vi.mock("../lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() }
}));

vi.mock("../lib/auth/navigation-access", () => ({
  applyUserNavigationAccess: vi.fn().mockResolvedValue({
    changedNavItemKeys: [],
    grantedNavItemKeys: [],
    revokedNavItemKeys: []
  }),
  resolveEffectiveUserNavSelection: vi.fn().mockReturnValue({
    granted: [],
    revoked: []
  })
}));

vi.mock("../lib/supabase/service-role", () => ({
  createSupabaseServiceRoleClient: vi.fn(() => ({
    from: (...args: unknown[]) => serviceRoleFromMock(...args),
    auth: {
      admin: {
        signOut: signOutMock.mockResolvedValue({ error: null })
      }
    }
  }))
}));

import { PUT } from "../app/api/v1/people/[id]/route";

// ── Test constants ───────────────────────────────────────────────────

const ORG_ID = "a0000000-0000-4000-8000-000000000001";
const ACTOR_ID = "b0000000-0000-4000-8000-000000000001";
const PERSON_ID = "c0000000-0000-4000-8000-000000000001";

function makeSession() {
  return {
    profile: {
      id: ACTOR_ID,
      org_id: ORG_ID,
      email: "admin@test.com",
      full_name: "Admin User",
      roles: ["SUPER_ADMIN"],
      manager_id: null,
      status: "active"
    },
    org: { id: ORG_ID, name: "Test Org", logo_url: null }
  };
}

function makeProfile(status: string) {
  return {
    id: PERSON_ID,
    email: "employee@test.com",
    full_name: "Test Employee",
    roles: ["EMPLOYEE"],
    department: null,
    title: null,
    country_code: "US",
    timezone: null,
    phone: null,
    start_date: "2024-06-01",
    date_of_birth: null,
    manager_id: null,
    employment_type: "full_time",
    payroll_mode: "employee_usd_withholding",
    primary_currency: "USD",
    status,
    notice_period_end_date: null,
    avatar_url: null,
    bio: null,
    favorite_music: null,
    favorite_books: null,
    favorite_sports: null,
    emergency_contact_name: null,
    emergency_contact_phone: null,
    emergency_contact_relationship: null,
    pronouns: null,
    directory_visible: true,
    privacy_settings: {},
    schedule_type: null,
    weekend_shift_hours: null,
    social_linkedin: null,
    social_twitter: null,
    social_instagram: null,
    social_github: null,
    social_website: null,
    crew_hub_joined_at: null,
    first_invited_at: null,
    account_setup_at: null,
    last_seen_at: null,
    created_at: "2024-06-01T00:00:00Z",
    updated_at: "2024-07-01T00:00:00Z"
  };
}

function makeRequest(status: string): Request {
  return new Request(
    `http://localhost/api/v1/people/${PERSON_ID}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status })
    }
  );
}

function makeContext() {
  return { params: Promise.resolve({ id: PERSON_ID }) };
}

// Chainable Supabase mock (same pattern as W1.1 e-signature tests)
function chainable(resolvedValue: { data: unknown; error: unknown }) {
  const self = {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    eq: vi.fn(),
    neq: vi.fn(),
    is: vi.fn(),
    in: vi.fn(),
    not: vi.fn(),
    contains: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    maybeSingle: vi.fn(),
    single: vi.fn(),
    then: (resolve: (v: unknown) => void) => resolve(resolvedValue)
  };
  for (const method of [
    "select", "insert", "update", "eq", "neq", "is", "in",
    "not", "contains", "order", "limit"
  ]) {
    (self as unknown as Record<string, ReturnType<typeof vi.fn>>)[method].mockReturnValue(self);
  }
  self.maybeSingle.mockResolvedValue(resolvedValue);
  self.single.mockResolvedValue(resolvedValue);
  return self;
}

/**
 * Configure the mock Supabase client for a status transition test.
 *
 * The PUT handler calls `from("profiles")` twice:
 *   1. SELECT existing profile
 *   2. UPDATE profile → returns updated row
 *
 * Then optionally:
 *   3. `from("onboarding_instances")` if transitioning away from onboarding
 *   4. `from("employee_payment_details")` for crew tag fetch
 */
function setupMocks(fromStatus: string, toStatus: string) {
  let profilesCallCount = 0;

  serviceRoleFromMock.mockImplementation((table: string) => {
    if (table === "profiles") {
      profilesCallCount++;
      if (profilesCallCount === 1) {
        return chainable({ data: makeProfile(fromStatus), error: null });
      }
      // Call 2+: update or any subsequent SELECT (manager name lookup etc.)
      return chainable({ data: makeProfile(toStatus), error: null });
    }
    if (table === "onboarding_instances") {
      return chainable({ data: null, error: null });
    }
    if (table === "employee_payment_details") {
      return chainable({ data: null, error: null });
    }
    return chainable({ data: null, error: null });
  });
}

// ── Tests ────────────────────────────────────────────────────────────

describe("People PUT — leave-balance activation guard (W2.3)", () => {
  beforeEach(() => {
    getAuthenticatedSessionMock.mockReset();
    serviceRoleFromMock.mockReset();
    createLeaveBalancesForActivationMock.mockReset();
    createLeaveBalancesForActivationMock.mockResolvedValue(undefined);
    signOutMock.mockReset();
    signOutMock.mockResolvedValue({ error: null });
  });

  it("calls createLeaveBalancesForActivation when transitioning onboarding → active", async () => {
    getAuthenticatedSessionMock.mockResolvedValueOnce(makeSession());
    setupMocks("onboarding", "active");

    const response = await PUT(makeRequest("active"), makeContext());
    expect(response.status).toBe(200);

    expect(createLeaveBalancesForActivationMock).toHaveBeenCalledTimes(1);
    expect(createLeaveBalancesForActivationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: ORG_ID,
        employeeId: PERSON_ID,
        countryCode: "US"
      })
    );
  });

  it("calls createLeaveBalancesForActivation when transitioning inactive → active", async () => {
    getAuthenticatedSessionMock.mockResolvedValueOnce(makeSession());
    setupMocks("inactive", "active");

    const response = await PUT(makeRequest("active"), makeContext());
    expect(response.status).toBe(200);

    expect(createLeaveBalancesForActivationMock).toHaveBeenCalledTimes(1);
    expect(createLeaveBalancesForActivationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: ORG_ID,
        employeeId: PERSON_ID,
        countryCode: "US"
      })
    );
  });

  it("does NOT call createLeaveBalancesForActivation when transitioning onboarding → inactive", async () => {
    getAuthenticatedSessionMock.mockResolvedValueOnce(makeSession());
    setupMocks("onboarding", "inactive");

    const response = await PUT(makeRequest("inactive"), makeContext());
    expect(response.status).toBe(200);

    expect(createLeaveBalancesForActivationMock).not.toHaveBeenCalled();
  });

  it("does NOT call createLeaveBalancesForActivation for same-status no-op active → active", async () => {
    getAuthenticatedSessionMock.mockResolvedValueOnce(makeSession());
    setupMocks("active", "active");

    const response = await PUT(makeRequest("active"), makeContext());
    expect(response.status).toBe(200);

    expect(createLeaveBalancesForActivationMock).not.toHaveBeenCalled();
  });
});
