import { NextResponse } from "next/server";
import { createSupabaseServiceRoleClient } from "../../../../lib/supabase/service-role";
import { createBulkNotifications } from "../../../../lib/notifications/service";
import { formatDateRangeHuman } from "../../../../lib/datetime";
import { formatLeaveTypeLabel } from "../../../../lib/time-off";

/**
 * Daily cron endpoint: creates announcements when someone's leave starts.
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
  const supabase = createSupabaseServiceRoleClient();

  // Find all approved leave requests starting today across all orgs
  const { data: startingLeaves, error: leaveError } = await supabase
    .from("leave_requests")
    .select("id, org_id, employee_id, start_date, end_date, total_days, leave_type")
    .eq("status", "approved")
    .eq("start_date", today)
    .is("deleted_at", null);

  if (leaveError) {
    console.error("Failed to fetch starting leaves:", leaveError.message);
    return NextResponse.json({ error: "Failed to fetch leave data" }, { status: 500 });
  }

  if (!startingLeaves || startingLeaves.length === 0) {
    return NextResponse.json({ message: "No leaves starting today", date: today });
  }

  // Get employee names for the announcements
  const employeeIds = [...new Set(startingLeaves.map((l) => l.employee_id))];
  const { data: employees } = await supabase
    .from("profiles")
    .select("id, full_name, org_id")
    .in("id", employeeIds)
    .is("deleted_at", null);

  const employeeMap = new Map(
    (employees ?? []).map((e) => [e.id, { name: e.full_name, orgId: e.org_id }])
  );

  let announcementsCreated = 0;

  // Group leaves by org for efficient processing
  const leavesByOrg = new Map<string, typeof startingLeaves>();
  for (const leave of startingLeaves) {
    const existing = leavesByOrg.get(leave.org_id) ?? [];
    existing.push(leave);
    leavesByOrg.set(leave.org_id, existing);
  }

  for (const [orgId, leaves] of leavesByOrg) {
    // Get all org members for notifications
    const { data: orgMembers } = await supabase
      .from("profiles")
      .select("id")
      .eq("org_id", orgId)
      .is("deleted_at", null);

    const memberIds = (orgMembers ?? []).map((m) => m.id);

    // Find a super admin to use as announcement creator
    const { data: adminRows } = await supabase
      .from("profiles")
      .select("id")
      .eq("org_id", orgId)
      .contains("roles", ["SUPER_ADMIN"])
      .is("deleted_at", null)
      .limit(1);

    const creatorId = adminRows?.[0]?.id ?? memberIds[0];
    if (!creatorId) continue;

    for (const leave of leaves) {
      const employee = employeeMap.get(leave.employee_id);
      if (!employee) continue;

      const dateRange = formatDateRange(leave.start_date, leave.end_date);
      const leaveLabel = formatLeaveTypeLabel(leave.leave_type);
      const title = `${employee.name} is on ${leaveLabel.toLowerCase()}`;
      const body =
        leave.start_date === leave.end_date
          ? `${employee.name} is on ${leaveLabel.toLowerCase()} on ${dateRange}.`
          : `${employee.name} is on ${leaveLabel.toLowerCase()} from ${dateRange} (${leave.total_days} day${leave.total_days === 1 ? "" : "s"}).`;

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
        console.error(`Failed to create leave announcement for ${employee.name}:`, insertError?.message);
        continue;
      }

      // Mark as read for creator
      await supabase.from("announcement_reads").upsert(
        { announcement_id: announcement.id, user_id: creatorId, read_at: new Date().toISOString() },
        { onConflict: "announcement_id,user_id" }
      );

      // Notify all org members except the person on leave
      const recipientIds = memberIds.filter((id) => id !== leave.employee_id);
      await createBulkNotifications({
        orgId,
        userIds: recipientIds,
        type: "announcement",
        title,
        body: body.slice(0, 220),
        link: "/time-off",
      });

      announcementsCreated++;
    }
  }

  return NextResponse.json({
    message: `Created ${announcementsCreated} leave announcement(s)`,
    date: today,
    leavesStarting: startingLeaves.length,
  });
}
