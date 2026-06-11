/**
 * Pagination behavior for the People list.
 *
 * Covers:
 *   1. fetchPeopleData defaults to a 50-record page (light payloads on slow networks)
 *   2. fetchPeopleData honors explicit limit/offset and computes total/hasMore
 *   3. Full-list callers can still request the historical 250-record limit
 *   4. GET /api/v1/people parses limit/offset, defaults limit to 50, and
 *      rejects out-of-range values
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Hoisted mocks ────────────────────────────────────────────────────

const { createSupabaseServerClientMock, getAuthenticatedSessionMock, checkApiAccessMock } =
  vi.hoisted(() => ({
    createSupabaseServerClientMock: vi.fn(),
    getAuthenticatedSessionMock: vi.fn(),
    checkApiAccessMock: vi.fn()
  }));

vi.mock("server-only", () => ({}));

vi.mock("../lib/supabase/server", () => ({
  createSupabaseServerClient: createSupabaseServerClientMock
}));

vi.mock("../lib/auth/session", () => ({
  getAuthenticatedSession: getAuthenticatedSessionMock
}));

vi.mock("../lib/auth/check-api-access", () => ({
  checkApiAccess: checkApiAccessMock
}));

vi.mock("../lib/auth/auth-mutation-guard", () => ({
  getAuthMutationBlockReason: vi.fn().mockReturnValue(null)
}));

vi.mock("../lib/audit", () => ({
  logAudit: vi.fn().mockResolvedValue(undefined)
}));

vi.mock("../lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() }
}));

vi.mock("../lib/notifications/service", () => ({
  createNotification: vi.fn().mockResolvedValue(undefined)
}));

vi.mock("../lib/onboarding/create-instance", () => ({
  createOnboardingInstance: vi.fn()
}));

vi.mock("../lib/auth/navigation-access", () => ({
  applyUserNavigationAccess: vi.fn().mockResolvedValue({ changedNavItemKeys: [] }),
  resolveEffectiveUserNavSelection: vi.fn().mockReturnValue({ granted: [], revoked: [] })
}));

vi.mock("../lib/supabase/service-role", () => ({
  createSupabaseServiceRoleClient: vi.fn()
}));

import {
  fetchPeopleData,
  PEOPLE_DEFAULT_PAGE_SIZE,
  PEOPLE_FULL_LIST_LIMIT
} from "../lib/people/fetch-people-data";
import { GET } from "../app/api/v1/people/route";

// ── Test fixtures ────────────────────────────────────────────────────

const ORG_ID = "a0000000-0000-4000-8000-000000000001";
const ADMIN_ID = "b0000000-0000-4000-8000-000000000001";

function makeProfile() {
  return {
    id: ADMIN_ID,
    org_id: ORG_ID,
    email: "admin@test.com",
    full_name: "Admin User",
    roles: ["SUPER_ADMIN"],
    manager_id: null,
    department: null,
    status: "active"
  } as unknown as Parameters<typeof fetchPeopleData>[0];
}

function makePersonRow(index: number) {
  return {
    id: `c0000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    email: `user${index}@test.com`,
    full_name: `User ${index}`,
    roles: ["EMPLOYEE"],
    department: null,
    title: null,
    country_code: null,
    timezone: null,
    phone: null,
    start_date: null,
    manager_id: null,
    employment_type: "full_time",
    payroll_mode: "employee_local_withholding",
    primary_currency: "USD",
    status: "active",
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z"
  };
}

type QueryResult = { data: unknown; error: unknown; count?: number | null };

/** Chainable, thenable Supabase query builder mock that records calls. */
function createBuilderMock(result: QueryResult) {
  const calls: Record<string, unknown[][]> = {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder: any = {};

  for (const method of ["select", "eq", "is", "in", "not", "order", "limit", "range", "ilike"]) {
    builder[method] = (...args: unknown[]) => {
      (calls[method] ??= []).push(args);
      return builder;
    };
  }

  builder.then = (
    resolve: (value: QueryResult) => unknown,
    reject?: (reason: unknown) => unknown
  ) => Promise.resolve(result).then(resolve, reject);

  return { builder, calls };
}

function setupSupabase(peopleResult: QueryResult) {
  const people = createBuilderMock(peopleResult);
  const payments = createBuilderMock({ data: [], error: null });

  createSupabaseServerClientMock.mockResolvedValue({
    from: (table: string) => (table === "profiles" ? people.builder : payments.builder)
  });

  return { people, payments };
}

beforeEach(() => {
  vi.clearAllMocks();
  checkApiAccessMock.mockResolvedValue(true);
});

// ── fetchPeopleData ──────────────────────────────────────────────────

describe("fetchPeopleData pagination", () => {
  it("defaults to a 50-record page and reports total/hasMore from the count", async () => {
    const rows = Array.from({ length: 50 }, (_, i) => makePersonRow(i));
    const { people } = setupSupabase({ data: rows, error: null, count: 120 });

    const result = await fetchPeopleData(makeProfile(), {});

    expect(PEOPLE_DEFAULT_PAGE_SIZE).toBe(50);
    expect(people.calls.range).toEqual([[0, 49]]);
    expect(people.calls.select?.[0]?.[1]).toEqual({ count: "exact" });
    expect(result.people).toHaveLength(50);
    expect(result.total).toBe(120);
    expect(result.hasMore).toBe(true);
  });

  it("honors explicit limit/offset and reports hasMore=false on the last page", async () => {
    const rows = Array.from({ length: 20 }, (_, i) => makePersonRow(100 + i));
    const { people } = setupSupabase({ data: rows, error: null, count: 120 });

    const result = await fetchPeopleData(makeProfile(), { limit: 50, offset: 100 });

    expect(people.calls.range).toEqual([[100, 149]]);
    expect(result.people).toHaveLength(20);
    expect(result.total).toBe(120);
    expect(result.hasMore).toBe(false);
  });

  it("supports the explicit full-list limit for callers that need every record", async () => {
    const rows = Array.from({ length: 3 }, (_, i) => makePersonRow(i));
    const { people } = setupSupabase({ data: rows, error: null, count: 3 });

    const result = await fetchPeopleData(makeProfile(), { limit: PEOPLE_FULL_LIST_LIMIT });

    expect(PEOPLE_FULL_LIST_LIMIT).toBe(250);
    expect(people.calls.range).toEqual([[0, 249]]);
    expect(result.hasMore).toBe(false);
    expect(result.total).toBe(3);
  });

  it("falls back to the page-full heuristic when no count is returned", async () => {
    const rows = Array.from({ length: 50 }, (_, i) => makePersonRow(i));
    setupSupabase({ data: rows, error: null, count: null });

    const result = await fetchPeopleData(makeProfile(), {});

    expect(result.hasMore).toBe(true);
    expect(result.total).toBe(50);
  });
});

// ── GET /api/v1/people ───────────────────────────────────────────────

describe("GET /api/v1/people pagination params", () => {
  function makeSession() {
    return {
      profile: makeProfile(),
      org: { id: ORG_ID, name: "Test Org", logo_url: null }
    };
  }

  it("defaults to a 50-record page when no limit is provided", async () => {
    getAuthenticatedSessionMock.mockResolvedValue(makeSession());
    const rows = Array.from({ length: 50 }, (_, i) => makePersonRow(i));
    const { people } = setupSupabase({ data: rows, error: null, count: 80 });

    const response = await GET(new Request("http://localhost/api/v1/people?scope=all"));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(people.calls.range).toEqual([[0, 49]]);
    expect(payload.data.people).toHaveLength(50);
    expect(payload.data.total).toBe(80);
    expect(payload.data.hasMore).toBe(true);
    expect(payload.error).toBeNull();
  });

  it("passes offset and limit through to the data layer", async () => {
    getAuthenticatedSessionMock.mockResolvedValue(makeSession());
    const rows = Array.from({ length: 30 }, (_, i) => makePersonRow(50 + i));
    const { people } = setupSupabase({ data: rows, error: null, count: 80 });

    const response = await GET(
      new Request("http://localhost/api/v1/people?scope=all&limit=50&offset=50")
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(people.calls.range).toEqual([[50, 99]]);
    expect(payload.data.total).toBe(80);
    expect(payload.data.hasMore).toBe(false);
  });

  it("rejects a limit above the maximum", async () => {
    getAuthenticatedSessionMock.mockResolvedValue(makeSession());

    const response = await GET(new Request("http://localhost/api/v1/people?limit=500"));
    const payload = await response.json();

    expect(response.status).toBe(422);
    expect(payload.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects a negative offset", async () => {
    getAuthenticatedSessionMock.mockResolvedValue(makeSession());

    const response = await GET(new Request("http://localhost/api/v1/people?offset=-1"));
    const payload = await response.json();

    expect(response.status).toBe(422);
    expect(payload.error.code).toBe("VALIDATION_ERROR");
  });
});
