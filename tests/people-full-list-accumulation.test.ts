/**
 * PEOPLE-01 regression: full-list consumers must receive EVERY person, not a
 * silently-truncated first 250.
 *
 * Two layers are covered:
 *   1. `accumulatePeoplePages` (the React-free core of `useAllPeople`) walks
 *      offsets until `hasMore` is false, accumulating every page. A 6-page
 *      fixture (50 per page, 251+ total) must yield all records — proving the
 *      historical 250 ceiling is gone — and a person who lives on page 6 must
 *      be findable via search/filter over the accumulated list.
 *   2. `fetchPeopleData` (the data layer the hook ultimately hits) honors the
 *      offset/limit range for a mid-list page, matching the conventions in
 *      tests/people-list-pagination.test.ts (vi.hoisted mocks, thenable
 *      builder).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { accumulatePeoplePages } from "../hooks/use-people";
import type { PeopleListResponseData, PersonRecord } from "../types/people";

// ── Hoisted mocks (data-layer section) ───────────────────────────────

const { createSupabaseServerClientMock } = vi.hoisted(() => ({
  createSupabaseServerClientMock: vi.fn()
}));

vi.mock("server-only", () => ({}));

vi.mock("../lib/supabase/server", () => ({
  createSupabaseServerClient: createSupabaseServerClientMock
}));

import { fetchPeopleData } from "../lib/people/fetch-people-data";

// ── Fixtures ─────────────────────────────────────────────────────────

const PAGE_SIZE = 50;
const TOTAL_PEOPLE = 251; // 5 full pages + 1 single-record page → exceeds 250

function makePerson(index: number): PersonRecord {
  return {
    id: `c0000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    email: `user${index}@test.com`,
    fullName: `User ${index}`,
    roles: ["EMPLOYEE"],
    department: null,
    title: null,
    countryCode: null,
    timezone: null,
    phone: null,
    startDate: null,
    dateOfBirth: null,
    birthdayMonth: null,
    birthdayDay: null,
    managerId: null,
    managerName: null,
    teamLeadId: null,
    teamLeadName: null,
    employmentType: "full_time",
    payrollMode: "employee_local_withholding",
    primaryCurrency: "USD",
    status: "active",
    noticePeriodEndDate: null,
    avatarUrl: null,
    bio: null,
    favoriteMusic: null,
    favoriteBooks: null,
    favoriteSports: null,
    emergencyContactName: null,
    emergencyContactPhone: null,
    emergencyContactRelationship: null,
    homeAddress: null,
    governmentIdUrl: null,
    pronouns: null,
    socialLinkedin: null,
    socialTwitter: null,
    socialInstagram: null,
    socialGithub: null,
    socialWebsite: null,
    directoryVisible: true,
    privacySettings: {},
    scheduleType: null,
    weekendShiftHours: null,
    crewTag: null,
    accessStatus: "signed_in",
    crewHubJoinedAt: null,
    firstInvitedAt: null,
    accountSetupAt: null,
    lastSeenAt: null,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z"
  };
}

const ALL_PEOPLE = Array.from({ length: TOTAL_PEOPLE }, (_, i) => makePerson(i));

/**
 * Build a page fetcher that slices `ALL_PEOPLE` by offset/pageSize and reports
 * `hasMore` exactly the way the real API does. Returns the fetcher plus a call
 * log so we can assert it actually paged.
 */
function makePagedFetcher(pageSize: number) {
  const offsets: number[] = [];

  const fetchPage = vi.fn(async (offset: number): Promise<PeopleListResponseData> => {
    offsets.push(offset);
    const slice = ALL_PEOPLE.slice(offset, offset + pageSize);
    return {
      people: slice,
      total: ALL_PEOPLE.length,
      hasMore: offset + slice.length < ALL_PEOPLE.length
    };
  });

  return { fetchPage, offsets };
}

// ── accumulatePeoplePages ────────────────────────────────────────────

