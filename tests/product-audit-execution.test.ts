import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.resolve(__dirname, "..");

function read(relativePath: string): string {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

describe("Product audit execution hardening", () => {
  it("removes hardcoded NGN from analytics and expense reports UI", () => {
    const reportsClient = read("app/(shell)/expenses/reports/reports-client.tsx");
    const analyticsClient = read("app/(shell)/analytics/analytics-client.tsx");

    expect(reportsClient).not.toContain('currency="NGN"');
    expect(analyticsClient).not.toContain('currency="NGN"');
    expect(reportsClient).toContain("primaryCurrency");
    expect(analyticsClient).toContain("metrics.currency");
  });

  it("decision card exposes explicit error state and retry action", () => {
    const decisionCard = read("components/dashboard/decision-card.tsx");
    expect(decisionCard).toContain('"error"');
    expect(decisionCard).toContain('t("errorMessage")');
    expect(decisionCard).toContain('t("tryAgain")');
  });

  it("navigation keeps announcements label aligned with /announcements and non-conflicting shortcut", () => {
    const navigation = read("lib/navigation.ts");
    expect(navigation).toContain('label: "Announcements"');
    expect(navigation).toContain('href: "/announcements"');
    expect(navigation).toContain('shortcut: "G C"');
    expect(navigation).not.toContain('label: "Notifications"');
    expect(navigation).not.toContain('shortcut: "G A"');
  });

  it("notification center view-all points to announcements", () => {
    const notificationCenter = read("components/shared/notification-center.tsx");
    expect(notificationCenter).toContain('href="/announcements"');
    expect(notificationCenter).not.toContain('href="/notifications"');
  });

  it("team hub creation surfaces are no longer marked as coming soon", () => {
    const teamHub = read("app/(shell)/team-hub/team-hub-client.tsx");
    expect(teamHub).toContain("<FeatureBanner");
    expect(teamHub).toContain("description={t('featureBanner')}");
    expect(teamHub.toLowerCase()).not.toContain("content management features are coming soon");
  });

  it("team hub create flows expose inline API error feedback", () => {
    const hubClient = read("app/(shell)/team-hub/team-hub-client.tsx");
    const homeClient = read("app/(shell)/team-hub/[hubId]/hub-home-client.tsx");
    const sectionClient = read("app/(shell)/team-hub/[hubId]/[sectionId]/section-client.tsx");

    expect(hubClient).toContain("createError");
    expect(hubClient).toContain("form-field-error");
    expect(homeClient).toContain("addSectionError");
    expect(homeClient).toContain("form-field-error");
    expect(sectionClient).toContain("addPageError");
    expect(sectionClient).toContain("form-field-error");
  });
});
