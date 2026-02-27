import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

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
      return !(source.includes('from "zod"') || source.includes("from 'zod'"));
    });

    expect(missingZodImport).toEqual([]);
  });
});
