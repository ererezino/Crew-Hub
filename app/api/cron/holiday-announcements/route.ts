import { NextResponse } from "next/server";
import { createSupabaseServiceRoleClient } from "../../../../lib/supabase/service-role";
import { createNotification } from "../../../../lib/notifications/service";
import { countryNameFromCode } from "../../../../lib/countries";

/**
 * Daily cron endpoint: creates announcements for public holidays.
 *
 * Residents get "You have the day off today!"
 * Non-residents get "Team members in [Country] have the day off."
 *
 * Triggered by Vercel Cron daily at 07:00 UTC (8am WAT).
 * Protected by CRON_SECRET header.
 */

function todayIso(): string {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

type HolidayRow = {
  id: string;
  org_id: string;
  country_code: string;
  date: string;
  name: string;
};

type ProfileRow = {
  id: string;
  country_code: string | null;
};

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const today = todayIso();
  const supabase = createSupabaseServiceRoleClient();

  // Find all holidays happening today across all orgs
  const { data: todaysHolidays, error: holidayError } = await supabase
    .from("holiday_calendars")
    .select("id, org_id, country_code, date, name")
    .eq("date", today)
    .is("deleted_at", null);

  if (holidayError) {
    console.error("Failed to fetch today's holidays:", holidayError.message);
    return NextResponse.json({ error: "Failed to fetch holiday data" }, { status: 500 });
  }

  if (!todaysHolidays || todaysHolidays.length === 0) {
    return NextResponse.json({ message: "No public holidays today", date: today });
  }

  // Group holidays by (org_id, name) → collect country_codes
  const holidayGroupKey = (orgId: string, name: string) => `${orgId}::${name}`;
  const holidayGroups = new Map<string, { orgId: string; name: string; countryCodes: string[] }>();

  for (const h of todaysHolidays as HolidayRow[]) {
    const key = holidayGroupKey(h.org_id, h.name);
    const existing = holidayGroups.get(key);

    if (existing) {
      if (!existing.countryCodes.includes(h.country_code)) {
        existing.countryCodes.push(h.country_code);
      }
    } else {
      holidayGroups.set(key, {
        orgId: h.org_id,
        name: h.name,
        countryCodes: [h.country_code],
      });
    }
  }

  let announcementsCreated = 0;

  // Group by org to batch org member queries
  const groupsByOrg = new Map<string, typeof holidayGroups extends Map<string, infer V> ? V[] : never>();

  for (const group of holidayGroups.values()) {
    const existing = groupsByOrg.get(group.orgId) ?? [];
    existing.push(group);
    groupsByOrg.set(group.orgId, existing);
  }

  for (const [orgId, holidays] of groupsByOrg) {
    // Get all org members with their country_code
    const { data: orgMembers } = await supabase
      .from("profiles")
      .select("id, country_code")
      .eq("org_id", orgId)
      .is("deleted_at", null);

    const members = (orgMembers ?? []) as ProfileRow[];

    if (members.length === 0) continue;

    // Find a super admin as announcement creator
    const { data: adminRows } = await supabase
      .from("profiles")
      .select("id")
      .eq("org_id", orgId)
      .contains("roles", ["SUPER_ADMIN"])
      .is("deleted_at", null)
      .limit(1);

    const creatorId = adminRows?.[0]?.id ?? members[0].id;

    for (const holiday of holidays) {
      const countryNames = holiday.countryCodes
        .map((cc) => countryNameFromCode(cc))
        .join(", ");

      const title = `Today is ${holiday.name}`;
      const body = `Team members in ${countryNames} have the day off for ${holiday.name}.`;

      // Deduplicate: skip if same announcement already exists today
      const { data: existing } = await supabase
        .from("announcements")
        .select("id")
        .eq("org_id", orgId)
        .eq("title", title)
        .gte("created_at", today + "T00:00:00Z")
        .is("deleted_at", null)
        .limit(1);

      if (existing && existing.length > 0) continue;

      // Create the announcement (visible to everyone)
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
        console.error(`Failed to create holiday announcement for ${holiday.name}:`, insertError?.message);
        continue;
      }

      // Mark as read for creator
      await supabase.from("announcement_reads").upsert(
        { announcement_id: announcement.id, user_id: creatorId, read_at: new Date().toISOString() },
        { onConflict: "announcement_id,user_id" }
      );

      // Send targeted notifications: different messages for residents vs non-residents
      const countryCodeSet = new Set(holiday.countryCodes);
      const residents = members.filter((m) => m.country_code && countryCodeSet.has(m.country_code));
      const nonResidents = members.filter((m) => !m.country_code || !countryCodeSet.has(m.country_code));

      // Notify residents
      await Promise.all(
        residents.map((m) =>
          createNotification({
            orgId,
            userId: m.id,
            type: "announcement",
            title: `Happy ${holiday.name}!`,
            body: "You have the day off today.",
            link: "/time-off",
          })
        )
      );

      // Notify non-residents
      await Promise.all(
        nonResidents.map((m) =>
          createNotification({
            orgId,
            userId: m.id,
            type: "announcement",
            title: `Today is ${holiday.name}`,
            body: `Team members in ${countryNames} have the day off.`,
            link: "/time-off",
          })
        )
      );

      announcementsCreated++;
    }
  }

  return NextResponse.json({
    message: `Created ${announcementsCreated} holiday announcement(s)`,
    date: today,
    holidaysToday: todaysHolidays.length,
  });
}
