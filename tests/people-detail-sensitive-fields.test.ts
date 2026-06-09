import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getAuthenticatedSessionMock,
  serviceRoleFromMock,
  checkApiAccessMock
} = vi.hoisted(() => ({
  getAuthenticatedSessionMock: vi.fn(),
  serviceRoleFromMock: vi.fn(),
  checkApiAccessMock: vi.fn()
}));

vi.mock("../lib/auth/session", () => ({
  getAuthenticatedSession: getAuthenticatedSessionMock
}));

vi.mock("../lib/auth/check-api-access", () => ({
  checkApiAccess: checkApiAccessMock
}));

vi.mock("../lib/supabase/service-role", () => ({
  createSupabaseServiceRoleClient: vi.fn(() => ({
    from: (...args: unknown[]) => serviceRoleFromMock(...args)
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

vi.mock("../lib/onboarding/auto-transition", () => ({
  createLeaveBalancesForActivation: vi.fn(async () => undefined)
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

const PERSON_ID = "70000000-0000-4000-8000-000000000001";
const ORG_ID = "70000000-0000-4000-8000-000000000002";
const SELF_ID = "70000000-0000-4000-8000-000000000003";
const HISTORY_ID = "70000000-0000-4000-8000-000000000004";
const ADDRESS_HISTORY_ID = "70000000-0000-4000-8000-000000000005";

function chainable(resolvedValue: { data: unknown; error: unknown }) {
  const self = {
    select: vi.fn(),
    eq: vi.fn(),
    is: vi.fn(),
    ilike: vi.fn(),
    in: vi.fn(),
    not: vi.fn(),
    order: vi.fn(),
    maybeSingle: vi.fn(),
    single: vi.fn(),
    then: (resolve: (value: unknown) => void) => resolve(resolvedValue)
  };

  for (const method of ["select", "eq", "is", "ilike", "in", "not", "order"]) {
    (self as unknown as Record<string, ReturnType<typeof vi.fn>>)[method].mockReturnValue(self);
  }

  self.maybeSingle.mockResolvedValue(resolvedValue);
  self.single.mockResolvedValue(resolvedValue);
  return self;
}

function makeProfileRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: PERSON_ID,
    email: "employee@useaccrue.com",
    full_name: "Employee Example",
    roles: ["EMPLOYEE"],
    department: "Operations",
    title: "Operator",
    country_code: "NG",
    timezone: "Africa/Lagos",
    phone: "+2348000000000",
    start_date: "2024-01-15",
    date_of_birth: null,
    birthday_month: 3,
    birthday_day: 23,
    manager_id: null,
    team_lead_id: null,
    employment_type: "full_time",
    payroll_mode: "employee_local_withholding",
    primary_currency: "NGN",
    status: "active",
    notice_period_end_date: null,
    avatar_url: null,
    bio: null,
    favorite_music: null,
    favorite_books: null,
    favorite_sports: null,
    emergency_contact_name: "Emergency Example",
    emergency_contact_phone: "+2348111111111",
    emergency_contact_relationship: "Sibling",
    home_address: "12 Example Street",
    government_id_url: "https://docs.example/current-id.pdf",
    pronouns: null,
    directory_visible: true,
    privacy_settings: {},
    crew_hub_joined_at: null,
    first_invited_at: null,
    account_setup_at: null,
    last_seen_at: null,
    created_at: "2025-01-01T00:00:00.000Z",
    updated_at: "2025-01-02T00:00:00.000Z",
    ...overrides
  };
}

function setupServiceRoleMocks(profileRow: ReturnType<typeof makeProfileRow>) {
  serviceRoleFromMock.mockImplementation((table: string) => {
    if (table === "profiles") {
      return chainable({ data: profileRow, error: null });
    }

    if (table === "employee_payment_details") {
      return chainable({ data: null, error: null });
    }

    if (table === "profile_id_document_history") {
      return chainable({
        data: [
          {
            id: HISTORY_ID,
            document_url: "https://docs.example/old-id.pdf",
            replaced_by_url: "https://docs.example/current-id.pdf",
            archived_at: "2025-02-01T00:00:00.000Z",
            removed_at: null
          }
        ],
        error: null
      });
    }

    if (table === "profile_address_history") {
      return chainable({
        data: [
          {
            id: ADDRESS_HISTORY_ID,
            address_text: "10 Former Address Lane",
            replaced_by_address: "12 Example Street",
            archived_at: "2025-01-15T00:00:00.000Z",
            removed_at: null
          }
        ],
        error: null
      });
    }

    return chainable({ data: null, error: null });
  });
}

async function callGet(sessionProfile: {
  id: string;
  org_id: string;
  roles: string[];
  manager_id: string | null;
  department?: string | null;
}) {
  getAuthenticatedSessionMock.mockResolvedValue({
    profile: {
      ...sessionProfile,
      email: "viewer@useaccrue.com",
      full_name: "Viewer Example"
    }
  });

  const { GET } = await import("../app/api/v1/people/[id]/route");
  const response = await GET(new Request(`http://localhost/api/v1/people/${PERSON_ID}`), {
    params: Promise.resolve({ id: PERSON_ID })
  });

  return {
    status: response.status,
    body: await response.json()
  };
}

describe("People detail sensitive field visibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checkApiAccessMock.mockResolvedValue(false);
    setupServiceRoleMocks(makeProfileRow());
  });

  it("lets employees view their current government ID without exposing archived IDs or home address", async () => {
    const result = await callGet({
      id: PERSON_ID,
      org_id: ORG_ID,
      roles: ["EMPLOYEE"],
      manager_id: null,
      department: "Operations"
    });

    expect(result.status).toBe(200);
    expect(result.body.data.person.governmentIdUrl).toBe("https://docs.example/current-id.pdf");
    expect(result.body.data.person.homeAddress).toBeNull();
    expect(result.body.data.governmentIdHistory).toEqual([]);
    expect(result.body.data.addressHistory).toEqual([]);
  });

  it("lets finance admins view current and archived government IDs while keeping home address redacted", async () => {
    const result = await callGet({
      id: SELF_ID,
      org_id: ORG_ID,
      roles: ["EMPLOYEE", "FINANCE_ADMIN"],
      manager_id: null,
      department: "Finance"
    });

    expect(result.status).toBe(200);
    expect(result.body.data.person.governmentIdUrl).toBe("https://docs.example/current-id.pdf");
    expect(result.body.data.person.homeAddress).toBeNull();
    expect(result.body.data.governmentIdHistory).toHaveLength(1);
    expect(result.body.data.addressHistory).toEqual([]);
  });

  it("lets HR admins view home address, archived addresses, and archived government IDs", async () => {
    const result = await callGet({
      id: SELF_ID,
      org_id: ORG_ID,
      roles: ["EMPLOYEE", "HR_ADMIN"],
      manager_id: null,
      department: "People"
    });

    expect(result.status).toBe(200);
    expect(result.body.data.person.governmentIdUrl).toBe("https://docs.example/current-id.pdf");
    expect(result.body.data.person.homeAddress).toBe("12 Example Street");
    expect(result.body.data.governmentIdHistory).toHaveLength(1);
    expect(result.body.data.addressHistory).toHaveLength(1);
    expect(result.body.data.addressHistory[0].address).toBe("10 Former Address Lane");
  });

  it("keeps government IDs hidden from team leads viewing another employee", async () => {
    const result = await callGet({
      id: SELF_ID,
      org_id: ORG_ID,
      roles: ["EMPLOYEE", "TEAM_LEAD"],
      manager_id: null,
      department: "Operations"
    });

    expect(result.status).toBe(200);
    expect(result.body.data.person.governmentIdUrl).toBeNull();
    expect(result.body.data.person.homeAddress).toBeNull();
    expect(result.body.data.governmentIdHistory).toEqual([]);
    expect(result.body.data.addressHistory).toEqual([]);
  });
});
