import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ZOD_AUDIT_WAIVERS: Record<string, string> = {
  "payments/[id]/retry/route.ts": "Intentionally disabled payment stub endpoint.",
  "payments/batch/route.ts": "Intentionally disabled payment stub endpoint.",
  "payments/webhook/route.ts": "Intentionally disabled payment stub endpoint.",
  "me/data-export/route.ts": "GET-only endpoint with no user input — reads authenticated user data.",
  "the-crew/route.ts": "GET-only endpoint with no user input — returns visible crew members for the authenticated org.",
  "delegations/route.ts": "Zod validation via createDelegationSchema imported from _helpers.ts."
};

function collectRouteFiles(directory: string): string[] {
  const entries = readdirSync(directory);
  const files: string[] = [];

  for (const entry of entries) {
    const absolutePath = path.join(directory, entry);
    const stats = statSync(absolutePath);

    if (stats.isDirectory()) {
      files.push(...collectRouteFiles(absolutePath));
      continue;
    }

    if (entry === "route.ts") {
      files.push(absolutePath);
    }
  }

  return files;
}

describe("API endpoint validation audit", () => {
  it("ensures every /api/v1 route imports zod", () => {
    const apiRoot = path.resolve(process.cwd(), "app/api/v1");
    const routeFiles = collectRouteFiles(apiRoot);

    expect(routeFiles.length).toBeGreaterThan(0);

    const missingZodImport = routeFiles.filter((file) => {
      const source = readFileSync(file, "utf8");
      if (source.includes('from "zod"') || source.includes("from 'zod'")) {
        return false;
      }

      const relativePath = path.relative(apiRoot, file).split(path.sep).join("/");
      return !(relativePath in ZOD_AUDIT_WAIVERS);
    });

    expect(missingZodImport).toEqual([]);

    const invalidWaivers = Object.keys(ZOD_AUDIT_WAIVERS).filter((relativePath) => {
      const fullPath = path.join(apiRoot, relativePath);
      return !routeFiles.includes(fullPath);
    });

    expect(invalidWaivers).toEqual([]);
  });
});
