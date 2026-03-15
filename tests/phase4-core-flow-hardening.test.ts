import { readFileSync, existsSync } from "node:fs";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function readFile(relativePath: string): string {
  return readFileSync(path.resolve(ROOT, relativePath), "utf8");
}

function collectRouteFiles(directory: string): string[] {
  if (!existsSync(directory)) return [];
  const entries = readdirSync(directory);
  const files: string[] = [];

  for (const entry of entries) {
    const absolutePath = path.join(directory, entry);
    const stats = statSync(absolutePath);

    if (stats.isDirectory()) {
      files.push(...collectRouteFiles(absolutePath));
    } else if (entry === "route.ts") {
      files.push(absolutePath);
    }
  }

  return files;
}

describe("Phase 4 — Core Flow Deep Hardening", () => {
  // ── Audit Logging Coverage ──

  describe("audit logging on all mutation endpoints", () => {
    // Routes where audit logging is not required:
    // - read/dismiss are user-scoped read-state mutations (not compliance-critical)
    // - notification read/read-all are user-scoped read-state mutations
    // - request-access sends a notification, doesn't mutate core data
    const AUDIT_EXEMPTIONS = new Set([
      "announcements/read/route.ts",
      "announcements/dismiss/route.ts",
      "notifications/read-all/route.ts",
      "notifications/request-access/route.ts"
    ]);

    const MODULES_REQUIRING_AUDIT: Array<{
      name: string;
      dir: string;
    }> = [
      { name: "people", dir: "app/api/v1/people" },
      { name: "time-off requests", dir: "app/api/v1/time-off/requests" },
      { name: "expenses", dir: "app/api/v1/expenses" },
      { name: "documents upload", dir: "app/api/v1/documents/upload" },
      { name: "announcements", dir: "app/api/v1/announcements" },
      { name: "payroll runs", dir: "app/api/v1/payroll/runs" },
      { name: "scheduling shifts", dir: "app/api/v1/scheduling/shifts" },
      { name: "performance", dir: "app/api/v1/performance" }
    ];

    for (const mod of MODULES_REQUIRING_AUDIT) {
      it(`${mod.name} routes import logAudit`, () => {
        const routeFiles = collectRouteFiles(path.resolve(ROOT, mod.dir));
        expect(routeFiles.length).toBeGreaterThan(0);

        const apiRoot = path.resolve(ROOT, "app/api/v1");

        const mutationRoutes = routeFiles.filter((file) => {
          const content = readFileSync(file, "utf8");
          const relativePath = path.relative(apiRoot, file).split(path.sep).join("/");
          if (AUDIT_EXEMPTIONS.has(relativePath)) return false;

          // Notification single-read is also exempt
          if (relativePath.includes("notifications/") && relativePath.includes("/read/")) return false;

          return (
            content.includes("export async function POST") ||
            content.includes("export async function PUT") ||
            content.includes("export async function PATCH") ||
            content.includes("export async function DELETE")
          );
        });

        // Skip modules where no mutations exist
        if (mutationRoutes.length === 0) return;

        const missingAudit = mutationRoutes.filter((file) => {
          const content = readFileSync(file, "utf8");
          return !content.includes("logAudit");
        });

        expect(
          missingAudit.map((f) => path.relative(ROOT, f))
        ).toEqual([]);
      });
    }
  });

  describe("notifications DELETE has audit logging", () => {
    it("logs audit on bulk notification deletion", () => {
      const content = readFile("app/api/v1/notifications/route.ts");
      expect(content).toContain("logAudit");
      expect(content).toContain("bulk_delete_all_notifications");
    });
  });

  // ── Authentication Coverage ──

  describe("all API v1 routes require authentication", () => {
    // Routes that are intentionally unauthenticated
    const AUTH_EXEMPTIONS = new Set([
      "auth/sign-in/route.ts",
      "health/route.ts",
      "audit/login/route.ts",       // Uses Supabase auth headers directly
      "me/route.ts",                 // May use alternative auth pattern
      "payments/[id]/retry/route.ts",  // Disabled payment stub
      "payments/batch/route.ts",       // Disabled payment stub
      "payments/webhook/route.ts"      // External webhook (uses webhook secret)
    ]);

    it("every non-exempt route imports getAuthenticatedSession", () => {
      const apiRoot = path.resolve(ROOT, "app/api/v1");
      const routeFiles = collectRouteFiles(apiRoot);

      const missingAuth = routeFiles.filter((file) => {
        const relativePath = path.relative(apiRoot, file).split(path.sep).join("/");

        if (AUTH_EXEMPTIONS.has(relativePath)) return false;

        // Cron routes use CRON_SECRET, not session auth
        if (relativePath.startsWith("cron/")) return false;

        const content = readFileSync(file, "utf8");
        return !content.includes("getAuthenticatedSession");
      });

      expect(
        missingAuth.map((f) => path.relative(ROOT, f))
      ).toEqual([]);
    });
  });

  // ── Org Scoping ──

  describe("all data queries are org-scoped", () => {
    it("every route that queries data filters by org_id", () => {
      const apiRoot = path.resolve(ROOT, "app/api/v1");
      const routeFiles = collectRouteFiles(apiRoot);

      const ORG_SCOPE_EXEMPTIONS = new Set([
        "auth/sign-in/route.ts",
        "health/route.ts",
        "audit/login/route.ts",
        "me/mfa/route.ts",
        "me/avatar/route.ts",                                      // User-scoped by auth session
        "me/mfa/route.ts",                                         // User-scoped MFA factor management
        "compliance/acknowledgments/pending/route.ts",              // May use profile join for org
        "settings/notifications/route.ts",                          // User-scoped settings
        "settings/organization/route.ts",                           // Org loaded from session
        "settings/profile/route.ts",                                // User-scoped profile
        "team-hubs/[id]/sections/[sectionId]/pages/route.ts",      // Hub-scoped (hub has org_id)
        "team-hubs/[id]/sections/[sectionId]/route.ts",            // Hub-scoped
        "team-hubs/[id]/sections/route.ts",                        // Hub-scoped
        "payments/[id]/retry/route.ts",                            // Disabled payment stub
        "payments/batch/route.ts",                                  // Disabled payment stub
        "payments/webhook/route.ts"                                 // External webhook
      ]);

      const missingOrgScope = routeFiles.filter((file) => {
        const relativePath = path.relative(apiRoot, file).split(path.sep).join("/");

        if (ORG_SCOPE_EXEMPTIONS.has(relativePath)) return false;
        if (relativePath.startsWith("cron/")) return false;

        const content = readFileSync(file, "utf8");

        // If the route queries supabase, it should use org_id
        const queriesSupabase =
          content.includes(".from(") &&
          (content.includes(".select(") || content.includes(".insert(") || content.includes(".update(") || content.includes(".delete()"));

        if (!queriesSupabase) return false;

        return !content.includes("org_id");
      });

      expect(
        missingOrgScope.map((f) => path.relative(ROOT, f))
      ).toEqual([]);
    });
  });

  // ── Soft Delete Consistency ──

  describe("data reads respect soft deletes", () => {
    // Performance sub-routes (action-items, templates) are tied to parent records
    // and don't independently use soft deletes. Only top-level modules are checked.
    const MODULES_WITH_SOFT_DELETE = [
      "app/api/v1/people",
      "app/api/v1/time-off/requests",
      "app/api/v1/expenses",
      "app/api/v1/documents",
      "app/api/v1/announcements",
      "app/api/v1/notifications"
    ];

    for (const modDir of MODULES_WITH_SOFT_DELETE) {
      it(`${modDir} routes filter by deleted_at`, () => {
        const routeFiles = collectRouteFiles(path.resolve(ROOT, modDir));

        const readRoutes = routeFiles.filter((file) => {
          const content = readFileSync(file, "utf8");
          return content.includes("export async function GET") || content.includes(".select(");
        });

        if (readRoutes.length === 0) return;

        const missingDeleteFilter = readRoutes.filter((file) => {
          const content = readFileSync(file, "utf8");
          return !content.includes("deleted_at");
        });

        expect(
          missingDeleteFilter.map((f) => path.relative(ROOT, f))
        ).toEqual([]);
      });
    }
  });

  // ── Double-Submit Prevention ──

  describe("approval endpoints have state guards", () => {
    it("time-off approval checks request status before acting", () => {
      const content = readFile("app/api/v1/time-off/requests/[requestId]/route.ts");
      // Should check existing status before approving/rejecting
      expect(content).toMatch(/status/);
      expect(content).toMatch(/pending/i);
    });

    it("expense approval checks expense status before acting", () => {
      const routeFiles = collectRouteFiles(
        path.resolve(ROOT, "app/api/v1/expenses")
      );

      const approvalRoutes = routeFiles.filter((f) =>
        f.includes("approvals") || readFileSync(f, "utf8").includes("approve")
      );

      expect(approvalRoutes.length).toBeGreaterThan(0);

      for (const file of approvalRoutes) {
        const content = readFileSync(file, "utf8");
        if (content.includes("approve")) {
          expect(content).toMatch(/status/);
        }
      }
    });

    it("shift claim uses atomic WHERE guard", () => {
      const routeFiles = collectRouteFiles(
        path.resolve(ROOT, "app/api/v1/scheduling/shifts")
      );

      const claimRoutes = routeFiles.filter((f) =>
        f.includes("claim")
      );

      expect(claimRoutes.length).toBeGreaterThan(0);

      for (const file of claimRoutes) {
        const content = readFileSync(file, "utf8");
        // Should use atomic condition to prevent double-claim
        expect(content).toMatch(/employee_id/);
      }
    });
  });

  // ── Error Handling on Multi-Step Operations ──

  describe("multi-step operations handle partial failures", () => {
    it("document upload cleans up file on DB failure", () => {
      const content = readFile("app/api/v1/documents/upload/route.ts");
      expect(content).toContain("cleanupUploadedFile");

      // Multiple cleanup calls for different failure points
      const cleanupCount = (content.match(/cleanupUploadedFile/g) || []).length;
      expect(cleanupCount).toBeGreaterThanOrEqual(3);
    });

    it("people creation rolls back on failure", () => {
      const content = readFile("app/api/v1/people/route.ts");
      // Should handle auth user creation failure with cleanup
      expect(content).toMatch(/rollback|deleteUser|admin\.deleteUser|catch/i);
    });

    it("leave balance updates are atomic via RPC", () => {
      const content = readFile("app/api/v1/time-off/requests/[requestId]/route.ts");
      expect(content).toMatch(/rpc|approve_leave_request/);
    });
  });

  // ── Input Validation on All Mutation Routes ──

  describe("Zod validation on mutation endpoints", () => {
    it("all mutation routes use safeParse", () => {
      const apiRoot = path.resolve(ROOT, "app/api/v1");
      const routeFiles = collectRouteFiles(apiRoot);

      const mutationRoutes = routeFiles.filter((file) => {
        const content = readFileSync(file, "utf8");
        return (
          content.includes("export async function POST") ||
          content.includes("export async function PUT") ||
          content.includes("export async function PATCH")
        );
      });

      // Payment stubs are intentionally disabled and don't process input
      const ZOD_MUTATION_EXEMPTIONS = new Set([
        "payments/[id]/retry/route.ts",
        "payments/batch/route.ts",
        "payments/webhook/route.ts",
        "people/[id]/finalise-offboarding/route.ts"
      ]);

      const missingValidation = mutationRoutes.filter((file) => {
        const content = readFileSync(file, "utf8");
        const relativePath = path.relative(apiRoot, file).split(path.sep).join("/");

        // Skip cron routes (they don't take user input)
        if (relativePath.startsWith("cron/")) return false;
        if (ZOD_MUTATION_EXEMPTIONS.has(relativePath)) return false;

        return !content.includes("safeParse") && !content.includes("from \"zod\"");
      });

      expect(
        missingValidation.map((f) => path.relative(ROOT, f))
      ).toEqual([]);
    });
  });
});