describe("accumulatePeoplePages (useAllPeople core)", () => {
  it("accumulates every page and is NOT capped at 250", async () => {
    const { fetchPage, offsets } = makePagedFetcher(PAGE_SIZE);

    const result = await accumulatePeoplePages(fetchPage, PAGE_SIZE);

    // All 251 records, not the historical 250 ceiling.
    expect(result.people).toHaveLength(TOTAL_PEOPLE);
    expect(result.people.length).toBeGreaterThan(250);
    expect(result.total).toBe(TOTAL_PEOPLE);
    expect(result.hasMore).toBe(false);

    // It paged through 6 requests (50 * 5 + 1) at the expected offsets.
    expect(fetchPage).toHaveBeenCalledTimes(6);
    expect(offsets).toEqual([0, 50, 100, 150, 200, 250]);

    // No duplicates / drops: the accumulated ids match the source exactly.
    const ids = result.people.map((person) => person.id);
    expect(new Set(ids).size).toBe(TOTAL_PEOPLE);
    expect(ids).toEqual(ALL_PEOPLE.map((person) => person.id));
  });

  it("finds a person who lives beyond the first page (on page 6)", async () => {
    const { fetchPage } = makePagedFetcher(PAGE_SIZE);
    // Person #260 would be person index 250 — the only record on page 6.
    const targetIndex = 250;
    const target = ALL_PEOPLE[targetIndex];

    const result = await accumulatePeoplePages(fetchPage, PAGE_SIZE);

    const byId = result.people.find((person) => person.id === target.id);
    expect(byId).toBeDefined();

    // A search/filter over the accumulated list surfaces the page-6 person.
    const matches = result.people.filter((person) =>
      person.fullName.toLowerCase().includes("user 250")
    );
    expect(matches).toHaveLength(1);
    expect(matches[0]?.id).toBe(target.id);
  });

  it("stops immediately when the first page already covers everyone", async () => {
    const fetchPage = vi.fn(async (): Promise<PeopleListResponseData> => ({
      people: ALL_PEOPLE.slice(0, 3),
      total: 3,
      hasMore: false
    }));

    const result = await accumulatePeoplePages(fetchPage, PAGE_SIZE);

    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(result.people).toHaveLength(3);
    expect(result.total).toBe(3);
  });

  it("does not loop forever if the server lies about hasMore on a short page", async () => {
    // Defensive: hasMore=true but the page is shorter than pageSize → stop.
    const fetchPage = vi.fn(async (offset: number): Promise<PeopleListResponseData> => ({
      people: ALL_PEOPLE.slice(offset, offset + 10), // always short
      total: ALL_PEOPLE.length,
      hasMore: true
    }));

    const result = await accumulatePeoplePages(fetchPage, PAGE_SIZE);

    // One short page is enough to break the loop.
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(result.people).toHaveLength(10);
  });
});

// ── fetchPeopleData (data layer the hook pages through) ──────────────

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

function makeRow(index: number) {
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

function makeProfile() {
  return {
    id: "b0000000-0000-4000-8000-000000000001",
    org_id: "a0000000-0000-4000-8000-000000000001",
    email: "admin@test.com",
    full_name: "Admin User",
    roles: ["SUPER_ADMIN"],
    manager_id: null,
    department: null,
    status: "active"
  } as unknown as Parameters<typeof fetchPeopleData>[0];
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
});

describe("fetchPeopleData mid-list page (data layer)", () => {
  it("requests the page-6 range and reports hasMore=false at the end", async () => {
    // Page 6 with a 50-record page size: offset 250, one record, total 251.
    const rows = [makeRow(250)];
    const { people } = setupSupabase({ data: rows, error: null, count: TOTAL_PEOPLE });

    const result = await fetchPeopleData(makeProfile(), { limit: PAGE_SIZE, offset: 250 });

    expect(people.calls.range).toEqual([[250, 299]]);
    expect(result.people).toHaveLength(1);
    expect(result.total).toBe(TOTAL_PEOPLE);
    expect(result.hasMore).toBe(false);
    expect(result.people[0]?.fullName).toBe("User 250");
  });

  it("reports hasMore=true for an interior page so the loop keeps going", async () => {
    const rows = Array.from({ length: PAGE_SIZE }, (_, i) => makeRow(i));
    const { people } = setupSupabase({ data: rows, error: null, count: TOTAL_PEOPLE });

    const result = await fetchPeopleData(makeProfile(), { limit: PAGE_SIZE, offset: 0 });

    expect(people.calls.range).toEqual([[0, 49]]);
    expect(result.hasMore).toBe(true);
    expect(result.total).toBe(TOTAL_PEOPLE);
  });
});
