import { beforeEach, describe, expect, it, vi } from "vitest";

/* ── Mock state ── */

type MockProfile = {
  id: string;
  email: string;
  full_name: string;
  roles: string[];
  department: string | null;
  title: string | null;
  country_code: string | null;
  timezone: string | null;
  phone: string | null;
  start_date: string | null;
  date_of_birth: string | null;
  manager_id: string | null;
  employment_type: string;
  payroll_mode: string;
  primary_currency: string;
  status: string;
  notice_period_end_date: string | null;
  avatar_url: string | null;
  bio: string | null;
  favorite_music: string | null;
  favorite_books: string | null;
  favorite_sports: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  emergency_contact_relationship: string | null;
  pronouns: string | null;
  directory_visible: boolean;
  privacy_settings: Record<string, unknown>;
  schedule_type: string | null;
  weekend_shift_hours: string | null;
  crew_hub_joined_at: string | null;
  first_invited_at: string | null;
  account_setup_at: string | null;
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
};

const DEFAULT_PROFILE: MockProfile = {
  id: "b0000000-0000-4000-8000-000000000001",
  email: "alice@accrue.test",
  full_name: "Alice Smith",
  roles: ["EMPLOYEE"],
  department: "Engineering",
  title: "Engineer",
  country_code: "US",
  timezone: "America/New_York",
  phone: null,
  start_date: "2025-01-15",
  date_of_birth: null,
  manager_id: null,
  employment_type: "full_time",
  payroll_mode: "employee_usd_withholding",
  primary_currency: "USD",
  status: "active",
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
  crew_hub_joined_at: null,
  first_invited_at: null,
  account_setup_at: null,
  last_seen_at: null,
  created_at: "2025-01-15T00:00:00Z",
  updated_at: "2025-01-15T00:00:00Z"
};

let capturedUpdateValues: Record<string, unknown> | null = null;
let existingProfile: MockProfile = { ...DEFAULT_PROFILE };

/* ── Mocks ── */

const sessionProfileMock = {
  id: "a0000000-0000-4000-8000-000000000001",
  org_id: "c0000000-0000-4000-8000-000000000001",
  roles: ["EMPLOYEE", "HR_ADMIN"] as string[],
  manager_id: null
};

vi.mock("../lib/auth/session", () => ({
  getAuthenticatedSession: vi.fn(async () => ({
    profile: sessionProfileMock
  }))
}));

vi.mock("../lib/audit", () => ({
  logAudit: vi.fn(async () => undefined)
}));

vi.mock("../lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}));

vi.mock("../lib/auth/navigation-access", () => ({
  applyUserNavigationAccess: vi.fn(async () => ({
    changedNavItemKeys: [],
    grantedNavItemKeys: [],
    revokedNavItemKeys: []
  })),
  resolveEffectiveUserNavSelection: vi.fn(() => ({
    granted: [],
    revoked: []
  }))
}));

vi.mock("../lib/supabase/service-role", () => ({
  createSupabaseServiceRoleClient: vi.fn(() => {
    function createFromQuery() {
      const builder: Record<string, unknown> = {
        select: vi.fn(() => builder),
        eq: vi.fn(() => builder),
        is: vi.fn(() => builder),
        not: vi.fn(() => builder),
        contains: vi.fn(() => builder),
        insert: vi.fn(async () => ({ error: null })),
        upsert: vi.fn(async () => ({ error: null })),
        update: vi.fn((values: Record<string, unknown>) => {
          capturedUpdateValues = values;
          return builder;
        }),
        maybeSingle: vi.fn(async () => ({
          data: existingProfile,
          error: null
        })),
        single: vi.fn(async () => ({
          data: capturedUpdateValues
            ? { ...existingProfile, ...capturedUpdateValues }
            : existingProfile,
          error: null
        }))
      };
      return builder;
    }

    return {
      from: vi.fn(() => createFromQuery()),
      auth: {
        admin: {
          signOut: vi.fn(async () => undefined)
        }
      }
    };
  })
}));

/* ── Helper ── */

async function callPut(personId: string, body: Record<string, unknown>) {
  const { PUT } = await import("../app/api/v1/people/[id]/route");
  const request = new Request("http://localhost/api/v1/people/" + personId, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  const response = await PUT(request, {
    params: Promise.resolve({ id: personId })
  });
  const responseBody = await response.json();
  return { status: response.status, body: responseBody };
}

/* ── Tests ── */

describe("People update — start_date (W2.7)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedUpdateValues = null;
    existingProfile = { ...DEFAULT_PROFILE };
    sessionProfileMock.roles = ["EMPLOYEE", "HR_ADMIN"];
  });

  it("HR_ADMIN can set start_date with a valid YYYY-MM-DD value", async () => {
    const result = await callPut(DEFAULT_PROFILE.id, {
      startDate: "2025-03-15"
    });

    expect(result.status).toBe(200);
    expect(capturedUpdateValues).toEqual(
      expect.objectContaining({ start_date: "2025-03-15" })
    );
    expect(result.body.data.person.startDate).toBe("2025-03-15");
  });

  it("HR_ADMIN can clear start_date by sending null", async () => {
    const result = await callPut(DEFAULT_PROFILE.id, {
      startDate: null
    });

    expect(result.status).toBe(200);
    expect(capturedUpdateValues).toEqual(
      expect.objectContaining({ start_date: null })
    );
  });

  it("start_date is unchanged when omitted from payload", async () => {
    const result = await callPut(DEFAULT_PROFILE.id, {
      title: "Senior Engineer"
    });

    expect(result.status).toBe(200);
    // start_date should NOT be in the update values
    expect(capturedUpdateValues).not.toHaveProperty("start_date");
  });

  it("rejects invalid start_date format", async () => {
    const result = await callPut(DEFAULT_PROFILE.id, {
      startDate: "March 15, 2025"
    });

    expect(result.status).toBe(422);
    expect(result.body.error?.code).toBe("VALIDATION_ERROR");
    expect(result.body.error?.message).toContain("YYYY-MM-DD");
  });

  it("EMPLOYEE cannot update start_date (403)", async () => {
    sessionProfileMock.roles = ["EMPLOYEE"];

    const result = await callPut(DEFAULT_PROFILE.id, {
      startDate: "2025-06-01"
    });

    expect(result.status).toBe(403);
    expect(result.body.error?.code).toBe("FORBIDDEN");
  });

  it("SUPER_ADMIN can set start_date", async () => {
    sessionProfileMock.roles = ["EMPLOYEE", "SUPER_ADMIN"];

    const result = await callPut(DEFAULT_PROFILE.id, {
      startDate: "2024-12-01"
    });

    expect(result.status).toBe(200);
    expect(capturedUpdateValues).toEqual(
      expect.objectContaining({ start_date: "2024-12-01" })
    );
  });

  it("can set a future start_date for pre-boarding", async () => {
    const result = await callPut(DEFAULT_PROFILE.id, {
      startDate: "2027-01-01"
    });

    expect(result.status).toBe(200);
    expect(capturedUpdateValues).toEqual(
      expect.objectContaining({ start_date: "2027-01-01" })
    );
  });
});
