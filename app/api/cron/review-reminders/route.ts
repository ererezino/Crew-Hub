import { NextResponse } from "next/server";

import { createSupabaseServiceRoleClient } from "../../../../lib/supabase/service-role";
import { createNotification } from "../../../../lib/notifications/service";
import { sendReviewReminderEmail } from "../../../../lib/notifications/email";

/**
 * Daily cron endpoint: sends reminders for self-reviews due in 2 days.
 *
 * Triggered by Vercel Cron daily at 07:00 UTC.
 * Protected by CRON_SECRET header to prevent unauthorized access.
 *
 * Logic:
 * - Finds active review_cycles where self_review_deadline is exactly 2 days from today
 * - Gets review_assignments in status pending_self for those cycles
 * - Notifies each matching employee (in-app + email)
 */

function twoDaysFromNowIso(): string {
  const now = new Date();
  now.setUTCDate(now.getUTCDate() + 2);
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const deadlineDate = twoDaysFromNowIso();
  const supabase = createSupabaseServiceRoleClient();

  // Find active review cycles with self_review_deadline exactly 2 days from now
  const { data: cycles, error: cyclesError } = await supabase
    .from("review_cycles")
    .select("id, org_id, name, self_review_deadline")
    .eq("status", "active")
    .eq("self_review_deadline", deadlineDate)
    .is("deleted_at", null);

  if (cyclesError) {
    console.error("Failed to fetch review cycles for reminders:", cyclesError.message);
    return NextResponse.json({ error: "Failed to fetch review cycles" }, { status: 500 });
  }

  if (!cycles || cycles.length === 0) {
    return NextResponse.json({
      message: "No review cycles with self-review deadline in 2 days",
      deadlineDate
    });
  }

  let remindersCreated = 0;

  for (const cycle of cycles) {
    const cycleName = typeof cycle.name === "string" ? cycle.name : "Review";
    const cycleOrgId = typeof cycle.org_id === "string" ? cycle.org_id : null;
    const cycleId = typeof cycle.id === "string" ? cycle.id : null;

    if (!cycleOrgId || !cycleId) {
      continue;
    }

    // Find assignments still pending self-review
    const { data: assignments, error: assignmentsError } = await supabase
      .from("review_assignments")
      .select("employee_id")
      .eq("cycle_id", cycleId)
      .eq("org_id", cycleOrgId)
      .eq("status", "pending_self")
      .is("deleted_at", null);

    if (assignmentsError) {
      console.error(`Failed to fetch assignments for cycle ${cycleId}:`, assignmentsError.message);
      continue;
    }

    const employeeIds = [...new Set(
      (assignments ?? [])
        .map((row) => row.employee_id)
        .filter((value): value is string => typeof value === "string")
    )];

    for (const employeeId of employeeIds) {
      void createNotification({
        orgId: cycleOrgId,
        userId: employeeId,
        type: "review_reminder",
        title: "Self-review due soon",
        body: `Your self-review for ${cycleName} is due in 2 days. Complete it before ${deadlineDate}.`,
        link: "/performance"
      });

      void sendReviewReminderEmail({
        orgId: cycleOrgId,
        userId: employeeId,
        cycleName,
        deadline: deadlineDate
      });

      remindersCreated++;
    }
  }

  return NextResponse.json({
    message: `Sent ${remindersCreated} review reminder(s)`,
    deadlineDate,
    cyclesChecked: cycles.length
  });
}
