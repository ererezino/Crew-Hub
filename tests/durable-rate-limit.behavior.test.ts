import { beforeEach, describe, expect, it, vi } from "vitest";

const createSupabaseServiceRoleClientMock = vi.fn();
const loggerWarnMock = vi.fn();

vi.mock("server-only", () => ({}));

vi.mock("../lib/supabase/service-role", () => ({
  createSupabaseServiceRoleClient: createSupabaseServiceRoleClientMock
}));

vi.mock("../lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: loggerWarnMock,
    error: vi.fn()
  }
}));

type SupabaseResult<T> = Promise<{ data?: T; count?: number | null; error: { message: string } | null }>;

function buildRateLimitClient({
  count = 0,
  countError = null,
  insertError = null
}: {
  count?: number;
  countError?: { message: string } | null;
  insertError?: { message: string } | null;
}) {
  return {
    from: vi.fn(() => ({
      select: vi.fn(
        () =>
          ({
            eq: vi.fn(
              () =>
                ({
                  eq: vi.fn(
                    () =>
                      ({
                        gte: vi.fn(
                          async (): SupabaseResult<unknown> => ({
                            count,
                            error: countError
                          })
                        )
                      })
                  )
                })
            )
          }) as unknown
      ),
      insert: vi.fn(
        async (): SupabaseResult<unknown> => ({
          error: insertError
        })
      )
    }))
  };
}

describe("Durable rate limiter behavior", () => {
  beforeEach(() => {
    vi.resetModules();
    createSupabaseServiceRoleClientMock.mockReset();
    loggerWarnMock.mockReset();
    delete (globalThis as { __crewHubDurableRateLimitFallback?: unknown })
      .__crewHubDurableRateLimitFallback;
  });

  it("allows requests below limit when DB operations succeed", async () => {
    createSupabaseServiceRoleClientMock.mockReturnValue(
      buildRateLimitClient({
        count: 0
      })
    );

    const { checkDurableRateLimit } = await import("../lib/security/durable-rate-limit");
    const result = await checkDurableRateLimit({
      bucket: "test",
      key: "user-1",
      limit: 5,
      windowSeconds: 60
    });

    expect(result.allowed).toBe(true);
    expect(result.retryAfterSeconds).toBe(0);
  });

  it("blocks requests at or above limit", async () => {
    createSupabaseServiceRoleClientMock.mockReturnValue(
      buildRateLimitClient({
        count: 5
      })
    );

    const { checkDurableRateLimit } = await import("../lib/security/durable-rate-limit");
    const result = await checkDurableRateLimit({
      bucket: "test",
      key: "user-1",
      limit: 5,
      windowSeconds: 60
    });

    expect(result.allowed).toBe(false);
    expect(result.retryAfterSeconds).toBe(60);
  });

  it("falls back to in-memory limiter when DB count query fails", async () => {
    createSupabaseServiceRoleClientMock.mockReturnValue(
      buildRateLimitClient({
        countError: { message: "database unavailable" }
      })
    );

    const { checkDurableRateLimit } = await import("../lib/security/durable-rate-limit");
    const first = await checkDurableRateLimit({
      bucket: "test-fallback",
      key: "user-2",
      limit: 2,
      windowSeconds: 60
    });
    const second = await checkDurableRateLimit({
      bucket: "test-fallback",
      key: "user-2",
      limit: 2,
      windowSeconds: 60
    });
    const third = await checkDurableRateLimit({
      bucket: "test-fallback",
      key: "user-2",
      limit: 2,
      windowSeconds: 60
    });

    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(true);
    expect(third.allowed).toBe(false);
    expect(loggerWarnMock).toHaveBeenCalled();
  });
});
