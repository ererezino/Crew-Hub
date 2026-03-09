import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.resolve(__dirname, "..");

describe("Phase 3 — Product Truthfulness and Launch-Scope Honesty", () => {
  describe("Feature state registry", () => {
    it("payroll_disbursement is UNAVAILABLE", () => {
      const content = fs.readFileSync(
        path.join(ROOT, "lib/feature-state.ts"),
        "utf-8"
      );
      expect(content).toContain('payroll_disbursement: "UNAVAILABLE"');
    });

    it("multi-country payroll engines are COMING_SOON", () => {
      const content = fs.readFileSync(
        path.join(ROOT, "lib/feature-state.ts"),
        "utf-8"
      );
      expect(content).toContain('payroll_withholding_gh: "COMING_SOON"');
      expect(content).toContain('payroll_withholding_ke: "COMING_SOON"');
      expect(content).toContain('payroll_withholding_za: "COMING_SOON"');
      expect(content).toContain('payroll_withholding_ca: "COMING_SOON"');
    });

    it("UNAVAILABLE modules have actions disabled", () => {
      const content = fs.readFileSync(
        path.join(ROOT, "lib/feature-state.ts"),
        "utf-8"
      );
      // UNAVAILABLE state should have actionsDisabled: true
      expect(content).toMatch(/UNAVAILABLE:\s*\{[^}]*actionsDisabled:\s*true/);
    });
  });

  describe("Feature gate components exist", () => {
    it("FeatureGate component exists", () => {
      expect(
        fs.existsSync(path.join(ROOT, "components/shared/feature-gate.tsx"))
      ).toBe(true);
    });

    it("FeatureBanner component exists", () => {
      expect(
        fs.existsSync(path.join(ROOT, "components/shared/feature-banner.tsx"))
      ).toBe(true);
    });

    it("FeatureBadge component exists", () => {
      expect(
        fs.existsSync(path.join(ROOT, "components/shared/feature-badge.tsx"))
      ).toBe(true);
    });
  });

  describe("Limited pilot pages show banners", () => {
    const pilotPages = [
      "app/(shell)/payroll/payroll-dashboard-client.tsx",
      "app/(shell)/performance/performance-client.tsx",
      "app/(shell)/scheduling/scheduling-tabs-client.tsx",
      "app/(shell)/team-hub/team-hub-client.tsx"
    ];

    for (const pagePath of pilotPages) {
      it(`${pagePath} uses FeatureBanner`, () => {
        const fullPath = path.join(ROOT, pagePath);
        if (!fs.existsSync(fullPath)) return;
        const content = fs.readFileSync(fullPath, "utf-8");
        expect(content).toContain("FeatureBanner");
      });
    }
  });

  describe("Unavailable pages show banners", () => {
    const unavailablePages = [
      "app/(shell)/learning/learning-tabs-client.tsx",
      "app/(shell)/signatures/signatures-client.tsx",
      "app/(shell)/surveys/surveys-client.tsx"
    ];

    for (const pagePath of unavailablePages) {
      it(`${pagePath} uses FeatureBanner`, () => {
        const fullPath = path.join(ROOT, pagePath);
        if (!fs.existsSync(fullPath)) return;
        const content = fs.readFileSync(fullPath, "utf-8");
        expect(content).toContain("FeatureBanner");
      });
    }
  });

  describe("Support/report issue path", () => {
    it("SupportLink component exists", () => {
      expect(
        fs.existsSync(path.join(ROOT, "components/shared/support-link.tsx"))
      ).toBe(true);
    });

    it("SupportLink is integrated into the app shell", () => {
      const shellPath = path.join(ROOT, "components/shared/app-shell.tsx");
      const content = fs.readFileSync(shellPath, "utf-8");
      expect(content).toContain("SupportLink");
    });

    it("Support page includes Basecamp contact", () => {
      const supportPath = path.join(
        ROOT,
        "app/(shell)/support/page.tsx"
      );
      const content = fs.readFileSync(supportPath, "utf-8");
      expect(content).toContain("Basecamp");
    });

    it("Support page links to privacy policy", () => {
      const supportPath = path.join(
        ROOT,
        "app/(shell)/support/page.tsx"
      );
      const content = fs.readFileSync(supportPath, "utf-8");
      expect(content).toContain("/privacy");
    });
  });

  describe("Payroll disbursement is honest", () => {
    it("payroll detail page mentions disbursement is disabled", () => {
      const detailPath = path.join(
        ROOT,
        "app/(shell)/payroll/runs/[id]/payroll-run-detail-client.tsx"
      );
      if (!fs.existsSync(detailPath)) return;
      const content = fs.readFileSync(detailPath, "utf-8");
      expect(content).toContain("Disbursement execution is disabled");
    });
  });
});
