import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  createSupabaseServiceRoleClientMock,
  createNotificationMock,
  createBulkNotificationsMock
} = vi.hoisted(() => ({
  createSupabaseServiceRoleClientMock: vi.fn(),
  createNotificationMock: vi.fn(),
  createBulkNotificationsMock: vi.fn()
}));

vi.mock("../lib/supabase/service-role", () => ({
  createSupabaseServiceRoleClient: createSupabaseServiceRoleClientMock
}));

vi.mock("../lib/notifications/service", () => ({
  createNotification: createNotificationMock,
  createBulkNotifications: createBulkNotificationsMock
}));

function chainable(resolvedValue: { data: unknown; error: unknown }) {
  const self = {
    select: vi.fn(),
    insert: vi.fn(),
    upsert: vi.fn(),
    or: vi.fn(),
    eq: vi.fn(),
    is: vi.fn(),
    gte: vi.fn(),
    lte: vi.fn(),
    limit: vi.fn(),
    order: vi.fn(),
    maybeSingle: vi.fn(),
    single: vi.fn(),
    then: (resolve: (value: unknown) => void) => resolve(resolvedValue)
  };

  for (const method of ["select", "insert", "upsert", "or", "eq", "is", "gte", "lte", "limit", "order"]) {
    (self as unknown as Record<string, ReturnType<typeof vi.fn>>)[method].mockReturnValue(self);
  }

  self.maybeSingle.mockResolvedValue(resolvedValue);
  self.single.mockResolvedValue(resolvedValue);

  return self;
}

describe("birthday cron notifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-24T07:00:00.000Z"));
    process.env.CRON_SECRET = "test-secret";

    let profilesCallCount = 0;

    createSupabaseServiceRoleClientMock.mockReturnValue({
      from: (table: string) => {
        if (table === "profiles") {
          profilesCallCount += 1;

          if (profilesCallCount === 1) {
            return chainable({
              data: [
                {
                  id: "emp-1",
                  org_id: "org-1",
                  full_name: "Raphaela Rockson",
                  date_of_birth: "1998-03-31",
                  birthday_month: null,
                  birthday_day: null,
                  country_code: "GH",
                  status: "active"
                }
              ],
              error: null
            });
          }

          return chainable({
            data: [
              {
                id: "hr-1",
                full_name: "HR Admin",
                roles: ["HR_ADMIN"],
                status: "active"
              },
              {
                id: "sa-1",
                full_name: "Super Admin",
                roles: ["SUPER_ADMIN"],
                status: "active"
              },
              {
                id: "emp-1",
                full_name: "Raphaela Rockson",
                roles: ["EMPLOYEE"],
                status: "active"
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

        if (table === "leave_requests") {
          return chainable({
            data: [],
            error: null
          });
        }

        if (table === "announcements" || table === "announcement_reads") {
          return chainable({
            data: [],
            error: null
          });
        }

        return chainable({ data: [], error: null });
      }
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("notifies only HR admins 7 days before an employee birthday", async () => {
    const { GET } = await import("../app/api/cron/birthday-leave/route");

    const response = await GET(
      new Request("http://localhost/api/cron/birthday-leave", {
        headers: {
          authorization: "Bearer test-secret"
        }
      })
    );

    expect(response.status).toBe(200);
    expect(createBulkNotificationsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: "org-1",
        userIds: ["hr-1"],
        title: "Upcoming birthday",
        link: "/people",
        dedupeKey: "birthday-admin-reminder:2026-03-24:emp-1"
      })
    );
    expect(createNotificationMock).not.toHaveBeenCalled();
  });
});
