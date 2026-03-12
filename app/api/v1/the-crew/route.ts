import { NextResponse } from "next/server";

import { getAuthenticatedSession } from "../../../../lib/auth/session";
import { createSupabaseServiceRoleClient } from "../../../../lib/supabase/service-role";
import type { ApiResponse } from "../../../../types/auth";
import type { CrewListResponseData, CrewMember } from "../../../../types/people";

function buildMeta() {
  return { timestamp: new Date().toISOString() };
}

function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return NextResponse.json(payload, { status });
}

/**
 * GET /api/v1/the-crew
 *
 * Returns all visible crew members for the social "The Crew" page.
 * Respects privacy settings — hides bio/interests when the user has opted out.
 * Only returns active + onboarding members who have been invited or are active.
 */
export async function GET() {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: { code: "UNAUTHORIZED", message: "Authentication required." },
      meta: buildMeta()
    });
  }

  const orgId = session.profile.org_id;
  const serviceClient = createSupabaseServiceRoleClient();

  // invite_status is derived, not a real column. We use account_setup_at/last_seen_at
  // to determine if the person has actually accepted their invite.
  // "not_invited" = no account_setup_at AND no last_seen_at (exclude these)
  const { data: rows, error } = await serviceClient
    .from("profiles")
    .select(
      `id, full_name, title, department, avatar_url, bio, pronouns,
       country_code, start_date, favorite_music, favorite_books, favorite_sports,
       social_linkedin, social_twitter, social_instagram, social_github, social_website,
       privacy_settings, status, directory_visible, account_setup_at, last_seen_at`
    )
    .eq("org_id", orgId)
    .in("status", ["active", "onboarding"])
    .eq("directory_visible", true)
    .is("deleted_at", null)
    .order("department", { ascending: true, nullsFirst: false })
    .order("full_name", { ascending: true });

  if (error) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "CREW_FETCH_FAILED", message: "Unable to load crew members." },
      meta: buildMeta()
    });
  }

  // Filter out not-invited stubs (no account_setup_at AND no last_seen_at)
  const visibleRows = (rows ?? []).filter((row) => {
    const hasSetup = !!row.account_setup_at;
    const hasSeen = !!row.last_seen_at;
    return hasSetup || hasSeen;
  });

  const departmentCounts: Record<string, number> = {};
  const members: CrewMember[] = visibleRows.map((row) => {
    const privacy = (row.privacy_settings as Record<string, boolean> | null) ?? {};
    const showBio = privacy.showBio !== false;
    const showInterests = privacy.showInterests !== false;

    const dept = (row.department as string | null) ?? "Other";
    departmentCounts[dept] = (departmentCounts[dept] ?? 0) + 1;

    return {
      id: row.id as string,
      fullName: row.full_name as string,
      title: row.title as string | null,
      department: row.department as string | null,
      avatarUrl: row.avatar_url as string | null,
      bio: showBio ? (row.bio as string | null) : null,
      pronouns: row.pronouns as string | null,
      countryCode: row.country_code as string | null,
      startDate: row.start_date as string | null,
      favoriteMusic: showInterests ? (row.favorite_music as string | null) : null,
      favoriteBooks: showInterests ? (row.favorite_books as string | null) : null,
      favoriteSports: showInterests ? (row.favorite_sports as string | null) : null,
      socialLinkedin: row.social_linkedin as string | null,
      socialTwitter: row.social_twitter as string | null,
      socialInstagram: row.social_instagram as string | null,
      socialGithub: row.social_github as string | null,
      socialWebsite: row.social_website as string | null
    };
  });

  return jsonResponse<CrewListResponseData>(200, {
    data: { members, departmentCounts, totalCount: members.length },
    error: null,
    meta: buildMeta()
  });
}
