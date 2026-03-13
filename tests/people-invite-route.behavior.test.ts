import { beforeEach, describe, expect, it, vi } from "vitest";

const getAuthenticatedSessionMock = vi.fn();
const logAuditMock = vi.fn();
const sendWelcomeEmailMock = vi.fn();
const deriveSystemPasswordMock = vi.fn();

const getUserByIdMock = vi.fn();
const updateUserByIdMock = vi.fn();
const generateLinkMock = vi.fn();
const inviteUserByEmailMock = vi.fn();

const loggerErrorMock = vi.fn();

const profileRow = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "invitee@useaccrue.com",
  full_name: "Invitee Person",
  status: "active"
};

function createProfileQueryBuilder() {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    is: vi.fn(() => builder),
    maybeSingle: vi.fn(async () => ({ data: profileRow, error: null }))
  };

  return builder;
}

vi.mock("../lib/auth/session", () => ({
  getAuthenticatedSession: getAuthenticatedSessionMock
}));

vi.mock("../lib/audit", () => ({
  logAudit: logAuditMock
}));

vi.mock("../lib/notifications/email", () => ({
  sendWelcomeEmail: sendWelcomeEmailMock
}));

vi.mock("../lib/auth/system-password", () => ({
  deriveSystemPassword: deriveSystemPasswordMock
}));

vi.mock("../lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: loggerErrorMock
  }
}));

vi.mock("../lib/supabase/service-role", () => ({
  createSupabaseServiceRoleClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
      if (table === "profiles") {
        return createProfileQueryBuilder();
      }

      throw new Error(`Unexpected table lookup: ${table}`);
    }),
    auth: {
      admin: {
        getUserById: getUserByIdMock,
        updateUserById: updateUserByIdMock,
        generateLink: generateLinkMock,
        inviteUserByEmail: inviteUserByEmailMock
      }
    }
  }))
}));

async function callInviteRoute() {
  const { POST } = await import("../app/api/v1/people/[id]/invite/route");
  const response = await POST(
    new Request("http://localhost:3000/api/v1/people/11111111-1111-4111-8111-111111111111/invite", {
      method: "POST"
    }),
    {
      params: Promise.resolve({
        id: "11111111-1111-4111-8111-111111111111"
      })
    }
  );

  return {
    status: response.status,
    body: await response.json()
  };
}

describe("People invite route behavior", () => {
  const originalAppUrl = process.env.NEXT_PUBLIC_APP_URL;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_APP_URL = originalAppUrl;

    getAuthenticatedSessionMock.mockResolvedValue({
      profile: {
        id: "22222222-2222-4222-8222-222222222222",
        org_id: "33333333-3333-4333-8333-333333333333",
        roles: ["SUPER_ADMIN"]
      }
    });

    getUserByIdMock.mockResolvedValue({
      data: { user: null }
    });

    updateUserByIdMock.mockResolvedValue({ data: {}, error: null });

    generateLinkMock.mockResolvedValue({
      data: {
        properties: {
          hashed_token: "hashed-token-value",
          action_link: "https://example.com/action-link"
        }
      },
      error: null
    });

    inviteUserByEmailMock.mockResolvedValue({ data: { user: null }, error: null });
    sendWelcomeEmailMock.mockResolvedValue(undefined);
    logAuditMock.mockResolvedValue(undefined);
    deriveSystemPasswordMock.mockReturnValue("derived-password");
  });

  it("returns 200 even when audit logging fails after invite generation", async () => {
    logAuditMock.mockRejectedValueOnce(new Error("audit unavailable"));

    const result = await callInviteRoute();

    expect(result.status).toBe(200);
    expect(result.body.data?.inviteSent).toBe(true);
    expect(result.body.data?.inviteLink).toContain("/api/auth/callback");
    expect(logAuditMock).toHaveBeenCalledTimes(1);
    expect(sendWelcomeEmailMock).toHaveBeenCalledTimes(1);
  });

  it("returns structured JSON 500 when an unexpected error occurs", async () => {
    getAuthenticatedSessionMock.mockRejectedValueOnce(new Error("session lookup failed"));

    const result = await callInviteRoute();

    expect(result.status).toBe(500);
    expect(result.body.error?.code).toBe("INVITE_REQUEST_FAILED");
    expect(result.body.error?.message).toContain("Unable to send invite.");
    expect(loggerErrorMock).toHaveBeenCalled();
  });

  it("continues resend invite generation when system password derivation is unavailable", async () => {
    getUserByIdMock.mockResolvedValueOnce({
      data: { user: { id: "11111111-1111-4111-8111-111111111111" } },
      error: null
    });
    deriveSystemPasswordMock.mockImplementationOnce(() => {
      throw new Error("AUTH_SYSTEM_SECRET is not set");
    });

    const result = await callInviteRoute();

    expect(result.status).toBe(200);
    expect(result.body.data?.inviteSent).toBe(true);
    expect(result.body.data?.isResend).toBe(true);
  });

  it("falls back to generate link without redirect URL when redirect config is stale", async () => {
    generateLinkMock
      .mockResolvedValueOnce({
        data: null,
        error: { message: "redirect_to URL is not allowed" }
      })
      .mockResolvedValueOnce({
        data: {
          properties: {
            hashed_token: "fallback-token",
            action_link: "https://example.com/fallback-action"
          }
        },
        error: null
      });

    const result = await callInviteRoute();

    expect(result.status).toBe(200);
    expect(result.body.data?.inviteSent).toBe(true);
    expect(generateLinkMock).toHaveBeenCalledTimes(2);
    expect(generateLinkMock.mock.calls[1]?.[0]).toEqual({
      type: "invite",
      email: "invitee@useaccrue.com",
      options: { data: { full_name: "Invitee Person" } }
    });
  });

  it("accepts app URL values without explicit protocol", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "crew-hub.useaccrue.com";

    const result = await callInviteRoute();

    expect(result.status).toBe(200);
    expect(result.body.data?.inviteLink).toContain("https://crew-hub.useaccrue.com/api/auth/callback");
  });

  it("sends branded welcome email instead of Supabase native invite", async () => {
    const result = await callInviteRoute();

    expect(result.status).toBe(200);
    expect(sendWelcomeEmailMock).toHaveBeenCalledTimes(1);
    expect(inviteUserByEmailMock).not.toHaveBeenCalled();
  });
});
