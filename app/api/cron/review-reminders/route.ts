import { NextResponse } from "next/server";

import { createSupabaseServiceRoleClient } from "../../../../lib/supabase/service-role";
import { createNotification } from "../../../../lib/notifications/service";
import { sendReviewReminderEmail } from "../../../../lib/notifications/email";

/**
 * Daily cron endpoint: sends reminders for self-reviews due within 48 hours.
 *
 * Triggered by Vercel Cron daily at 07:00 UTC.
 * Protected by CRON_SECRET header to prevent unauthorized access.
 *
 * Logic:
 * - Uses hour-precision calculation (48h + 4h cron tolerance = 52h window)
 * - Finds active review_cycles where self_review_deadline falls within the window
 * - Gets review_assignments in status pending_self for those cycles
 * - Deduplicates by checking if a reminder was already sent today
 * - Notifies each matching employee (in-app + email)
 */

function deadlineWindowDates(): { windowStart: string; windowEnd: string } {
  const now = new Date();

  // Window start: today (only remind for deadlines still in the future)
  const startYyyy = now.getUTCFullYear();
  const startMm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const startDd = String(now.getUTCDate()).padStart(2, "0");

  // Window end: 52 hours from now (48h deadline + 4h cron tolerance)
  const windowEnd = new Date(now.getTime() + 52 * 60 * 60 * 1000);
  const endYyyy = windowEnd.getUTCFullYear();
  const endMm = String(windowEnd.getUTCMonth() + 1).padStart(2, "0");
  const endDd = String(windowEnd.getUTCDate()).padStart(2, "0");

  return {
    windowStart: `${startYyyy}-${startMm}-${startDd}`,
    windowEnd: `${endYyyy}-${endMm}-${endDd}`
  };
}

function todayDateIso(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")}`;
}

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { windowStart, windowEnd } = deadlineWindowDates();
  const today = todayDateIso();
  const supabase = createSupabaseServiceRoleClient();

  // Find active review cycles with deadline within the 48h+4h tolerance window
  const { data: cycles, error: cyclesError } = await supabase
    .from("review_cycles")
    .select("id, org_id, name, self_review_deadline")
    .eq("status", "active")
    .gte("self_review_deadline", windowStart)
    .lte("self_review_deadline", windowEnd)
    .is("deleted_at", null);

  if (cyclesError) {
    console.error("Failed to fetch review cycles for reminders:", cyclesError.message);
    return NextResponse.json({ error: "Failed to fetch review cycles" }, { status: 500 });
  }

  if (!cycles || cycles.length === 0) {
    return NextResponse.json({
      message: "No review cycles with self-review deadline within 48 hours",
      windowStart,
      windowEnd
    });
  }

  let remindersCreated = 0;
  let skippedDuplicates = 0;

  for (const cycle of cycles) {
    const cycleName = typeof cycle.name === "string" ? cycle.name : "Review";
    const cycleOrgId = typeof cycle.org_id === "string" ? cycle.org_id : null;
    const cycleId = typeof cycle.id === "string" ? cycle.id : null;
    const deadline = typeof cycle.self_review_deadline === "string" ? cycle.self_review_deadline : "";

    if (!cycleOrgId || !cycleId) {
      continue;
    }

    // Calculate hours until deadline for the notification message
    const deadlineMs = new Date(deadline + "T23:59:59Z").getTime();
    const hoursUntilDue = Math.max(0, Math.round((deadlineMs - Date.now()) / (1000 * 60 * 60)));

    // Find assignments still pending self-review
    const { data: assignments, error: assignmentsError } = await supabase
      .from("review_assignments")
      .select("employee_id, last_reminder_sent_at")
      .eq("cycle_id", cycleId)
      .eq("org_id", cycleOrgId)
      .eq("status", "pending_self")
      .is("deleted_at", null);

    if (assignmentsError) {
      console.error(`Failed to fetch assignments for cycle ${cycleId}:`, assignmentsError.message);
      continue;
    }

    // Filter out employees who already received a reminder today
    const eligibleAssignments = (assignments ?? []).filter((row) => {
      if (!row.last_reminder_sent_at) {
        return true;
      }
      const lastSent = typeof row.last_reminder_sent_at === "string"
        ? row.last_reminder_sent_at.slice(0, 10)
        : "";
      return lastSent !== today;
    });

    skippedDuplicates += (assignments ?? []).length - eligibleAssignments.length;

    const employeeIds = [...new Set(
      eligibleAssignments
        .map((row) => row.employee_id)
        .filter((value): value is string => typeof value === "string")
    )];

    // Mark reminders as sent (fire-and-forget)
    if (employeeIds.length > 0) {
      void supabase
        .from("review_assignments")
        .update({ last_reminder_sent_at: new Date().toISOString() })
        .eq("cycle_id", cycleId)
        .eq("org_id", cycleOrgId)
        .eq("status", "pending_self")
        .in("employee_id", employeeIds)
        .then();
    }

    for (const employeeId of employeeIds) {
      const timeLabel = hoursUntilDue <= 24
        ? `in ${hoursUntilDue} hours`
        : `in ${Math.ceil(hoursUntilDue / 24)} days`;

      void createNotification({
        orgId: cycleOrgId,
        userId: employeeId,
        type: "review_reminder",
        title: "Self-review due soon",
        body: `Your self-review for ${cycleName} is due ${timeLabel}. Complete it before ${deadline}.`,
        link: "/performance"
      });

      void sendReviewReminderEmail({
        orgId: cycleOrgId,
        userId: employeeId,
        cycleName,
        deadline
      });

      remindersCreated++;
    }
  }

  return NextResponse.json({
    message: `Sent ${remindersCreated} review reminder(s), skipped ${skippedDuplicates} duplicate(s)`,
    windowStart,
    windowEnd,
    cyclesChecked: cycles.length
  });
}
