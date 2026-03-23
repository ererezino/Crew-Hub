import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  getAuthenticatedSessionMock,
  createSupabaseServerClientMock,
  createBulkNotificationsMock,
  sendLeaveRequestedEmailMock
} = vi.hoisted(() => ({
  getAuthenticatedSessionMock: vi.fn(),
  createSupabaseServerClientMock: vi.fn(),
  createBulkNotificationsMock: vi.fn(),
  sendLeaveRequestedEmailMock: vi.fn()
}));

vi.mock("server-only", () => ({}));

vi.mock("../lib/auth/session", () => ({
  getAuthenticatedSession: getAuthenticatedSessionMock
}));

vi.mock("../lib/supabase/server", () => ({
  createSupabaseServerClient: createSupabaseServerClientMock
}));

vi.mock("../lib/notifications/service", () => ({
  createBulkNotifications: createBulkNotificationsMock
}));

vi.mock("../lib/notifications/email", () => ({
  sendLeaveRequestedEmail: sendLeaveRequestedEmailMock
}));

vi.mock("../lib/audit", () => ({
  logAudit: vi.fn().mockResolvedValue(undefined)
}));

vi.mock("../lib/logger", () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn()
  }
}));

function chainable(resolvedValue: { data: unknown; error: unknown }) {
  const self = {
    select: vi.fn(),
    insert: vi.fn(),
    eq: vi.fn(),
    is: vi.fn(),
    gte: vi.fn(),
    lte: vi.fn(),
    limit: vi.fn(),
    single: vi.fn(),
    maybeSingle: vi.fn(),
    then: (resolve: (value: unknown) => void) => resolve(resolvedValue)
  };

  for (const method of ["select", "insert", "eq", "is", "gte", "lte", "limit"]) {
    (self as unknown as Record<string, ReturnType<typeof vi.fn>>)[method].mockReturnValue(self);
  }

  self.single.mockResolvedValue(resolvedValue);
  self.maybeSingle.mockResolvedValue(resolvedValue);

  return self;
}

function makeRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/v1/time-off/requests", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

describe("time-off request policy enforcement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-23T12:00:00Z"));

    getAuthenticatedSessionMock.mockResolvedValue({
      profile: {
        id: "00000000-0000-4000-8000-000000000001",
        org_id: "00000000-0000-4000-8000-000000000002"
      }
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("rejects requests that span multiple calendar years before hitting the database", async () => {
    const { POST } = await import("../app/api/v1/time-off/requests/route");

    const response = await POST(
      makeRequest({
        leaveType: "annual_leave",
        startDate: "2026-12-30",
        endDate: "2027-01-02",
        reason: "Year-end trip"
      })
    );

    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.error?.code).toBe("CROSS_YEAR_REQUEST_NOT_SUPPORTED");
    expect(createSupabaseServerClientMock).not.toHaveBeenCalled();
  });

  it("rejects requests that start in the past before hitting the database", async () => {
    const { POST } = await import("../app/api/v1/time-off/requests/route");

    const response = await POST(
      makeRequest({
        leaveType: "personal_days",
        startDate: "2026-03-20",
        endDate: "2026-03-20",
        reason: "Retroactive request"
      })
    );

    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.error?.code).toBe("PAST_DATE_NOT_ALLOWED");
    expect(createSupabaseServerClientMock).not.toHaveBeenCalled();
  });

  it("enforces the annual-leave notice window before creating the request", async () => {
    createSupabaseServerClientMock.mockResolvedValue({
      from: (table: string) => {
        if (table === "profiles") {
          return chainable({
            data: {
              id: "00000000-0000-4000-8000-000000000001",
              org_id: "00000000-0000-4000-8000-000000000002",
              email: "ada@example.com",
              full_name: "Ada Example",
              department: "Operations",
              country_code: "US",
              manager_id: "00000000-0000-4000-8000-000000000003",
              status: "active"
            },
            error: null
          });
        }

        if (table === "leave_policies") {
          return chainable({
            data: [
              {
                id: "00000000-0000-4000-8000-000000000010",
                country_code: null,
                default_days_per_year: 20,
                is_unlimited: false
              }
            ],
            error: null
          });
        }

        if (table === "holiday_calendars") {
          return chainable({
            data: [],
            error: null
          });
        }

        return chainable({ data: null, error: null });
      }
    });

    const { POST } = await import("../app/api/v1/time-off/requests/route");

    const response = await POST(
      makeRequest({
        leaveType: "annual_leave",
        startDate: "2026-03-27",
        endDate: "2026-03-27",
        reason: "Short-notice trip"
      })
    );

    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.error?.code).toBe("INSUFFICIENT_ADVANCE_NOTICE");
  });
});
