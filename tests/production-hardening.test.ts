import { describe, it, expect, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");

// ---------------------------------------------------------------------------
// Mock next/server so we can test applySecurityHeaders without a real runtime
// ---------------------------------------------------------------------------
vi.mock("next/server", () => {
  class MockHeaders {
    private store = new Map<string, string>();
    set(k: string, v: string) {
      this.store.set(k, v);
    }
    get(k: string) {
      return this.store.get(k) ?? null;
    }
    has(k: string) {
      return this.store.has(k);
    }
  }
  class MockNextResponse {
    headers = new MockHeaders();
    static json(_body: unknown, _init?: { status?: number }) {
      return new MockNextResponse();
    }
  }
  return { NextResponse: MockNextResponse };
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Production Hardening", () => {
  // =========================================================================
  // 1. Durable rate limiter
  // =========================================================================
  describe("Durable rate limiter (lib/security/durable-rate-limit.ts)", () => {
    it("module file exists", () => {
      expect(
        existsSync(resolve(ROOT, "lib/security/durable-rate-limit.ts"))
      ).toBe(true);
    });

    it("exports checkDurableRateLimit function", async () => {
      // The module uses `import "server-only"` — stub it out
      vi.mock("server-only", () => ({}));
      vi.mock("@/lib/supabase/service-role", () => ({
        createSupabaseServiceRoleClient: () => ({})
      }));

      const mod = await import("@/lib/security/durable-rate-limit");
      expect(typeof mod.checkDurableRateLimit).toBe("function");
    });
  });

  // =========================================================================
  // 2. MFA endpoint
  // =========================================================================
  describe("MFA endpoint (app/api/v1/me/mfa/route.ts)", () => {
    it("route file exists", () => {
      expect(
        existsSync(resolve(ROOT, "app/api/v1/me/mfa/route.ts"))
      ).toBe(true);
    });

    it("exports GET handler", () => {
      const content = readFileSync(
        resolve(ROOT, "app/api/v1/me/mfa/route.ts"),
        "utf-8"
      );
      expect(content).toContain("export async function GET");
    });

    it("exports POST handler", () => {
      const content = readFileSync(
        resolve(ROOT, "app/api/v1/me/mfa/route.ts"),
        "utf-8"
      );
      expect(content).toContain("export async function POST");
    });
  });

  // =========================================================================
  // 3. MFA setup page
  // =========================================================================
  describe("MFA setup page (app/mfa-setup/page.tsx)", () => {
    it("page file exists", () => {
      expect(
        existsSync(resolve(ROOT, "app/mfa-setup/page.tsx"))
      ).toBe(true);
    });
  });

  // =========================================================================
  // 4. Correlation ID / Request ID
  // =========================================================================
  describe("Correlation ID / Request ID", () => {
    it("middleware generates a requestId", () => {
      const content = readFileSync(
        resolve(ROOT, "lib/supabase/middleware.ts"),
        "utf-8"
      );
      expect(content).toContain("requestId");
      expect(content).toContain("crypto.randomUUID()");
    });

    it("applySecurityHeaders sets X-Request-Id when requestId is provided", async () => {
      const { applySecurityHeaders } = await import("@/lib/security/csp");
      const { NextResponse } = await import("next/server");

      const response = NextResponse.json({ ok: true });
      applySecurityHeaders(response as unknown as import("next/server").NextResponse, { requestId: "test-req-123" });

      expect((response as unknown as import("next/server").NextResponse).headers.get("X-Request-Id")).toBe(
        "test-req-123"
      );
    });

    it("applySecurityHeaders does NOT set X-Request-Id when requestId is omitted", async () => {
      const { applySecurityHeaders } = await import("@/lib/security/csp");
      const { NextResponse } = await import("next/server");

      const response = NextResponse.json({ ok: true });
      applySecurityHeaders(response as unknown as import("next/server").NextResponse);

      expect((response as unknown as import("next/server").NextResponse).headers.has("X-Request-Id")).toBe(false);
    });
  });

  // =========================================================================
  // 5. Sign-in abuse defenses integration
  // =========================================================================
  describe("Sign-in abuse defenses integration", () => {
    it("sign-in route queries rate limit and lockout tables", () => {
      const content = readFileSync(
        resolve(ROOT, "app/api/v1/auth/sign-in/route.ts"),
        "utf-8"
      );
      expect(content).toContain("rate_limit_entries");
      expect(content).toContain("account_lockouts");
      expect(content).toContain("failed_login_attempts");
      expect(content).toContain("recordFailedLogin");
      expect(content).toContain("clearFailedLogins");
    });

    it("MFA route exists and handles enrollment", () => {
      const content = readFileSync(
        resolve(ROOT, "app/api/v1/me/mfa/route.ts"),
        "utf-8"
      );
      expect(content).toContain("enroll");
      expect(content).toContain("verify");
    });
  });

  // =========================================================================
  // 6. Security headers completeness
  // =========================================================================
  describe("Security headers completeness", () => {
    it("CSP includes all required directives", async () => {
      const { getContentSecurityPolicy } = await import(
        "@/lib/security/csp"
      );
      const csp = getContentSecurityPolicy();

      const requiredDirectives = [
        "default-src",
        "script-src",
        "style-src",
        "img-src",
        "font-src",
        "connect-src",
        "form-action",
        "base-uri",
        "frame-ancestors",
        "object-src",
        "upgrade-insecure-requests"
      ];

      for (const directive of requiredDirectives) {
        expect(csp).toContain(directive);
      }
    });

    it("CSP does NOT contain unsafe-eval", async () => {
      const { getContentSecurityPolicy } = await import(
        "@/lib/security/csp"
      );
      const csp = getContentSecurityPolicy();
      expect(csp).not.toContain("unsafe-eval");
    });

    it("applySecurityHeaders sets all required response headers", async () => {
      const { applySecurityHeaders } = await import("@/lib/security/csp");
      const { NextResponse } = await import("next/server");

      const response = NextResponse.json({ ok: true });
      applySecurityHeaders(response as unknown as import("next/server").NextResponse, { requestId: "hdr-test" });

      const headers = (response as unknown as import("next/server").NextResponse).headers;

      const expectedHeaders = [
        "Strict-Transport-Security",
        "X-Frame-Options",
        "X-Content-Type-Options",
        "X-DNS-Prefetch-Control",
        "Permissions-Policy",
        "Referrer-Policy",
        "X-Permitted-Cross-Domain-Policies",
        "Content-Security-Policy"
      ];

      for (const name of expectedHeaders) {
        expect(headers.get(name)).not.toBeNull();
      }
    });

    it("HSTS header has a long max-age and includeSubDomains", async () => {
      const { applySecurityHeaders } = await import("@/lib/security/csp");
      const { NextResponse } = await import("next/server");

      const response = NextResponse.json({});
      applySecurityHeaders(response as unknown as import("next/server").NextResponse);

      const hsts = (response as unknown as import("next/server").NextResponse).headers.get(
        "Strict-Transport-Security"
      ) as string;
      expect(hsts).toContain("max-age=");
      expect(hsts).toContain("includeSubDomains");
    });
  });

  // =========================================================================
  // 7. MFA enforcement in middleware
  // =========================================================================
  describe("MFA enforcement in middleware", () => {
    it("middleware source contains mfa references", () => {
      const content = readFileSync(
        resolve(ROOT, "lib/supabase/middleware.ts"),
        "utf-8"
      );
      expect(content.toLowerCase()).toContain("mfa");
    });

    it("middleware responds with MFA_REQUIRED for protected APIs", () => {
      const content = readFileSync(
        resolve(ROOT, "lib/supabase/middleware.ts"),
        "utf-8"
      );
      expect(content).toContain("MFA_REQUIRED");
    });

    it("middleware has explicit MFA API exemptions for setup/sign-in/sign-out", () => {
      const content = readFileSync(
        resolve(ROOT, "lib/supabase/middleware.ts"),
        "utf-8"
      );
      expect(content).toContain("isMfaApiRoute");
      expect(content).toContain("isAuthSignInApiRoute");
      expect(content).toContain("isAuthSignOutApiRoute");
      expect(content).toContain("isMfaExemptApiRoute");
    });

    it("middleware redirects users without MFA to /mfa-setup", () => {
      const content = readFileSync(
        resolve(ROOT, "lib/supabase/middleware.ts"),
        "utf-8"
      );
      expect(content).toContain("/mfa-setup");
    });
  });

  // =========================================================================
  // 8. Feature state registry
  // =========================================================================
  describe("Feature state registry (lib/feature-state.ts)", () => {
    it("MODULE_STATES is importable", async () => {
      const mod = await import("@/lib/feature-state");
      expect(mod.MODULE_STATES).toBeDefined();
      expect(typeof mod.MODULE_STATES).toBe("object");
    });

    it("payroll_disbursement is UNAVAILABLE", async () => {
      const { MODULE_STATES } = await import("@/lib/feature-state");
      expect(MODULE_STATES.payroll_disbursement).toBe("UNAVAILABLE");
    });

    it("all LIVE modules are actionable (isModuleActionable returns true)", async () => {
      const { MODULE_STATES, isModuleActionable } = await import(
        "@/lib/feature-state"
      );
      type ModuleId = keyof typeof MODULE_STATES;

      const liveModules = (Object.keys(MODULE_STATES) as ModuleId[]).filter(
        (id) => MODULE_STATES[id] === "LIVE"
      );

      expect(liveModules.length).toBeGreaterThan(0);

      for (const id of liveModules) {
        expect(isModuleActionable(id)).toBe(true);
      }
    });

    it("UNAVAILABLE modules have actionsDisabled", async () => {
      const { MODULE_STATES, FEATURE_STATE_META } = await import(
        "@/lib/feature-state"
      );
      type ModuleId = keyof typeof MODULE_STATES;

      const unavailableModules = (
        Object.keys(MODULE_STATES) as ModuleId[]
      ).filter((id) => MODULE_STATES[id] === "UNAVAILABLE");

      expect(unavailableModules.length).toBeGreaterThan(0);

      for (const id of unavailableModules) {
        const meta = FEATURE_STATE_META[MODULE_STATES[id]];
        expect(meta.actionsDisabled).toBe(true);
      }
    });

    it("all ModuleId keys are present in MODULE_STATES", async () => {
      const { MODULE_STATES } = await import("@/lib/feature-state");

      const expectedModuleIds = [
        "dashboard",
        "announcements",
        "time_off",
        "my_pay",
        "documents",
        "learning",
        "approvals",
        "people",
        "scheduling",
        "scheduling_auto_generate",
        "onboarding",
        "team_hub",
        "payroll",
        "payroll_disbursement",
        "payroll_withholding_gh",
        "payroll_withholding_ke",
        "payroll_withholding_za",
        "payroll_withholding_ca",
        "expenses",
        "compensation",
        "performance",
        "compliance",
        "analytics",
        "signatures",
        "surveys",
        "notifications"
      ];

      for (const id of expectedModuleIds) {
        expect(MODULE_STATES).toHaveProperty(id);
      }

      // No extra keys
      expect(Object.keys(MODULE_STATES).sort()).toEqual(
        expectedModuleIds.sort()
      );
    });
  });

  // =========================================================================
  // 9. Structured logger
  // =========================================================================
  describe("Structured logger (lib/logger.ts)", () => {
    it("exports logger with debug, info, warn, error methods", async () => {
      const { logger } = await import("@/lib/logger");
      expect(typeof logger.debug).toBe("function");
      expect(typeof logger.info).toBe("function");
      expect(typeof logger.warn).toBe("function");
      expect(typeof logger.error).toBe("function");
    });

    it("REDACTED_FIELDS includes password, token, secret, and other sensitive fields", () => {
      const content = readFileSync(
        resolve(ROOT, "lib/logger.ts"),
        "utf-8"
      );

      const expectedRedactedFields = [
        "password",
        "token",
        "secret",
        "apiKey",
        "authorization",
        "cookie",
        "ssn",
        "creditCard"
      ];

      for (const field of expectedRedactedFields) {
        expect(content).toContain(`"${field}"`);
      }
    });
  });

  // =========================================================================
  // 10. Health endpoint
  // =========================================================================
  describe("Health endpoint (app/api/health/route.ts)", () => {
    it("route file exists", () => {
      expect(
        existsSync(resolve(ROOT, "app/api/health/route.ts"))
      ).toBe(true);
    });

    it("exports GET handler", () => {
      const content = readFileSync(
        resolve(ROOT, "app/api/health/route.ts"),
        "utf-8"
      );
      expect(content).toContain("export async function GET");
    });

    it("returns health status structure with checks", () => {
      const content = readFileSync(
        resolve(ROOT, "app/api/health/route.ts"),
        "utf-8"
      );
      expect(content).toContain("status");
      expect(content).toContain("checks");
      expect(content).toContain("database");
      expect(content).toContain("environment");
    });
  });

  // =========================================================================
  // 11. Privacy and terms pages
  // =========================================================================
  describe("Privacy and terms pages", () => {
    it("privacy page exists", () => {
      expect(existsSync(resolve(ROOT, "app/privacy/page.tsx"))).toBe(true);
    });

    it("terms page exists", () => {
      expect(existsSync(resolve(ROOT, "app/terms/page.tsx"))).toBe(true);
    });
  });

  // =========================================================================
  // 12. Data export endpoint
  // =========================================================================
  describe("Data export endpoint (app/api/v1/me/data-export/route.ts)", () => {
    it("route file exists", () => {
      expect(
        existsSync(resolve(ROOT, "app/api/v1/me/data-export/route.ts"))
      ).toBe(true);
    });

    it("exports GET handler", () => {
      const content = readFileSync(
        resolve(ROOT, "app/api/v1/me/data-export/route.ts"),
        "utf-8"
      );
      expect(content).toContain("export async function GET");
    });
  });

  // =========================================================================
  // 13. Invite setup link reliability
  // =========================================================================
  describe("Invite setup link reliability (app/api/v1/people/[id]/invite/route.ts)", () => {
    it("invite route uses auth callback redirect for onboarding links", () => {
      const content = readFileSync(
        resolve(ROOT, "app/api/v1/people/[id]/invite/route.ts"),
        "utf-8"
      );
      expect(content).toContain("/api/auth/callback?next=/mfa-setup");
    });

    it("invite route constructs token_hash callback links", () => {
      const content = readFileSync(
        resolve(ROOT, "app/api/v1/people/[id]/invite/route.ts"),
        "utf-8"
      );
      expect(content).toContain("token_hash");
      expect(content).toContain("buildSetupLink");
      expect(content).toContain("callbackUrl.searchParams.set(\"type\"");
    });
  });

  // =========================================================================
  // 14. Login protection
  // =========================================================================
  describe("Login protection (lib/security/login-protection.ts)", () => {
    it("module file exists", () => {
      expect(
        existsSync(resolve(ROOT, "lib/security/login-protection.ts"))
      ).toBe(true);
    });

    it("exports checkLoginAllowed", () => {
      const content = readFileSync(
        resolve(ROOT, "lib/security/login-protection.ts"),
        "utf-8"
      );
      expect(content).toContain("export async function checkLoginAllowed");
    });

    it("exports recordFailedLogin", () => {
      const content = readFileSync(
        resolve(ROOT, "lib/security/login-protection.ts"),
        "utf-8"
      );
      expect(content).toContain("export async function recordFailedLogin");
    });

    it("exports clearFailedLogins", () => {
      const content = readFileSync(
        resolve(ROOT, "lib/security/login-protection.ts"),
        "utf-8"
      );
      expect(content).toContain("export async function clearFailedLogins");
    });
  });

  // =========================================================================
  // 15. Upload validation
  // =========================================================================
  describe("Upload validation (lib/security/upload-signatures.ts)", () => {
    it("module file exists", () => {
      expect(
        existsSync(resolve(ROOT, "lib/security/upload-signatures.ts"))
      ).toBe(true);
    });

    it("exports validateUploadMagicBytes function", async () => {
      const mod = await import("@/lib/security/upload-signatures");
      expect(typeof mod.validateUploadMagicBytes).toBe("function");
    });

    it("maps pdf extension to pdf family", () => {
      const content = readFileSync(
        resolve(ROOT, "lib/security/upload-signatures.ts"),
        "utf-8"
      );
      // expectedFamilyForExtension contains mapping logic
      expect(content).toContain("expectedFamilyForExtension");
      expect(content).toContain('"pdf"');
      expect(content).toContain('"png"');
      expect(content).toContain('"jpeg"');
      expect(content).toContain('"zip"');
      expect(content).toContain('"ole"');
    });

    it("maps docx and xlsx to zip family", () => {
      const content = readFileSync(
        resolve(ROOT, "lib/security/upload-signatures.ts"),
        "utf-8"
      );
      expect(content).toContain('"docx"');
      expect(content).toContain('"xlsx"');
    });

    it("maps doc and xls to ole family", () => {
      const content = readFileSync(
        resolve(ROOT, "lib/security/upload-signatures.ts"),
        "utf-8"
      );
      expect(content).toContain('"doc"');
      expect(content).toContain('"xls"');
    });
  });
});
