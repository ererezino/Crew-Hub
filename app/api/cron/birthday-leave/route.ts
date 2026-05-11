import { NextResponse } from "next/server";
import { createSupabaseServiceRoleClient } from "../../../../lib/supabase/service-role";
import { createBulkNotifications, createNotification } from "../../../../lib/notifications/service";
import { getBirthdayLeaveOptions, isoDateToUtcDate } from "../../../../lib/time-off";

/**
 * Daily cron endpoint: handles birthday leave auto-granting and reminders.
 *
 * Triggered by Vercel Cron daily at 07:00 UTC (8am WAT).
 *
 * Logic:
 * 1. Find employees whose birthday is today (weekday, not holiday) → auto-create approved birthday_leave
 * 2. Find employees whose birthday is 7 days from now and falls on weekend/holiday → send reminder to choose a date
 */

function todayIso(): string {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function addDaysIso(isoDate: string, days: number): string {
  const date = isoDateToUtcDate(isoDate);
  if (!date) return isoDate;
  date.setUTCDate(date.getUTCDate() + days);
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

type OrgProfileRow = {
  id: string;
  full_name: string;
  roles: unknown;
  status: string | null;
};

function normalizeRoles(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((role): role is string => typeof role === "string")
    : [];
}

function isActiveProfile(profile: OrgProfileRow): boolean {
  return profile.status === "active" || profile.status === null;
}

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const today = todayIso();
  const todayDate = isoDateToUtcDate(today);
  if (!todayDate) {
    return NextResponse.json({ error: "Invalid date" }, { status: 500 });
  }

  const currentYear = todayDate.getUTCFullYear();
  const todayMonth = todayDate.getUTCMonth() + 1;
  const todayDay = todayDate.getUTCDate();

  // Also check 7 days from now for reminders
  const reminderDate = addDaysIso(today, 7);
  const reminderParsed = isoDateToUtcDate(reminderDate);
  const reminderMonth = reminderParsed ? reminderParsed.getUTCMonth() + 1 : 0;
  const reminderDay = reminderParsed ? reminderParsed.getUTCDate() : 0;

  const supabase = createSupabaseServiceRoleClient();

  // Find all employees with DOBs across all orgs
  const { data: employees, error: empError } = await supabase
    .from("profiles")
    .select("id, org_id, full_name, date_of_birth, country_code, status")
    .not("date_of_birth", "is", null)
    .is("deleted_at", null);

  if (empError) {
    console.error("Birthday leave cron: failed to fetch employees", empError.message);
    return NextResponse.json({ error: "Failed to fetch employees" }, { status: 500 });
  }

  if (!employees || employees.length === 0) {
    return NextResponse.json({ message: "No employees with birthdays configured", date: today });
  }

  let autoGranted = 0;
  let birthdayAnnouncements = 0;
  let remindersSent = 0;
  const orgContextCache = new Map<
    string,
    { activeMemberIds: string[]; creatorId: string | null }
  >();

  async function getOrgContext(orgId: string) {
    const cached = orgContextCache.get(orgId);
    if (cached) {
      return cached;
    }

    const { data: orgProfiles } = await supabase
      .from("profiles")
      .select("id, full_name, roles, status")
      .eq("org_id", orgId)
      .is("deleted_at", null);

    const parsedProfiles = (orgProfiles ?? []) as OrgProfileRow[];
    const activeProfiles = parsedProfiles.filter((profile) => isActiveProfile(profile));
    const superAdmin = activeProfiles.find((profile) =>
      normalizeRoles(profile.roles).includes("SUPER_ADMIN")
    );
    const creatorId = superAdmin?.id ?? activeProfiles[0]?.id ?? null;
    const context = {
      activeMemberIds: activeProfiles.map((profile) => profile.id),
      creatorId
    };

    orgContextCache.set(orgId, context);
    return context;
  }

  for (const emp of employees) {
    if (!emp.date_of_birth || emp.status === "onboarding") continue;

    const dob = isoDateToUtcDate(emp.date_of_birth);
    if (!dob) continue;

    const dobMonth = dob.getUTCMonth() + 1;
    const dobDay = dob.getUTCDate();
    const isBirthdayToday = dobMonth === todayMonth && dobDay === todayDay;
    const isBirthdayIn7Days = dobMonth === reminderMonth && dobDay === reminderDay;

    if (!isBirthdayToday && !isBirthdayIn7Days) continue;

    // Fetch holidays for this employee's country for the year
    const { data: holidays } = await supabase
      .from("holiday_calendars")
      .select("date")
      .eq("org_id", emp.org_id)
      .eq("country_code", emp.country_code ?? "NG")
      .gte("date", `${currentYear}-01-01`)
      .lte("date", `${currentYear}-12-31`)
      .is("deleted_at", null);

    const holidayDateKeys = new Set((holidays ?? []).map((h) => h.date));
    const birthdayOptions = getBirthdayLeaveOptions(emp.date_of_birth, currentYear, holidayDateKeys);

    if (isBirthdayToday) {
      const { activeMemberIds, creatorId } = await getOrgContext(emp.org_id);

      await createNotification({
        orgId: emp.org_id,
        userId: emp.id,
        type: "announcement",
        title: "Happy birthday!",
        body: birthdayOptions.needsChoice
          ? "Wishing you a wonderful birthday today."
          : "Wishing you a wonderful birthday today. Your birthday leave is ready in Crew Hub.",
        link: "/time-off",
        dedupeKey: `birthday-greeting:${today}:${emp.id}`
      });

      if (creatorId) {
        const announcementTitle = `Happy birthday, ${emp.full_name}!`;
        const announcementBody = birthdayOptions.needsChoice
          ? `Join us in wishing ${emp.full_name} a happy birthday today.`
          : `Join us in wishing ${emp.full_name} a happy birthday today. They are also out on birthday leave.`;

        const { data: existingAnnouncement } = await supabase
          .from("announcements")
          .select("id")
          .eq("org_id", emp.org_id)
          .eq("title", announcementTitle)
          .gte("created_at", `${today}T00:00:00Z`)
          .is("deleted_at", null)
          .limit(1);

        if (!existingAnnouncement || existingAnnouncement.length === 0) {
          const { data: announcement, error: insertAnnouncementError } = await supabase
            .from("announcements")
            .insert({
              org_id: emp.org_id,
              title: announcementTitle,
              body: announcementBody,
              is_pinned: false,
              created_by: creatorId,
              source: "system"
            })
            .select("id")
            .single();

          if (insertAnnouncementError || !announcement) {
            console.error(
              `Birthday leave cron: failed to create birthday announcement for ${emp.full_name}`,
              insertAnnouncementError?.message
            );
          } else {
            await supabase.from("announcement_reads").upsert(
              {
                announcement_id: announcement.id,
                user_id: creatorId,
                read_at: new Date().toISOString()
              },
              { onConflict: "announcement_id,user_id" }
            );

            const recipientIds = activeMemberIds.filter((id) => id !== creatorId);
            if (recipientIds.length > 0) {
              await createBulkNotifications({
                orgId: emp.org_id,
                userIds: recipientIds,
                type: "announcement",
                title: announcementTitle,
                body: announcementBody,
                link: "/announcements",
                dedupeKey: `birthday-announcement:${today}:${emp.id}`
              });
            }

            birthdayAnnouncements++;
          }
        }
      }
    }

    if (isBirthdayToday && !birthdayOptions.needsChoice) {
      // Auto-grant: birthday is a working day today
      // Check if already granted for this year
      const { data: existing } = await supabase
        .from("leave_requests")
        .select("id")
        .eq("org_id", emp.org_id)
        .eq("employee_id", emp.id)
        .eq("leave_type", "birthday_leave")
        .gte("start_date", `${currentYear}-01-01`)
        .lte("start_date", `${currentYear}-12-31`)
        .is("deleted_at", null)
        .limit(1);

      if (existing && existing.length > 0) continue;

      const { error: insertError } = await supabase
        .from("leave_requests")
        .insert({
          org_id: emp.org_id,
          employee_id: emp.id,
          leave_type: "birthday_leave",
          start_date: today,
          end_date: today,
          total_days: 1,
          status: "approved",
          reason: "Birthday leave (auto-granted)"
        });

      if (insertError) {
        console.error(`Birthday leave cron: failed to grant for ${emp.full_name}`, insertError.message);
        continue;
      }

      await createNotification({
        orgId: emp.org_id,
        userId: emp.id,
        type: "leave_status",
        title: "Birthday leave approved",
        body: "You have the day off today for your birthday. Enjoy!",
        link: "/time-off",
        dedupeKey: `birthday-leave:${today}:${emp.id}`
      });

      autoGranted++;
    }

    if (isBirthdayIn7Days && birthdayOptions.needsChoice) {
      // Reminder: birthday falls on weekend/holiday, employee needs to pick a date
      await createNotification({
        orgId: emp.org_id,
        userId: emp.id,
        type: "leave_status",
        title: "Choose your birthday leave date",
        body: `Your birthday falls on a non-working day this year. Please choose a day for your birthday leave in Crew Hub.`,
        link: "/time-off",
        dedupeKey: `birthday-reminder:${today}:${emp.id}`
      });

      remindersSent++;
    }
  }

  return NextResponse.json({
    message: `Birthday leave: ${autoGranted} auto-granted, ${birthdayAnnouncements} announcement(s), ${remindersSent} reminders sent`,
    date: today
  });
}
