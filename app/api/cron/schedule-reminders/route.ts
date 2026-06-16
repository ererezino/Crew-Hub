import { NextResponse } from "next/server";

import { createSupabaseServiceRoleClient } from "../../../../lib/supabase/service-role";
import { createNotification } from "../../../../lib/notifications/service";
import { sendScheduleReminderEmail } from "../../../../lib/notifications/email";

/**
 * Daily cron: reminds crew of their upcoming published shifts (in-app + email).
 *
 * - Monday      → this week's weekday shifts (Mon–Fri)
 * - Saturday    → this weekend's shifts (Sat–Sun)
 * - other days  → no-op
 *
 * Triggered by Vercel Cron at 07:00 UTC; the route decides whether today is a reminder day.
 * Protected by CRON_SECRET. Can also be called with `?day=monday|saturday` (still secret-gated)
 * for testing on a non-trigger day.
 */

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
function isoOf(date: Date): string {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}
function addDays(date: Date, n: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + n);
  return d;
}
function hhmm(value: string): string {
  const m = value.match(/T(\d{2}:\d{2})/);
  if (m) return m[1]!;
  if (/^\d{2}:\d{2}/.test(value.trim())) return value.trim().slice(0, 5);
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}` : value;
}
function humanDate(iso: string): string {
  return new Date(`${iso}T00:00:00.000Z`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC"
  });
}
function cleanSlotName(notes: string | null): string {
  const raw = (notes ?? "").trim();
  return raw.replace(/^Auto-generated:\s*/i, "").trim();
}

type ShiftRow = {
  org_id: string;
  employee_id: string | null;
  schedule_id: string;
  shift_date: string;
  start_time: string;
  end_time: string;
  notes: string | null;
};

async function handle(request: Request): Promise<NextResponse> {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const forcedDay = url.searchParams.get("day"); // "monday" | "saturday" for testing
  const now = new Date();
  const dow = now.getUTCDay(); // 0 = Sun … 6 = Sat

  // Determine the reminder window.
  let kind: "weekday" | "weekend" | null = null;
  if (forcedDay === "monday" || (!forcedDay && dow === 1)) kind = "weekday";
  else if (forcedDay === "saturday" || (!forcedDay && dow === 6)) kind = "weekend";

  if (!kind) {
    return NextResponse.json({ ok: true, skipped: "Not a reminder day", dow });
  }

  // Compute [windowStart, windowEnd] (inclusive ISO dates) and a human label for the period.
  let windowStart: string;
  let windowEnd: string;
  let periodLabel: string;
  if (kind === "weekday") {
    // Monday → this week Mon..Fri.
    const monday = now;
    windowStart = isoOf(monday);
    windowEnd = isoOf(addDays(monday, 4));
    periodLabel = `this week (${humanDate(windowStart)} – ${humanDate(windowEnd)})`;
  } else {
    // Saturday → this weekend Sat..Sun.
    windowStart = isoOf(now);
    windowEnd = isoOf(addDays(now, 1));
    periodLabel = `this weekend (${humanDate(windowStart)} – ${humanDate(windowEnd)})`;
  }

  const supabase = createSupabaseServiceRoleClient();

  // Only published schedules.
  const { data: publishedSchedules, error: schedulesError } = await supabase
    .from("schedules")
    .select("id")
    .eq("status", "published")
    .is("deleted_at", null);

  if (schedulesError) {
    return NextResponse.json({ error: "Unable to load published schedules." }, { status: 500 });
  }

  const publishedIds = (publishedSchedules ?? [])
    .map((row) => row.id)
    .filter((value): value is string => typeof value === "string");

  if (publishedIds.length === 0) {
    return NextResponse.json({ ok: true, kind, periodLabel, recipients: 0, reason: "No published schedules" });
  }

  const { data: rawShifts, error: shiftsError } = await supabase
    .from("shifts")
    .select("org_id, employee_id, schedule_id, shift_date, start_time, end_time, notes")
    .in("schedule_id", publishedIds)
    .gte("shift_date", windowStart)
    .lte("shift_date", windowEnd)
    .not("employee_id", "is", null)
    .neq("status", "cancelled")
    .is("deleted_at", null)
    .order("shift_date", { ascending: true });

  if (shiftsError) {
    return NextResponse.json({ error: "Unable to load shifts." }, { status: 500 });
  }

  // Group shifts per employee.
  const byEmployee = new Map<string, { orgId: string; lines: string[]; count: number }>();
  for (const row of (rawShifts ?? []) as ShiftRow[]) {
    if (!row.employee_id) continue;
    const slotName = cleanSlotName(row.notes);
    const line = `${humanDate(row.shift_date)} · ${hhmm(row.start_time)}–${hhmm(row.end_time)}${
      slotName ? ` · ${slotName}` : ""
    }`;
    const existing = byEmployee.get(row.employee_id);
    if (existing) {
      existing.lines.push(line);
      existing.count += 1;
    } else {
      byEmployee.set(row.employee_id, { orgId: row.org_id, lines: [line], count: 1 });
    }
  }

  let notified = 0;
  for (const [employeeId, info] of byEmployee) {
    const body =
      info.count === 1
        ? `You have 1 shift ${periodLabel}: ${info.lines[0]}`
        : `You have ${info.count} shifts ${periodLabel}. Tap to view them all.`;

    await createNotification({
      orgId: info.orgId,
      userId: employeeId,
      type: "schedule_reminder",
      title: `Your shifts for ${periodLabel}`,
      body,
      link: "/scheduling",
      dedupeKey: `schedule-reminder:${employeeId}:${windowStart}`
    }).catch(() => undefined);

    await sendScheduleReminderEmail({
      orgId: info.orgId,
      userId: employeeId,
      periodLabel,
      shiftLines: info.lines
    }).catch(() => undefined);

    notified += 1;
  }

  return NextResponse.json({ ok: true, kind, periodLabel, window: { windowStart, windowEnd }, recipients: notified });
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
