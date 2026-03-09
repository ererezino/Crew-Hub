import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.resolve(__dirname, "..");

describe("Phase 1 — Emergency Security Remediation", () => {
  describe("SEC-001: Temporary reset endpoint removed", () => {
    it("tmp-admin-reset API route does not exist", () => {
      const apiPath = path.join(ROOT, "app/api/v1/tmp-admin-reset");
      expect(fs.existsSync(apiPath)).toBe(false);
    });

    it("tmp-reset page does not exist", () => {
      const pagePath = path.join(ROOT, "app/tmp-reset");
      expect(fs.existsSync(pagePath)).toBe(false);
    });

    it("middleware does not reference tmp-reset as public route", () => {
      const middlewarePath = path.join(ROOT, "lib/supabase/middleware.ts");
      const content = fs.readFileSync(middlewarePath, "utf-8");
      expect(content).not.toContain("tmp-reset");
      expect(content).not.toContain("tmp_reset");
    });
  });

  describe("SEC-008: Role escalation prevention", () => {
    it("PUT people route blocks non-SUPER_ADMIN from assigning SUPER_ADMIN", () => {
      const routePath = path.join(ROOT, "app/api/v1/people/[id]/route.ts");
      const content = fs.readFileSync(routePath, "utf-8");

      // Must contain the guard that checks SUPER_ADMIN assignment
      expect(content).toContain(
        "Only a Super Admin can assign the Super Admin role."
      );

      // Must block non-super admins from mutating high-risk admin role assignments
      expect(content).toContain(
        "Only a Super Admin can modify admin-role assignments."
      );
      expect(content).toContain("actorIsSuperAdmin");
    });

    it("POST people route also blocks non-SUPER_ADMIN from assigning SUPER_ADMIN", () => {
      const routePath = path.join(ROOT, "app/api/v1/people/route.ts");
      const content = fs.readFileSync(routePath, "utf-8");
      expect(content).toContain(
        "Only a Super Admin can assign the Super Admin role."
      );
    });
  });

  describe("SEC-007: MFA-based authentication (passwords removed)", () => {
    it("sign-in route uses TOTP verification", () => {
      const routePath = path.join(ROOT, "app/api/v1/auth/sign-in/route.ts");
      const content = fs.readFileSync(routePath, "utf-8");
      expect(content).toContain("mfa.challenge");
      expect(content).toContain("mfa.verify");
    });

    it("sign-in route derives system password (invisible to users)", () => {
      const routePath = path.join(ROOT, "app/api/v1/auth/sign-in/route.ts");
      const content = fs.readFileSync(routePath, "utf-8");
      expect(content).toContain("deriveSystemPassword");
    });

    it("MFA route has audit logging", () => {
      const routePath = path.join(ROOT, "app/api/v1/me/mfa/route.ts");
      const content = fs.readFileSync(routePath, "utf-8");
      expect(content).toContain("logAudit");
      expect(content).toContain("mfa_enrolled");
    });
  });

  describe("SEC-003: Login protection and account lockout", () => {
    it("sign-in API route exists", () => {
      const routePath = path.join(ROOT, "app/api/v1/auth/sign-in/route.ts");
      expect(fs.existsSync(routePath)).toBe(true);
    });

    it("login-protection lib exists with check/record/clear functions", () => {
      const libPath = path.join(ROOT, "lib/security/login-protection.ts");
      const content = fs.readFileSync(libPath, "utf-8");
      expect(content).toContain("checkLoginAllowed");
      expect(content).toContain("recordFailedLogin");
      expect(content).toContain("clearFailedLogins");
      expect(content).toContain("MAX_ATTEMPTS");
      expect(content).toContain("LOCKOUT_MINUTES");
    });

    it("login page integrates with sign-in endpoint", () => {
      const loginPath = path.join(ROOT, "app/login/page.tsx");
      const content = fs.readFileSync(loginPath, "utf-8");
      expect(content).toContain("/api/v1/auth/sign-in");
    });

    it("database migration for login protection tables exists", () => {
      const migrationsDir = path.join(ROOT, "supabase/migrations");
      const files = fs.readdirSync(migrationsDir);
      const loginProtectionMigration = files.find((f) =>
        f.includes("login_protection")
      );
      expect(loginProtectionMigration).toBeDefined();
    });
  });

  describe("Rate limiting coverage", () => {
    it("rate limit includes auth, payments, uploads, and approvals buckets", () => {
      const rateLimitPath = path.join(ROOT, "lib/security/rate-limit.ts");
      const content = fs.readFileSync(rateLimitPath, "utf-8");
      expect(content).toContain('"auth"');
      expect(content).toContain('"payments"');
      expect(content).toContain('"uploads"');
      expect(content).toContain('"approvals"');
    });

    it("rate limit covers MFA endpoint", () => {
      const rateLimitPath = path.join(ROOT, "lib/security/rate-limit.ts");
      const content = fs.readFileSync(rateLimitPath, "utf-8");
      expect(content).toContain("/api/v1/me/mfa");
    });
  });

  describe("No other dangerous debug routes", () => {
    it("no route files contain TEMPORARY or DELETE THIS (except test files)", () => {
      const apiDir = path.join(ROOT, "app/api");

      function scanDir(dir: string): string[] {
        const violations: string[] = [];

        if (!fs.existsSync(dir)) return violations;

        const entries = fs.readdirSync(dir, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            violations.push(...scanDir(fullPath));
          } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
            const content = fs.readFileSync(fullPath, "utf-8");
            if (
              content.includes("TEMPORARY") &&
              content.includes("DELETE THIS")
            ) {
              violations.push(fullPath);
            }
          }
        }

        return violations;
      }

      const violations = scanDir(apiDir);
      expect(violations).toEqual([]);
    });
  });
});
