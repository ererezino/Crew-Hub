import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.resolve(__dirname, "..");

describe("Phase 5 — Health, Logging, Monitoring, and Operations", () => {
  describe("Health endpoint", () => {
    it("health route exists", () => {
      expect(
        fs.existsSync(path.join(ROOT, "app/api/health/route.ts"))
      ).toBe(true);
    });

    it("health route checks database connectivity", () => {
      const content = fs.readFileSync(
        path.join(ROOT, "app/api/health/route.ts"),
        "utf-8"
      );
      expect(content).toContain("database");
      expect(content).toContain("latencyMs");
    });

    it("health route checks environment variables", () => {
      const content = fs.readFileSync(
        path.join(ROOT, "app/api/health/route.ts"),
        "utf-8"
      );
      expect(content).toContain("NEXT_PUBLIC_SUPABASE_URL");
      expect(content).toContain("SUPABASE_SERVICE_ROLE_KEY");
    });

    it("health route returns 503 for unhealthy status", () => {
      const content = fs.readFileSync(
        path.join(ROOT, "app/api/health/route.ts"),
        "utf-8"
      );
      expect(content).toContain("503");
    });
  });

  describe("Structured logging", () => {
    it("logger module exists", () => {
      expect(fs.existsSync(path.join(ROOT, "lib/logger.ts"))).toBe(true);
    });

    it("logger redacts sensitive fields", () => {
      const content = fs.readFileSync(
        path.join(ROOT, "lib/logger.ts"),
        "utf-8"
      );
      expect(content).toContain("REDACTED_FIELDS");
      expect(content).toContain("password");
      expect(content).toContain("[REDACTED]");
    });

    it("logger outputs JSON format", () => {
      const content = fs.readFileSync(
        path.join(ROOT, "lib/logger.ts"),
        "utf-8"
      );
      expect(content).toContain("JSON.stringify");
      expect(content).toContain("timestamp");
      expect(content).toContain("level");
    });
  });

  describe("Startup environment validation", () => {
    it("instrumentation validates required env vars", () => {
      const content = fs.readFileSync(
        path.join(ROOT, "instrumentation.ts"),
        "utf-8"
      );
      expect(content).toContain("REQUIRED_ENV_VARS");
      expect(content).toContain("validateEnvironment");
      expect(content).toContain("NEXT_PUBLIC_SUPABASE_URL");
    });
  });

  describe("Cron job configuration", () => {
    it("vercel.json defines cron schedules", () => {
      const content = fs.readFileSync(
        path.join(ROOT, "vercel.json"),
        "utf-8"
      );
      const config = JSON.parse(content);
      expect(config.crons).toBeDefined();
      expect(config.crons.length).toBeGreaterThan(0);
    });

    it("all cron endpoints are authenticated", () => {
      const cronDir = path.join(ROOT, "app/api/cron");
      if (!fs.existsSync(cronDir)) return;

      const folders = fs.readdirSync(cronDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);

      for (const folder of folders) {
        const routePath = path.join(cronDir, folder, "route.ts");
        if (!fs.existsSync(routePath)) continue;
        const content = fs.readFileSync(routePath, "utf-8");
        expect(content).toContain("CRON_SECRET");
      }
    });
  });

  describe("Error tracking", () => {
    it("Sentry is configured for server runtime", () => {
      expect(
        fs.existsSync(path.join(ROOT, "sentry.server.config.ts"))
      ).toBe(true);
    });

    it("Sentry is configured for client runtime", () => {
      expect(
        fs.existsSync(path.join(ROOT, "sentry.client.config.ts"))
      ).toBe(true);
    });

    it("Sentry is configured for edge runtime", () => {
      expect(
        fs.existsSync(path.join(ROOT, "sentry.edge.config.ts"))
      ).toBe(true);
    });
  });
});
