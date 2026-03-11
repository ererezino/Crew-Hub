import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function read(relativePath: string): string {
  return readFileSync(path.resolve(ROOT, relativePath), "utf8");
}

describe("Scheduling runtime hardening", () => {
  it("delete route only blocks locked schedules (published remains deletable)", () => {
    const route = read("app/api/v1/scheduling/schedules/[id]/route.ts");

    expect(route).toContain('if (schedule.status === "locked")');
    expect(route).toContain('message: "Locked schedules cannot be removed."');
    expect(route).not.toContain('schedule.status === "published"');
  });

  it("team calendar exposes shift selection for edit flow", () => {
    const component = read("components/scheduling/team-schedule-calendar.tsx");

    expect(component).toContain("onShiftSelect?: (shift: ShiftRecord) => void");
    expect(component).toContain("onClick={() => {");
    expect(component).toContain("onShiftSelect(shift)");
    expect(component).toContain('role={isSelectable ? "button" : undefined}');
  });

  it("calendar client persists reassignment/date/time edits through shift API", () => {
    const client = read("app/(shell)/scheduling/calendar/scheduling-calendar-client.tsx");

    expect(client).toContain("ShiftEditModal");
    expect(client).toContain("setEditingShift");
    expect(client).toContain("employeeId: values.employeeId");
    expect(client).toContain("shiftDate: values.shiftDate");
    expect(client).toContain("startTime: values.startTime");
    expect(client).toContain("endTime: values.endTime");
  });

  it("draft schedules keep edit entry point on card action", () => {
    const card = read("components/scheduling/schedule-card.tsx");

    expect(card).toContain('schedule.status === "draft" ? tc("edit") : t("card.viewShifts")');
  });

  it("manage and team calendar do not hide server-returned schedules with client-side department filtering", () => {
    const manageClient = read("app/(shell)/scheduling/manage/scheduling-manage-client.tsx");
    const calendarClient = read("app/(shell)/scheduling/calendar/scheduling-calendar-client.tsx");
    const tabsClient = read("app/(shell)/scheduling/scheduling-tabs-client.tsx");

    expect(manageClient).toContain("const schedules = useMemo(() => schedulesData?.schedules ?? [], [schedulesData]);");
    expect(manageClient).not.toContain("viewerDepartment");
    expect(calendarClient).toContain("const visibleSchedules = schedules;");
    expect(calendarClient).not.toContain("viewerDepartment");
    expect(tabsClient).toContain("<SchedulingManageClient");
    expect(tabsClient).toContain("userRoles={userRoles}");
    expect(tabsClient).toContain("userDepartment={userDepartment}");
    expect(tabsClient).not.toContain("viewerDepartment={userDepartment ?? null}");
  });
});
