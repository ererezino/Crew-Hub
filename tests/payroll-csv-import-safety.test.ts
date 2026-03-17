import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..");

function readSource(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

describe("Payroll CSV import safety protections", () => {
  const importRouteSource = readSource(
    "app/api/v1/payroll/runs/[id]/import-csv/route.ts"
  );
  const actionsRouteSource = readSource(
    "app/api/v1/payroll/runs/[id]/actions/route.ts"
  );
  const dialogSource = readSource(
    "components/payroll/csv-import-dialog.tsx"
  );

  describe("CSV import resets run to draft after commit", () => {
    it("updates run status to 'draft' after upserting payroll items", () => {
      // The import route must reset the run to draft so that imported items
      // (which have withholding_applied: false) force a recalculation before
      // the run can be submitted.
      expect(importRouteSource).toContain('status: "draft"');
    });

    it("sets withholding_applied to false on imported items", () => {
      // Imported items must not be treated as calculated — withholding_applied
      // must be false so the Calculate step is required before submission.
      expect(importRouteSource).toContain("withholding_applied: false");
    });

    it("flags imported items for review", () => {
      expect(importRouteSource).toContain("flagged: true");
      expect(importRouteSource).toContain("Imported from CSV");
    });
  });

  describe("Conflict blocking on commit", () => {
    it("contains the CONFLICTS_REQUIRE_OVERWRITE error code", () => {
      expect(importRouteSource).toContain("CONFLICTS_REQUIRE_OVERWRITE");
    });

    it("checks for the allowOverwrite query parameter", () => {
      expect(importRouteSource).toContain('url.searchParams.get("overwrite")');
      expect(importRouteSource).toContain("allowOverwrite");
    });

    it("blocks commit when conflicts exist and overwrite is not set", () => {
      // The guard must check both conditions: conflicts present AND overwrite
      // not explicitly confirmed.
      expect(importRouteSource).toContain("conflictsExist && !allowOverwrite");
    });
  });

  describe("Submit blocks uncalculated items", () => {
    it("queries for items with withholding_applied = false before submit", () => {
      expect(actionsRouteSource).toContain("withholding_applied");
      expect(actionsRouteSource).toContain("uncalcCount");
    });

    it("returns INVALID_STATE when uncalculated items exist", () => {
      // The actions route must prevent submission if any payroll items have
      // not had withholding rules applied.
      expect(actionsRouteSource).toContain(
        "Some payroll items have not had withholding rules applied"
      );
    });

    it("only performs the uncalculated check during submit action", () => {
      // The uncalcCount check must be scoped inside the submit action block,
      // not applied globally to all actions.
      const submitBlockStart = actionsRouteSource.indexOf('action === "submit"');
      const uncalcCheckPos = actionsRouteSource.indexOf("uncalcCount");

      expect(submitBlockStart).toBeGreaterThan(-1);
      expect(uncalcCheckPos).toBeGreaterThan(-1);
      expect(uncalcCheckPos).toBeGreaterThan(submitBlockStart);
    });
  });

  describe("CSV import dialog blocks commit when conflicts exist without overwrite", () => {
    it("tracks overwrite confirmation state", () => {
      expect(dialogSource).toContain("overwriteConfirmed");
      expect(dialogSource).toContain("setOverwriteConfirmed");
    });

    it("disables commit button when hasConflicts && !overwriteConfirmed", () => {
      expect(dialogSource).toContain("hasConflicts && !overwriteConfirmed");
    });

    it("sends overwrite=true only when conflicts exist and user confirmed", () => {
      // The dialog must only attach the overwrite param when both conditions
      // are met: conflicts detected AND the user checked the confirmation box.
      expect(dialogSource).toContain("hasConflicts && overwriteConfirmed");
      expect(dialogSource).toContain('"overwrite", "true"');
    });

    it("resets overwrite confirmation when dialog closes", () => {
      expect(dialogSource).toContain("setOverwriteConfirmed(false)");
    });
  });
});
