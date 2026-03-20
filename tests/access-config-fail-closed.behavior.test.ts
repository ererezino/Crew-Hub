import { beforeEach, describe, expect, it, vi } from "vitest";

const createSupabaseServiceRoleClientMock = vi.fn();
const getAuthenticatedSessionMock = vi.fn();
const loggerWarnMock = vi.fn();

vi.mock("server-only", () => ({}));

vi.mock("react", () => ({
  cache: <T extends (...args: never[]) => unknown>(fn: T) => fn
}));

vi.mock("../lib/supabase/service-role", () => ({
  createSupabaseServiceRoleClient: createSupabaseServiceRoleClientMock
}));

vi.mock("../lib/auth/session", () => ({
  getAuthenticatedSession: getAuthenticatedSessionMock
}));

vi.mock("../lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: loggerWarnMock,
    error: vi.fn()
  }
}));

function buildPageAccessErrorClient() {
  return {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(async () => ({
          data: null,
          error: { message: "db offline" }
        }))
      }))
    }))
  };
}

function buildApiAccessErrorClient() {
  return {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(async () => ({
              data: null,
              error: { message: "db offline" }
            }))
          }))
        }))
      }))
    }))
  };
}

describe("Access config lookups fail closed", () => {
  beforeEach(() => {
    vi.resetModules();
    createSupabaseServiceRoleClientMock.mockReset();
    getAuthenticatedSessionMock.mockReset();
    loggerWarnMock.mockReset();
  });

  it("denies configurable API access when config lookup fails", async () => {
    createSupabaseServiceRoleClientMock.mockReturnValue(buildApiAccessErrorClient());

    const { checkApiAccess } = await import("../lib/auth/check-api-access");

    const allowed = await checkApiAccess("/people", {
      id: "user-1",
      org_id: "org-1",
      roles: ["HR_ADMIN"]
    } as never);

    expect(allowed).toBe(false);
    expect(loggerWarnMock).toHaveBeenCalled();
  });

  it("still allows SUPER_ADMIN through API helper without config lookup", async () => {
    const { checkApiAccess } = await import("../lib/auth/check-api-access");

    const allowed = await checkApiAccess("/people", {
      id: "user-1",
      org_id: "org-1",
      roles: ["SUPER_ADMIN"]
    } as never);

    expect(allowed).toBe(true);
    expect(createSupabaseServiceRoleClientMock).not.toHaveBeenCalled();
  });

  it("denies configurable page access when config lookup fails", async () => {
    getAuthenticatedSessionMock.mockResolvedValue({
      profile: {
        id: "user-1",
        org_id: "org-1",
        roles: ["HR_ADMIN"]
      }
    });
    createSupabaseServiceRoleClientMock.mockReturnValue(buildPageAccessErrorClient());

    const { checkPageAccess } = await import("../lib/auth/check-page-access");
    const result = await checkPageAccess("/people");

    expect(result.allowed).toBe(false);
    expect(result.profile?.id).toBe("user-1");
    expect(loggerWarnMock).toHaveBeenCalled();
  });
});
