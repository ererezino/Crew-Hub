import { NextResponse } from "next/server";
import { createSupabaseServiceRoleClient } from "../../../../lib/supabase/service-role";
import { createBulkNotifications } from "../../../../lib/notifications/service";
import { formatDateRangeHuman } from "../../../../lib/datetime";
import { addIsoDays, formatLeaveTypeLabel } from "../../../../lib/time-off";

/**
 * Daily cron endpoint: creates start-of-leave announcements and pre-leave reminders.
 *
 * Triggered by Vercel Cron daily at 07:00 UTC (8am WAT).
 * Can also be called manually via POST for testing.
 *
 * Protected by CRON_SECRET header to prevent unauthorized access.
 */

function todayIso(): string {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

type LeaveRow = {
  id: string;
  org_id: string;
  employee_id: string;
  start_date: string;
  end_date: string;
  total_days: number | string;
  leave_type: string;
};

type ProfileRow = {
  id: string;
  full_name: string;
  roles: unknown;
  manager_id: string | null;
  team_lead_id: string | null;
  status: string | null;
};

function normalizeRoles(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((role): role is string => typeof role === "string")
    : [];
}

function isNotificationEligible(profile: ProfileRow): boolean {
  return profile.status === "active" || profile.status === null;
}

function getOperationalLeadId(profile: Pick<ProfileRow, "manager_id" | "team_lead_id">): string | null {
  return profile.team_lead_id ?? profile.manager_id ?? null;
}

function getTeamRecipientIds(employee: ProfileRow, orgProfiles: ProfileRow[]): string[] {
  const activeProfiles = orgProfiles.filter((profile) => isNotificationEligible(profile) && profile.id !== employee.id);
  const operationalLeadId = getOperationalLeadId(employee);

  if (operationalLeadId) {
    return activeProfiles
      .filter((profile) => profile.id === operationalLeadId || getOperationalLeadId(profile) === operationalLeadId)
      .map((profile) => profile.id);
  }

  const reportIds = activeProfiles
    .filter((profile) => getOperationalLeadId(profile) === employee.id)
    .map((profile) => profile.id);

  return reportIds;
}

/** @deprecated Use formatDateRangeHuman from lib/datetime instead. Kept as alias. */
function formatDateRange(startDate: string, endDate: string): string {
  return formatDateRangeHuman(startDate, endDate);
}

export async function GET(request: Request) {
  // Verify cron secret (Vercel sets this automatically for cron jobs)
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const today = todayIso();
  const twoDaysOut = addIsoDays(today, 2);
  const sevenDaysOut = addIsoDays(today, 7);
  const supabase = createSupabaseServiceRoleClient();

  // Find all approved leave requests we need to act on today:
  // - starting today for announcements
  // - starting in 2 days for team + super admin reminders
  // - starting in 7 days for super admin reminders
  const { data: candidateLeaves, error: leaveError } = await supabase
    .from("leave_requests")
    .select("id, org_id, employee_id, start_date, end_date, total_days, leave_type")
    .eq("status", "approved")
    .gte("start_date", today)
    .lte("start_date", sevenDaysOut)
    .is("deleted_at", null);

  if (leaveError) {
    console.error("Failed to fetch starting leaves:", leaveError.message);
    return NextResponse.json({ error: "Failed to fetch leave data" }, { status: 500 });
  }

  if (!candidateLeaves || candidateLeaves.length === 0) {
    return NextResponse.json({ message: "No leave reminders due today", date: today });
  }

  let announcementsCreated = 0;
  let remindersSent = 0;

  // Group leaves by org for efficient processing
  const leavesByOrg = new Map<string, LeaveRow[]>();
  for (const leave of candidateLeaves as LeaveRow[]) {
    const existing = leavesByOrg.get(leave.org_id) ?? [];
    existing.push(leave);
    leavesByOrg.set(leave.org_id, existing);
  }

  for (const [orgId, leaves] of leavesByOrg) {
    const { data: orgProfilesRaw } = await supabase
      .from("profiles")
      .select("id, full_name, roles, manager_id, team_lead_id, status")
      .eq("org_id", orgId)
      .is("deleted_at", null);

    const orgProfiles = (orgProfilesRaw ?? []) as ProfileRow[];
    const employeeMap = new Map(orgProfiles.map((profile) => [profile.id, profile]));
    const activeMemberIds = orgProfiles
      .filter((profile) => isNotificationEligible(profile))
      .map((profile) => profile.id);
    const superAdminIds = orgProfiles
      .filter((profile) => isNotificationEligible(profile) && normalizeRoles(profile.roles).includes("SUPER_ADMIN"))
      .map((profile) => profile.id);
    const creatorId = superAdminIds[0] ?? activeMemberIds[0];

    if (!creatorId) {
      continue;
    }

    for (const leave of leaves) {
      const employee = employeeMap.get(leave.employee_id);
      if (!employee) continue;

      const dateRange = formatDateRange(leave.start_date, leave.end_date);
      const leaveLabel = formatLeaveTypeLabel(leave.leave_type);
      const totalDays =
        typeof leave.total_days === "number"
          ? leave.total_days
          : Number.parseFloat(leave.total_days);
      const title = `${employee.full_name} is on ${leaveLabel.toLowerCase()}`;
      const body =
        leave.start_date === leave.end_date
          ? `${employee.full_name} is on ${leaveLabel.toLowerCase()} on ${dateRange}.`
          : `${employee.full_name} is on ${leaveLabel.toLowerCase()} from ${dateRange} (${totalDays} day${totalDays === 1 ? "" : "s"}).`;

      if (leave.start_date === sevenDaysOut) {
        const recipientIds = superAdminIds.filter((id) => id !== leave.employee_id);

        if (recipientIds.length === 0) {
          continue;
        }

        await createBulkNotifications({
          orgId,
          userIds: recipientIds,
          type: "leave_reminder",
          title: `${employee.full_name} starts ${leaveLabel.toLowerCase()} in one week`,
          body: `${employee.full_name} is scheduled to be away ${dateRange}.`,
          link: "/time-off",
          dedupeKey: `leave-reminder:7:${leave.id}`
        });

        remindersSent++;
      }

      if (leave.start_date === twoDaysOut) {
        const recipientIds = [
          ...superAdminIds,
          ...getTeamRecipientIds(employee, orgProfiles)
        ].filter((id) => id !== leave.employee_id);

        if (recipientIds.length === 0) {
          continue;
        }

        await createBulkNotifications({
          orgId,
          userIds: recipientIds,
          type: "leave_reminder",
          title: `${employee.full_name} starts ${leaveLabel.toLowerCase()} in two days`,
          body: `${employee.full_name} is scheduled to be away ${dateRange}.`,
          link: "/time-off",
          dedupeKey: `leave-reminder:2:${leave.id}`
        });

        remindersSent++;
      }

      if (leave.start_date !== today) {
        continue;
      }

      // Check if this announcement already exists (avoid duplicates on re-run)
      const { data: existing } = await supabase
        .from("announcements")
        .select("id")
        .eq("org_id", orgId)
        .eq("title", title)
        .gte("created_at", today + "T00:00:00Z")
        .is("deleted_at", null)
        .limit(1);

      if (existing && existing.length > 0) continue;

      // Create the announcement
      const { data: announcement, error: insertError } = await supabase
        .from("announcements")
        .insert({
          org_id: orgId,
          title,
          body,
          is_pinned: false,
          created_by: creatorId,
        })
        .select("id")
        .single();

      if (insertError || !announcement) {
        console.error(`Failed to create leave announcement for ${employee.full_name}:`, insertError?.message);
        continue;
      }

      // Mark as read for creator
      await supabase.from("announcement_reads").upsert(
        { announcement_id: announcement.id, user_id: creatorId, read_at: new Date().toISOString() },
        { onConflict: "announcement_id,user_id" }
      );

      // Notify all org members except the person on leave
      const recipientIds = activeMemberIds.filter((id) => id !== leave.employee_id);
      await createBulkNotifications({
        orgId,
        userIds: recipientIds,
        type: "announcement",
        title,
        body: body.slice(0, 220),
        link: "/time-off",
        dedupeKey: `leave-announcement:${announcement.id}`,
      });

      announcementsCreated++;
    }
  }

  return NextResponse.json({
    message: `Created ${announcementsCreated} leave announcement(s) and sent ${remindersSent} reminder batch(es)`,
    date: today,
    leavesStartingToday: candidateLeaves.filter((leave) => leave.start_date === today).length,
    leavesReminded: candidateLeaves.filter((leave) => leave.start_date === twoDaysOut || leave.start_date === sevenDaysOut).length,
  });
}
