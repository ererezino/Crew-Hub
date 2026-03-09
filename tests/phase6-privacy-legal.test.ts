import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function readFile(relativePath: string): string {
  return readFileSync(path.resolve(ROOT, relativePath), "utf8");
}

function fileExists(relativePath: string): boolean {
  return existsSync(path.resolve(ROOT, relativePath));
}

describe("Phase 6 — Privacy, Legal, and Data Rights", () => {
  // ── Privacy Policy page ──

  describe("Privacy Policy page", () => {
    const privacyPath = "app/privacy/page.tsx";

    it("exists as a standalone page", () => {
      expect(fileExists(privacyPath)).toBe(true);
    });

    it("exports metadata with correct title", () => {
      const content = readFile(privacyPath);
      expect(content).toContain("Privacy Policy");
      expect(content).toMatch(/metadata[\s\S]*Metadata/);
    });

    it("covers required privacy sections", () => {
      const content = readFile(privacyPath);
      const requiredSections = [
        "Information We Collect",
        "How We Use Your Information",
        "Data Storage",
        "Data Retention",
        "Your Rights",
        "Data Sharing",
        "Contact"
      ];

      for (const section of requiredSections) {
        expect(content).toContain(section);
      }
    });

    it("includes contact email for privacy requests", () => {
      const content = readFile(privacyPath);
      expect(content).toContain("privacy@useaccrue.com");
    });

    it("mentions data export rights", () => {
      const content = readFile(privacyPath);
      expect(content).toMatch(/export/i);
    });

    it("mentions data deletion rights", () => {
      const content = readFile(privacyPath);
      expect(content).toMatch(/delet/i);
    });
  });

  // ── Terms of Service page ──

  describe("Terms of Service page", () => {
    const termsPath = "app/terms/page.tsx";

    it("exists as a standalone page", () => {
      expect(fileExists(termsPath)).toBe(true);
    });

    it("exports metadata with correct title", () => {
      const content = readFile(termsPath);
      expect(content).toContain("Terms of Service");
      expect(content).toMatch(/metadata[\s\S]*Metadata/);
    });

    it("covers required ToS sections", () => {
      const content = readFile(termsPath);
      const requiredSections = [
        "Acceptance of Terms",
        "Service Description",
        "User Accounts",
        "Acceptable Use",
        "Data Ownership",
        "Service Availability",
        "Limitation of Liability",
        "Contact"
      ];

      for (const section of requiredSections) {
        expect(content).toContain(section);
      }
    });

    it("includes legal contact email", () => {
      const content = readFile(termsPath);
      expect(content).toContain("legal@useaccrue.com");
    });
  });

  // ── Legal routes are publicly accessible ──

  describe("middleware allows public access to legal pages", () => {
    it("marks /privacy as a public legal route", () => {
      const content = readFile("lib/supabase/middleware.ts");
      expect(content).toContain("/privacy");
      expect(content).toMatch(/isPublicLegalRoute/);
    });

    it("marks /terms as a public legal route", () => {
      const content = readFile("lib/supabase/middleware.ts");
      expect(content).toContain("/terms");
    });

    it("skips auth redirect for public legal routes", () => {
      const content = readFile("lib/supabase/middleware.ts");
      expect(content).toContain("isPublicLegalRoute");
      // Ensures the public legal check is in the redirect guard
      expect(content).toMatch(/!isPublicLegalRoute/);
    });
  });

  // ── Data Export endpoint ──

  describe("personal data export endpoint", () => {
    const exportPath = "app/api/v1/me/data-export/route.ts";

    it("exists", () => {
      expect(fileExists(exportPath)).toBe(true);
    });

    it("requires authentication", () => {
      const content = readFile(exportPath);
      expect(content).toContain("getAuthenticatedSession");
      expect(content).toContain("UNAUTHORIZED");
    });

    it("exports data from all key tables", () => {
      const content = readFile(exportPath);
      const tables = [
        "profiles",
        "leave_requests",
        "leave_balances",
        "documents",
        "expenses",
        "notifications",
        "review_assignments"
      ];

      for (const table of tables) {
        expect(content).toContain(`"${table}"`);
      }
    });

    it("scopes queries to authenticated user and org", () => {
      const content = readFile(exportPath);
      expect(content).toContain("userId");
      expect(content).toContain("orgId");
      // Each query should filter by user and org
      expect(content).toMatch(/\.eq\(".*id", userId\)/);
      expect(content).toMatch(/\.eq\("org_id", orgId\)/);
    });

    it("respects soft-delete filters", () => {
      const content = readFile(exportPath);
      // Most queries should filter out soft-deleted records
      const softDeleteCount = (content.match(/\.is\("deleted_at", null\)/g) || []).length;
      expect(softDeleteCount).toBeGreaterThanOrEqual(5);
    });

    it("does not export sensitive internal fields", () => {
      const content = readFile(exportPath);
      // Should not export passwords, hashes, internal IDs beyond what's needed
      expect(content).not.toContain("password_hash");
      expect(content).not.toContain("service_role");
    });

    it("logs audit event for data export", () => {
      const content = readFile(exportPath);
      expect(content).toContain("logAudit");
      expect(content).toContain("personal_data_export");
    });

    it("exports data via GET (no mutation needed)", () => {
      const content = readFile(exportPath);
      expect(content).toContain("export async function GET");
      // Should not export POST/PUT/DELETE
      expect(content).not.toContain("export async function POST");
      expect(content).not.toContain("export async function PUT");
      expect(content).not.toContain("export async function DELETE");
    });
  });

  // ── Support / Help link ──

  describe("support page", () => {
    it("exists", () => {
      expect(fileExists("app/(shell)/support/page.tsx")).toBe(true);
    });

    it("links to privacy policy", () => {
      const content = readFile("app/(shell)/support/page.tsx");
      expect(content).toContain("/privacy");
    });

    it("mentions data export in support page", () => {
      const content = readFile("app/(shell)/support/page.tsx");
      expect(content).toMatch(/data export/i);
    });

    it("links to privacy policy from support page", () => {
      const content = readFile("app/(shell)/support/page.tsx");
      expect(content).toContain("/privacy");
    });
  });

  // ── Login protection (account lockout) ──

  describe("login protection system", () => {
    it("has durable login protection module", () => {
      expect(fileExists("lib/security/login-protection.ts")).toBe(true);
    });

    it("enforces max attempt threshold", () => {
      const content = readFile("lib/security/login-protection.ts");
      expect(content).toMatch(/MAX_ATTEMPTS\s*=\s*5/);
    });

    it("normalizes email for consistent tracking", () => {
      const content = readFile("lib/security/login-protection.ts");
      expect(content).toContain("toLowerCase()");
      expect(content).toContain("trim()");
    });

    it("has database migrations for login protection tables", () => {
      const migrationExists = fileExists("supabase/migrations/20260308200000_login_protection.sql");
      expect(migrationExists).toBe(true);
    });
  });
});
