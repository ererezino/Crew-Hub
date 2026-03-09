import { beforeEach, describe, expect, it, vi } from "vitest";

const exchangeCodeForSessionMock = vi.fn();
const verifyOtpMock = vi.fn();

vi.mock("../lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(async () => ({
    auth: {
      exchangeCodeForSession: exchangeCodeForSessionMock,
      verifyOtp: verifyOtpMock
    }
  }))
}));

describe("Auth callback interstitial behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    exchangeCodeForSessionMock.mockResolvedValue({ error: null });
    verifyOtpMock.mockResolvedValue({ error: null });
  });

  it("redirects token-hash callbacks to the continue page", async () => {
    const { GET } = await import("../app/api/auth/callback/route");
    const response = await GET(
      new Request(
        "http://localhost:3000/api/auth/callback?token_hash=abc123&type=invite&next=/mfa-setup"
      )
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/auth/continue?next=%2Fmfa-setup&token_hash=abc123&type=invite"
    );
  });

  it("redirects code callbacks to the continue page", async () => {
    const { GET } = await import("../app/api/auth/callback/route");
    const response = await GET(
      new Request(
        "http://localhost:3000/api/auth/callback?code=pkce-code&next=/mfa-setup"
      )
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/auth/continue?next=%2Fmfa-setup&code=pkce-code"
    );
  });

  it("verifies token-hash payloads only after explicit POST", async () => {
    const { POST } = await import("../app/api/auth/callback/verify/route");

    const response = await POST(
      new Request("http://localhost:3000/api/auth/callback/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tokenHash: "abc123",
          otpType: "invite",
          next: "/mfa-setup"
        })
      })
    );

    const body = await response.json();

    expect(response.status).toBe(200);
    expect(verifyOtpMock).toHaveBeenCalledWith({
      type: "invite",
      token_hash: "abc123"
    });
    expect(body.data?.verified).toBe(true);
    expect(body.data?.redirectTo).toBe("/mfa-setup");
  });

  it("returns 401 when callback token verification fails", async () => {
    verifyOtpMock.mockResolvedValueOnce({
      error: { message: "expired token" }
    });

    const { POST } = await import("../app/api/auth/callback/verify/route");

    const response = await POST(
      new Request("http://localhost:3000/api/auth/callback/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tokenHash: "expired",
          otpType: "invite",
          next: "/mfa-setup"
        })
      })
    );

    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error?.code).toBe("INVALID_OR_EXPIRED_LINK");
  });
});
