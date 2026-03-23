import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

type QResult = { data?: unknown; error?: unknown };

const {
  createSupabaseServiceRoleClientMock,
  notificationQueues,
  insertPayloads
} = vi.hoisted(() => ({
  createSupabaseServiceRoleClientMock: vi.fn(),
  notificationQueues: {} as Record<string, QResult[]>,
  insertPayloads: [] as Array<{ table: string; payload: unknown }>
}));

function read(relativePath: string) {
  return readFileSync(join(__dirname, "..", relativePath), "utf8");
}

function enqueue(table: string, ...results: QResult[]) {
  if (!notificationQueues[table]) {
    notificationQueues[table] = [];
  }
  notificationQueues[table].push(...results);
}

vi.mock("server-only", () => ({}));

vi.mock("../lib/supabase/service-role", () => ({
  createSupabaseServiceRoleClient: createSupabaseServiceRoleClientMock
}));

describe("notification dedupe and visibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(notificationQueues)) delete notificationQueues[key];
    insertPayloads.length = 0;

    createSupabaseServiceRoleClientMock.mockImplementation(() => ({
      from: (table: string) => {
        const obj: Record<string, unknown> = {};
        for (const method of ["select", "eq", "is", "limit"]) {
          obj[method] = (..._args: unknown[]) => obj;
        }
        obj.insert = (payload: unknown) => {
          insertPayloads.push({ table, payload });
          const queue = notificationQueues[table] ?? [];
          return Promise.resolve(queue.shift() ?? { data: null, error: null });
        };
        obj.then = (
          resolve?: (value: QResult) => unknown,
          reject?: (reason: unknown) => unknown
        ) => {
          const queue = notificationQueues[table] ?? [];
          return Promise.resolve(queue.shift() ?? { data: null, error: null }).then(resolve, reject);
        };
        return obj;
      }
    }));
  });

  it("filters announcement-type rows out of the notifications API", () => {
    const source = read("app/api/v1/notifications/route.ts");
    expect(source).toContain('.neq("type", "announcement")');
  });

  it("excludes announcement-type rows from the navigation badge unread notification count", () => {
    const source = read("app/api/v1/navigation/badge-count/route.ts");
    expect(source).toContain('.neq("type", "announcement")');
  });

  it("does not insert a notification when the same dedupe key already exists", async () => {
    enqueue("notifications", { data: [{ id: "dup" }], error: null });

    const { createNotification } = await import("../lib/notifications/service");
    await createNotification({
      orgId: "00000000-0000-4000-a000-000000000001",
      userId: "00000000-0000-4000-a000-000000000002",
      type: "announcement",
      title: "Public Holiday (South Africa 🇿🇦)",
      body: "Today is Human Rights Day. Team members in South Africa have the day off.",
      link: "/announcements",
      dedupeKey: "holiday:abc123:nonresident"
    });

    expect(insertPayloads).toHaveLength(0);
  });
});
