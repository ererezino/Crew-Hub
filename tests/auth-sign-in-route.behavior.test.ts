import { beforeEach, describe, expect, it, vi } from "vitest";

const recordFailedLoginMock = vi.fn();
const clearFailedLoginsMock = vi.fn();
const deriveSystemPasswordMock = vi.fn();
const updateUserByIdMock = vi.fn();

const signInWithPasswordMock = vi.fn();
const signOutMock = vi.fn();
const listFactorsMock = vi.fn();
const challengeMock = vi.fn();
const verifyMock = vi.fn();

type MockDbState = {
  ipCount: number;
  emailCount: number;
  failedCount: number;
  lockoutUntil: string | null;
  profile: { id: string; status: string } | null;
};

const dbState: MockDbState = {
  ipCount: 0,
  emailCount: 0,
  failedCount: 0,
  lockoutUntil: null,
  profile: { id: "user-1", status: "active" }
};

function createFromQuery(table: string) {
  const filters: Record<string, unknown> = {};

  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn((key: string, value: unknown) => {
      filters[key] = value;
      return builder;
    }),
    is: vi.fn((key: string, value: unknown) => {
      filters[key] = value;
      return builder;
    }),
    gte: vi.fn(async () => {
      if (table === "rate_limit_entries") {
        const bucket = String(filters.bucket ?? "");
        if (bucket === "auth_signin_ip") {
          return { count: dbState.ipCount, error: null };
        }
        if (bucket === "auth_signin_email") {
          return { count: dbState.emailCount, error: null };
        }
      }

      if (table === "failed_login_attempts") {
        return { count: dbState.failedCount, error: null };
      }

      return { count: 0, error: null };
    }),
    gt: vi.fn(() => builder),
    maybeSingle: vi.fn(async () => {
      if (table === "account_lockouts") {
        return {
          data: dbState.lockoutUntil ? { locked_until: dbState.lockoutUntil } : null,
          error: null
        };
      }

      if (table === "profiles") {
        return {
          data: dbState.profile,
          error: null
        };
      }

      return { data: null, error: null };
    }),
    insert: vi.fn(async () => ({ error: null })),
    upsert: vi.fn(async () => ({ error: null }))
  };

  return builder;
}

vi.mock("../lib/security/login-protection", () => ({
  recordFailedLogin: recordFailedLoginMock,
  clearFailedLogins: clearFailedLoginsMock
}));

vi.mock("../lib/auth/system-password", () => ({
  deriveSystemPassword: deriveSystemPasswordMock
}));

vi.mock("../lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(async () => ({
    auth: {
      signInWithPassword: signInWithPasswordMock,
      signOut: signOutMock,
      mfa: {
        listFactors: listFactorsMock,
        challenge: challengeMock,
        verify: verifyMock
      }
    }
  }))
}));

vi.mock("../lib/supabase/service-role", () => ({
  createSupabaseServiceRoleClient: vi.fn(() => ({
    from: vi.fn((table: string) => createFromQuery(table)),
    auth: {
      admin: {
        updateUserById: updateUserByIdMock
      }
    }
  }))
}));

vi.mock("../lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}));

async function callSignIn(payload: unknown, headers: HeadersInit = {}) {
  const { POST } = await import("../app/api/v1/auth/sign-in/route");
  const response = await POST(
    new Request("http://localhost:3000/api/v1/auth/sign-in", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": "203.0.113.10",
        ...headers
      },
      body: JSON.stringify(payload)
    })
  );

  return {
    status: response.status,
    body: await response.json()
  };
}

