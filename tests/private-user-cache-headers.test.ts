import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");

const PRIVATE_CACHE_ROUTES = [
  "app/api/v1/announcements/route.ts",
  "app/api/v1/approvals/counts/route.ts",
  "app/api/v1/dashboard/route.ts",
  "app/api/v1/expenses/route.ts",
  "app/api/v1/notifications/route.ts",
  "app/api/v1/people/route.ts",
  "app/api/v1/the-crew/route.ts"
] as const;

describe("Private user cache headers", () => {
  it("all browser-cacheable authenticated endpoints vary by Cookie", () => {
    for (const routePath of PRIVATE_CACHE_ROUTES) {
      const content = readFileSync(resolve(ROOT, routePath), "utf-8");

      expect(content).toContain("Cache-Control");
      expect(content).toContain('"Vary": "Cookie"');
    }
  });
});
