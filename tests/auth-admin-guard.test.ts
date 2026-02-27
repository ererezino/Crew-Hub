import { beforeEach, describe, expect, it, vi } from "vitest";

const { getAuthenticatedSessionMock } = vi.hoisted(() => ({
  getAuthenticatedSessionMock: vi.fn()
}));

vi.mock("../lib/auth/session", () => ({
  getAuthenticatedSession: getAuthenticatedSessionMock
}));

vi.mock("../lib/supabase/service-role", () => ({
  createSupabaseServiceRoleClient: () => ({
    from: () => ({
      update: () => ({
        eq: () => ({
          select: () => ({
            single: async () => ({
              data: { name: "Crew Hub", logo_url: null },
              error: null
            })
          })
        })
      })
    })
  })
}));

import { PATCH } from "../app/api/v1/settings/organization/route";

describe("Organization settings auth guard", () => {
  beforeEach(() => {
    getAuthenticatedSessionMock.mockReset();
  });

  it("returns 401 for unauthenticated requests", async () => {
    getAuthenticatedSessionMock.mockResolvedValueOnce(null);

    const response = await PATCH(
      new Request("http://localhost/api/v1/settings/organization", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Crew Hub",
          logoUrl: ""
        })
      })
    );

    expect(response.status).toBe(401);
  });

  it("returns 403 when EMPLOYEE accesses SUPER_ADMIN endpoint", async () => {
    getAuthenticatedSessionMock.mockResolvedValueOnce({
      profile: {
        id: "b8f0d9f7-d74e-4af1-90f2-9656c3a95d10",
        org_id: "31f57adf-dac6-4f0b-a2d4-00b427f56f75",
        roles: ["EMPLOYEE"]
      },
      org: {
        id: "31f57adf-dac6-4f0b-a2d4-00b427f56f75",
        name: "Crew Hub",
        logo_url: null
      }
    });

    const response = await PATCH(
      new Request("http://localhost/api/v1/settings/organization", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Crew Hub",
          logoUrl: ""
        })
      })
    );

    expect(response.status).toBe(403);
  });
});
