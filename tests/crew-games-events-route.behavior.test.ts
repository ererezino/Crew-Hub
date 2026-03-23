import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildEventImageUploadPath } from "../lib/crew-games/storage";

const getAuthenticatedSessionMock = vi.fn();
const hasAnyRoleMock = vi.fn();
const logAuditMock = vi.fn();
const fromMock = vi.fn();

let insertedEventPayload: Record<string, unknown> | null = null;

function createEventInsertBuilder() {
  const builder = {
    insert: vi.fn((payload: Record<string, unknown>) => {
      insertedEventPayload = payload;
      return builder;
    }),
    select: vi.fn(() => builder),
    single: vi.fn(async () => ({
      data: {
        id: "event-1",
        org_id: "org-1",
        event_type: insertedEventPayload?.event_type ?? "games_night",
        title: insertedEventPayload?.title ?? "Games Night",
        event_date: insertedEventPayload?.event_date ?? "2026-03-23",
        status: insertedEventPayload?.status ?? "draft",
        description: insertedEventPayload?.description ?? null,
        meet_link: insertedEventPayload?.meet_link ?? null,
        kahoot_link: insertedEventPayload?.kahoot_link ?? null,
        alt_game_link: insertedEventPayload?.alt_game_link ?? null,
        featured_game: insertedEventPayload?.featured_game ?? null,
        event_image_path: insertedEventPayload?.event_image_path ?? null,
        highlights: insertedEventPayload?.highlights ?? null,
        published_at: insertedEventPayload?.published_at ?? null,
        results_published_at: null,
        created_by: insertedEventPayload?.created_by ?? "user-1",
        created_at: "2026-03-23T00:00:00.000Z",
        updated_at: "2026-03-23T00:00:00.000Z"
      },
      error: null
    }))
  };

  return builder;
}

vi.mock("../lib/auth/session", () => ({
  getAuthenticatedSession: getAuthenticatedSessionMock
}));

vi.mock("../lib/auth/roles", () => ({
  hasAnyRole: hasAnyRoleMock
}));

vi.mock("../lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(async () => ({
    from: fromMock
  }))
}));

vi.mock("../lib/audit", () => ({
  logAudit: logAuditMock
}));

describe("Crew Games events route behavior", () => {
  beforeEach(() => {
    insertedEventPayload = null;

    getAuthenticatedSessionMock.mockReset();
    hasAnyRoleMock.mockReset();
    logAuditMock.mockReset();
    fromMock.mockReset();

    getAuthenticatedSessionMock.mockResolvedValue({
      profile: {
        id: "user-1",
        org_id: "org-1",
        roles: ["HR_ADMIN"]
      }
    });

    hasAnyRoleMock.mockReturnValue(true);
    logAuditMock.mockResolvedValue(undefined);
    fromMock.mockImplementation((table: string) => {
      if (table !== "crew_night_events") {
        throw new Error(`Unexpected table: ${table}`);
      }

      return createEventInsertBuilder();
    });
  });

  it("persists eventImagePath when creating a new event", async () => {
    const { POST } = await import("../app/api/v1/crew-games/events/route");

    const response = await POST(
      new Request("http://localhost:3000/api/v1/crew-games/events", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          eventType: "games_night",
          title: "Friday Games",
          eventDate: "2026-03-28",
          status: "draft",
          eventImagePath: "org-1/event-images/event-image-demo.png"
        })
      })
    );

    const body = await response.json();

    expect(response.status).toBe(201);
    expect(insertedEventPayload?.event_image_path).toBe(
      "org-1/event-images/event-image-demo.png"
    );
    expect(body.data?.event?.eventImagePath).toBe(
      "org-1/event-images/event-image-demo.png"
    );
  });

  it("builds unique event image upload paths with the original extension", () => {
    expect(
      buildEventImageUploadPath("org-1", "banner.WEBP", "abc123")
    ).toBe("org-1/event-images/event-image-abc123.webp");

    expect(
      buildEventImageUploadPath("org-1", "mystery-file", "fallback")
    ).toBe("org-1/event-images/event-image-fallback.png");
  });
});
