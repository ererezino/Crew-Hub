import { NextResponse } from "next/server";

import { createSupabaseServiceRoleClient } from "../../../../lib/supabase/service-role";
import {
  createNotification,
  createBulkNotifications
} from "../../../../lib/notifications/service";
import { sendComplianceReminderEmail, sendComplianceOverdueEmail } from "../../../../lib/notifications/email";

/**
 * Daily cron endpoint: compliance deadline reminders.
 *
 * Triggered by Vercel Cron daily at 07:00 UTC.
 * Protected by CRON_SECRET header.
 *
 * Logic:
 * 1. 7-day warning: deadlines due in exactly 7 days (status != completed)
 * 2. Day-of alert: deadlines due today (status != completed)
 * 3. Overdue auto-mark: deadlines due yesterday (status != completed)
 *    → Update status to "overdue", write audit_log, notify
 */

function offsetDate(days: number): string {
  const now = new Date();
  now.setUTCDate(now.getUTCDate() + days);
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

type DeadlineRow = {
  id: string;
  org_id: string;
  due_date: string;
  status: string;
  assigned_to: string | null;
  item_id: string;
  compliance_items: {
    requirement: string;
  } | null;
};

async function getAdminIdsForOrg(
  supabase: ReturnType<typeof createSupabaseServiceRoleClient>,
  orgId: string
): Promise<string[]> {
  const { data: rows, error } = await supabase
    .from("profiles")
    .select("id, roles")
    .eq("org_id", orgId)
    .is("deleted_at", null);

  if (error || !rows) return [];

  return rows
    .filter((row) => {
      const roles = Array.isArray(row.roles) ? row.roles : [];
      return (
        roles.includes("HR_ADMIN") || roles.includes("SUPER_ADMIN")
      );
    })
    .map((row) => row.id)
    .filter((id): id is string => typeof id === "string");
}

async function notifyDeadline(
  supabase: ReturnType<typeof createSupabaseServiceRoleClient>,
  deadline: DeadlineRow,
  alertType: "7_day_warning" | "day_of" | "overdue"
) {
  const requirement =
    deadline.compliance_items?.requirement ?? "Compliance deadline";
  const dueDate = deadline.due_date;
  const orgId = deadline.org_id;

  const titleMap = {
    "7_day_warning": "Compliance deadline in 7 days",
    day_of: "Compliance deadline today",
    overdue: "Compliance deadline overdue"
  };

  const bodyMap = {
    "7_day_warning": `"${requirement}" is due on ${dueDate}. Please review and prepare.`,
    day_of: `"${requirement}" is due today (${dueDate}). Please complete it.`,
    overdue: `"${requirement}" was due on ${dueDate} and is now overdue.`
  };

  const title = titleMap[alertType];
  const body = bodyMap[alertType];

  // Collect all recipients: assigned_to + HR_ADMIN + SUPER_ADMIN
  const adminIds = await getAdminIdsForOrg(supabase, orgId);
  const allRecipients = new Set<string>(adminIds);
  if (deadline.assigned_to) {
    allRecipients.add(deadline.assigned_to);
  }

  const recipientList = [...allRecipients];
  if (recipientList.length === 0) return;

  // In-app notifications
  if (recipientList.length === 1) {
    void createNotification({
      orgId,
      userId: recipientList[0],
      type: "compliance_deadline",
      title,
      body,
      link: "/compliance"
    });
  } else {
    void createBulkNotifications({
      orgId,
      userIds: recipientList,
      type: "compliance_deadline",
      title,
      body,
      link: "/compliance"
    });
  }

  // Email notifications
  void Promise.all(
    recipientList.map((userId) =>
      sendComplianceReminderEmail({
        orgId,
        userId,
        requirement,
        dueDate
      })
    )
  );
}

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createSupabaseServiceRoleClient();

  const sevenDaysFromNow = offsetDate(7);
  const today = offsetDate(0);
  const yesterday = offsetDate(-1);

  let warnings7d = 0;
  let alertsDayOf = 0;
  let overdueMarked = 0;

  // ─── 1. 7-day warning ───

  const { data: warningDeadlines, error: warningError } = await supabase
    .from("compliance_deadlines")
    .select("id, org_id, due_date, status, assigned_to, item_id, compliance_items(requirement)")
    .eq("due_date", sevenDaysFromNow)
    .neq("status", "completed")
    .is("deleted_at", null);

  if (warningError) {
    console.error("Failed to fetch 7-day warning deadlines:", warningError.message);
  } else if (warningDeadlines && warningDeadlines.length > 0) {
    for (const deadline of warningDeadlines) {
      const row = deadline as unknown as DeadlineRow;
      await notifyDeadline(supabase, row, "7_day_warning");
      warnings7d++;
    }
  }

  // ─── 2. Day-of alert ───

  const { data: todayDeadlines, error: todayError } = await supabase
    .from("compliance_deadlines")
    .select("id, org_id, due_date, status, assigned_to, item_id, compliance_items(requirement)")
    .eq("due_date", today)
    .neq("status", "completed")
    .is("deleted_at", null);

  if (todayError) {
    console.error("Failed to fetch day-of deadlines:", todayError.message);
  } else if (todayDeadlines && todayDeadlines.length > 0) {
    for (const deadline of todayDeadlines) {
      const row = deadline as unknown as DeadlineRow;
      await notifyDeadline(supabase, row, "day_of");
      alertsDayOf++;
    }
  }

  // ─── 3. Overdue auto-mark ───

  const { data: overdueDeadlines, error: overdueError } = await supabase
    .from("compliance_deadlines")
    .select("id, org_id, due_date, status, assigned_to, item_id, compliance_items(requirement)")
    .eq("due_date", yesterday)
    .neq("status", "completed")
    .neq("status", "overdue")
    .is("deleted_at", null);

  if (overdueError) {
    console.error("Failed to fetch overdue deadlines:", overdueError.message);
  } else if (overdueDeadlines && overdueDeadlines.length > 0) {
    for (const deadline of overdueDeadlines) {
      const row = deadline as unknown as DeadlineRow;

      // Update status to overdue
      const { error: updateError } = await supabase
        .from("compliance_deadlines")
        .update({ status: "overdue" })
        .eq("id", row.id);

      if (updateError) {
        console.error(`Failed to mark deadline ${row.id} as overdue:`, updateError.message);
        continue;
      }

      // Write audit_log entry (system cron as actor)
      const { error: auditError } = await supabase
        .from("audit_log")
        .insert({
          org_id: row.org_id,
          actor_user_id: null,
          action: "updated",
          table_name: "compliance_deadlines",
          record_id: row.id,
          old_value: { status: row.status },
          new_value: { status: "overdue" },
          ip_address: null,
          created_at: new Date().toISOString()
        });

      if (auditError) {
        console.error(`Failed to write audit log for deadline ${row.id}:`, auditError.message);
      }

      // Notify
      await notifyDeadline(supabase, row, "overdue");

      // Overdue-specific email to the assigned owner
      if (row.assigned_to) {
        sendComplianceOverdueEmail({
          orgId: row.org_id,
          userId: row.assigned_to,
          requirement: row.compliance_items?.requirement ?? "Compliance requirement",
          dueDate: row.due_date,
          ownerName: undefined
        }).catch(err => console.error('Compliance overdue email send failed:', err));
      }

      overdueMarked++;
    }
  }

  return NextResponse.json({
    message: "Compliance reminders processed",
    sevenDayWarnings: warnings7d,
    dayOfAlerts: alertsDayOf,
    overdueMarked,
    dates: { sevenDaysFromNow, today, yesterday }
  });
}