describe("Auth sign-in route behavior", () => {
  beforeEach(() => {
    recordFailedLoginMock.mockReset();
    clearFailedLoginsMock.mockReset();
    deriveSystemPasswordMock.mockReset();
    updateUserByIdMock.mockReset();
    signInWithPasswordMock.mockReset();
    signOutMock.mockReset();
    listFactorsMock.mockReset();
    challengeMock.mockReset();
    verifyMock.mockReset();

    dbState.ipCount = 0;
    dbState.emailCount = 0;
    dbState.failedCount = 0;
    dbState.lockoutUntil = null;
    dbState.profile = { id: "user-1", status: "active" };

    deriveSystemPasswordMock.mockReturnValue("system-password");
    updateUserByIdMock.mockResolvedValue({ error: null });

    signInWithPasswordMock.mockResolvedValue({
      data: {
        user: {
          id: "user-1",
          factors: [{ id: "factor-1", factor_type: "totp", status: "verified" }]
        }
      },
      error: null
    });

    listFactorsMock.mockResolvedValue({
      data: { totp: [{ id: "factor-1", status: "verified" }] }
    });
    challengeMock.mockResolvedValue({
      data: { id: "challenge-1" },
      error: null
    });
    verifyMock.mockResolvedValue({ error: null });

    signOutMock.mockResolvedValue(undefined);
    recordFailedLoginMock.mockResolvedValue(undefined);
    clearFailedLoginsMock.mockResolvedValue(undefined);
  });

  it("returns 422 for invalid payload", async () => {
    const result = await callSignIn({ email: "not-an-email", totpCode: "123" });
    expect(result.status).toBe(422);
    expect(result.body.error?.code).toBe("VALIDATION_ERROR");
  });

  it("returns 200 and emailAccepted on email-only phase", async () => {
    const result = await callSignIn({ email: "coo@accrue.test" });
    expect(result.status).toBe(200);
    expect(result.body.data?.emailAccepted).toBe(true);
  });

  it("returns 429 when IP rate limit is exceeded", async () => {
    dbState.ipCount = 20;

    const result = await callSignIn({
      email: "coo@accrue.test",
      totpCode: "123456"
    });

    expect(result.status).toBe(429);
    expect(result.body.error?.code).toBe("RATE_LIMIT_EXCEEDED");
  });

  it("returns 429 when account is locked", async () => {
    dbState.lockoutUntil = "2026-03-10T00:00:00.000Z";

    const result = await callSignIn({
      email: "coo@accrue.test",
      totpCode: "123456"
    });

    expect(result.status).toBe(429);
    expect(result.body.error?.code).toBe("ACCOUNT_LOCKED");
    expect(signInWithPasswordMock).not.toHaveBeenCalled();
  });

  it("records failed logins and returns 401 when profile is missing", async () => {
    dbState.profile = null;

    const result = await callSignIn({
      email: "unknown@accrue.test",
      totpCode: "123456"
    });

    expect(result.status).toBe(401);
    expect(result.body.error?.code).toBe("INVALID_CREDENTIALS");
    expect(recordFailedLoginMock).toHaveBeenCalledWith(
      "unknown@accrue.test",
      "203.0.113.10"
    );
    expect(clearFailedLoginsMock).not.toHaveBeenCalled();
  });

  it("records failed logins and returns 401 for invalid TOTP", async () => {
    verifyMock.mockResolvedValueOnce({
      error: { message: "invalid code" }
    });

    const result = await callSignIn({
      email: "coo@accrue.test",
      totpCode: "000000"
    });

    expect(result.status).toBe(401);
    expect(result.body.error?.code).toBe("INVALID_TOTP");
    expect(signOutMock).toHaveBeenCalledTimes(1);
    expect(recordFailedLoginMock).toHaveBeenCalledWith(
      "coo@accrue.test",
      "203.0.113.10"
    );
  });

  it("retries after syncing deterministic password when first sign-in fails", async () => {
    signInWithPasswordMock
      .mockResolvedValueOnce({
        data: { user: null },
        error: { message: "Invalid login credentials." }
      })
      .mockResolvedValueOnce({
        data: {
          user: {
            id: "user-1",
            factors: [{ id: "factor-1", factor_type: "totp", status: "verified" }]
          }
        },
        error: null
      });

    const result = await callSignIn({
      email: "coo@accrue.test",
      totpCode: "123456"
    });

    expect(result.status).toBe(200);
    expect(signInWithPasswordMock).toHaveBeenCalledTimes(2);
    expect(updateUserByIdMock).toHaveBeenCalledWith("user-1", {
      password: "system-password"
    });
    expect(clearFailedLoginsMock).toHaveBeenCalledWith("coo@accrue.test");
  });

  it("clears failed logins and returns 200 on successful sign-in", async () => {
    const result = await callSignIn({
      email: "coo@accrue.test",
      totpCode: "123456"
    });

    expect(result.status).toBe(200);
    expect(result.body.data?.signedIn).toBe(true);
    expect(deriveSystemPasswordMock).toHaveBeenCalledWith("user-1");
    expect(clearFailedLoginsMock).toHaveBeenCalledWith("coo@accrue.test");
    expect(recordFailedLoginMock).not.toHaveBeenCalled();
  });
});
