import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function read(relativePath: string) {
  return readFileSync(join(__dirname, "..", relativePath), "utf8");
}

describe("time-off policy guardrails", () => {
  it("keeps annual-leave notice and cross-year protections in the request route", () => {
    const source = read("app/api/v1/time-off/requests/route.ts");

    expect(source).toContain("CROSS_YEAR_REQUEST_NOT_SUPPORTED");
    expect(source).toContain("PAST_DATE_NOT_ALLOWED");
    expect(source).toContain("INSUFFICIENT_ADVANCE_NOTICE");
    expect(source).toContain("calculateBusinessDaysNotice");
  });

  it("keeps long AFKs on the personal-day accounting path", () => {
    const source = read("app/api/v1/time-off/afk/route.ts");

    expect(source).toContain("!shouldReclassifyAsPersonalDay && (weeklyCount ?? 0) >= AFK_WEEKLY_LIMIT");
    expect(source).toContain("applyPendingBalanceDelta");
    expect(source).toContain("AFKs longer than 2 hours must be recorded as a personal day");
  });

  it("loads org-wide leave policies for activation and balance backfill", () => {
    const activationSource = read("lib/onboarding/auto-transition.ts");
    const backfillSource = read("scripts/backfill-leave-balances.ts");

    expect(activationSource).toContain('.is("country_code", null)');
    expect(backfillSource).toContain('.is("country_code", null)');
  });

  it("sends pre-leave reminders for super admins and teams", () => {
    const source = read("app/api/cron/leave-announcements/route.ts");

    expect(source).toContain('type: "leave_reminder"');
    expect(source).toContain("leave-reminder:7:");
    expect(source).toContain("leave-reminder:2:");
    expect(source).toContain("getTeamRecipientIds");
  });

  it("attributes cron-created announcements to Operations via source='system'", () => {
    const leaveCron = read("app/api/cron/leave-announcements/route.ts");
    const holidayCron = read("app/api/cron/holiday-announcements/route.ts");
    const birthdayCron = read("app/api/cron/birthday-leave/route.ts");
    const announcementsApi = read("app/api/v1/announcements/route.ts");

    expect(leaveCron).toContain('source: "system"');
    expect(holidayCron).toContain('source: "system"');
    expect(birthdayCron).toContain('source: "system"');
    expect(announcementsApi).toContain('SYSTEM_AUTHOR_NAME = "Operations"');
    expect(announcementsApi).toContain('row.source === "system"');
  });
});
