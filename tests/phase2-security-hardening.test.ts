import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.resolve(__dirname, "..");

describe("Phase 2 — Security Hardening to Launch Standard", () => {
  describe("SEC-006: HSTS Header", () => {
    it("security headers include Strict-Transport-Security", () => {
      const cspPath = path.join(ROOT, "lib/security/csp.ts");
      const content = fs.readFileSync(cspPath, "utf-8");
      expect(content).toContain("Strict-Transport-Security");
      expect(content).toContain("max-age=63072000");
      expect(content).toContain("includeSubDomains");
      expect(content).toContain("preload");
    });
  });

  describe("SEC-005: CSP Hardening", () => {
    it("CSP does not use unsafe-eval in the policy string", () => {
      const cspPath = path.join(ROOT, "lib/security/csp.ts");
      const content = fs.readFileSync(cspPath, "utf-8");
      // Extract lines that form the actual CSP policy (between the array brackets)
      const cspLines = content
        .split("\n")
        .filter((line) => line.trim().startsWith('"') && line.includes("-src"));
      // None of the directive lines should contain unsafe-eval
      for (const line of cspLines) {
        expect(line).not.toContain("unsafe-eval");
      }
    });

    it("CSP includes upgrade-insecure-requests", () => {
      const cspPath = path.join(ROOT, "lib/security/csp.ts");
      const content = fs.readFileSync(cspPath, "utf-8");
      expect(content).toContain("upgrade-insecure-requests");
    });

    it("CSP blocks framing", () => {
      const cspPath = path.join(ROOT, "lib/security/csp.ts");
      const content = fs.readFileSync(cspPath, "utf-8");
      expect(content).toContain("frame-ancestors 'none'");
    });
  });

  describe("Additional security headers", () => {
    it("X-DNS-Prefetch-Control header is set", () => {
      const cspPath = path.join(ROOT, "lib/security/csp.ts");
      const content = fs.readFileSync(cspPath, "utf-8");
      expect(content).toContain("X-DNS-Prefetch-Control");
    });

    it("X-Permitted-Cross-Domain-Policies header is set", () => {
      const cspPath = path.join(ROOT, "lib/security/csp.ts");
      const content = fs.readFileSync(cspPath, "utf-8");
      expect(content).toContain("X-Permitted-Cross-Domain-Policies");
    });
  });

  describe("Upload validation", () => {
    it("upload route validates magic bytes", () => {
      const uploadPath = path.join(ROOT, "app/api/v1/documents/upload/route.ts");
      const content = fs.readFileSync(uploadPath, "utf-8");
      expect(content).toContain("validateUploadMagicBytes");
      expect(content).toContain("MAX_DOCUMENT_FILE_BYTES");
      expect(content).toContain("isAllowedDocumentUpload");
    });

    it("upload route enforces authorization", () => {
      const uploadPath = path.join(ROOT, "app/api/v1/documents/upload/route.ts");
      const content = fs.readFileSync(uploadPath, "utf-8");
      expect(content).toContain("getAuthenticatedSession");
      expect(content).toContain("UNAUTHORIZED");
      expect(content).toContain("FORBIDDEN");
    });

    it("upload signature validation covers PDF, PNG, JPEG, ZIP, OLE", () => {
      const sigPath = path.join(ROOT, "lib/security/upload-signatures.ts");
      const content = fs.readFileSync(sigPath, "utf-8");
      expect(content).toContain("PDF_SIGNATURE");
      expect(content).toContain("PNG_SIGNATURE");
      expect(content).toContain("JPEG_SIGNATURE");
      expect(content).toContain("ZIP_SIGNATURES");
      expect(content).toContain("OLE_SIGNATURE");
    });

    it("upload rate limiting is configured", () => {
      const rateLimitPath = path.join(ROOT, "lib/security/rate-limit.ts");
      const content = fs.readFileSync(rateLimitPath, "utf-8");
      expect(content).toContain("/api/v1/documents/upload");
      expect(content).toContain("/api/v1/me/avatar");
    });
  });

  describe("CSRF protection", () => {
    it("CSRF validation checks origin and referer headers", () => {
      const csrfPath = path.join(ROOT, "lib/security/csrf.ts");
      const content = fs.readFileSync(csrfPath, "utf-8");
      expect(content).toContain("origin");
      expect(content).toContain("referer");
      expect(content).toContain("sameOrigin");
    });

    it("CSRF validation exempts webhook endpoint", () => {
      const csrfPath = path.join(ROOT, "lib/security/csrf.ts");
      const content = fs.readFileSync(csrfPath, "utf-8");
      expect(content).toContain("/api/v1/payments/webhook");
    });
  });

  describe("Durable rate limiting infrastructure", () => {
    it("rate limit migration exists", () => {
      const migrationsDir = path.join(ROOT, "supabase/migrations");
      const files = fs.readdirSync(migrationsDir);
      const rateLimitMigration = files.find((f) =>
        f.includes("rate_limit")
      );
      expect(rateLimitMigration).toBeDefined();
    });
  });

  describe("Cron endpoint authentication", () => {
    const cronDir = path.join(ROOT, "app/api/cron");

    it("all cron routes verify CRON_SECRET", () => {
      if (!fs.existsSync(cronDir)) return;

      const cronFolders = fs.readdirSync(cronDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);

      for (const folder of cronFolders) {
        const routePath = path.join(cronDir, folder, "route.ts");
        if (!fs.existsSync(routePath)) continue;

        const content = fs.readFileSync(routePath, "utf-8");
        expect(content).toContain("CRON_SECRET");
      }
    });
  });
});
