import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = path.join(__dirname, "..");
const MAP_PATH = path.join(ROOT, "lib", "i18n", "route-namespaces.generated.json");
const SHELL_DIR = path.join(ROOT, "app", "(shell)");

describe("i18n route-namespace map", () => {
  it("is current — regenerating produces no diff (run scripts/generate-route-namespaces.cjs after changing translations usage)", () => {
    expect(() =>
      execFileSync("node", [path.join(ROOT, "scripts", "generate-route-namespaces.cjs"), "--check"], {
        stdio: "pipe"
      })
    ).not.toThrow();
  });

  it("covers every (shell) area directory with an AreaMessages layout", () => {
    const map = JSON.parse(readFileSync(MAP_PATH, "utf8"));
    const areaDirs = readdirSync(SHELL_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    expect(Object.keys(map.areas).sort()).toEqual(areaDirs);

    for (const area of areaDirs) {
      const layoutPath = path.join(SHELL_DIR, area, "layout.tsx");
      expect(existsSync(layoutPath), `${area} is missing layout.tsx`).toBe(true);
      const src = readFileSync(layoutPath, "utf8");
      expect(src, `${area}/layout.tsx must use AreaMessages with its own area name`).toContain(
        `<AreaMessages area="${area}">`
      );
    }
  });

  it("references only namespaces that exist in both locale files", () => {
    const map = JSON.parse(readFileSync(MAP_PATH, "utf8"));
    const en = JSON.parse(readFileSync(path.join(ROOT, "messages", "en.json"), "utf8"));
    const fr = JSON.parse(readFileSync(path.join(ROOT, "messages", "fr.json"), "utf8"));

    const allNamespaces = new Set<string>([
      ...map.shell,
      ...Object.values(map.areas as Record<string, string[]>).flat()
    ]);

    for (const ns of allNamespaces) {
      expect(en[ns], `namespace "${ns}" missing from en.json`).toBeDefined();
      expect(fr[ns], `namespace "${ns}" missing from fr.json`).toBeDefined();
    }
  });
});
