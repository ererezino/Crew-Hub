import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../../lib/auth/session";
import { logAudit } from "../../../../../../lib/audit";
import { hasRole } from "../../../../../../lib/roles";
import { createNotification } from "../../../../../../lib/notifications/service";
import { createSupabaseServiceRoleClient } from "../../../../../../lib/supabase/service-role";
import type { ApiResponse } from "../../../../../../types/auth";
import type { CrewModerateResponse } from "../../../../../../types/people";

const MODERATE_ROLES = ["SUPER_ADMIN", "HR_ADMIN"] as const;

const moderateSchema = z.object({
  bio: z.string().max(500).nullable().optional(),
  socialLinkedin: z.string().max(255).nullable().optional(),
  socialTwitter: z.string().max(255).nullable().optional(),
  socialInstagram: z.string().max(255).nullable().optional(),
  socialGithub: z.string().max(255).nullable().optional(),
  socialWebsite: z.string().max(255).nullable().optional(),
  favoriteMusic: z.string().max(500).nullable().optional(),
  favoriteBooks: z.string().max(500).nullable().optional(),
  favoriteSports: z.string().max(500).nullable().optional(),
  avatarUrl: z.string().max(500).nullable().optional(),
  directoryVisible: z.boolean().optional()
});

function buildMeta() {
  return { timestamp: new Date().toISOString() };
}

function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return NextResponse.json(payload, { status });
}

/**
 * PATCH /api/v1/the-crew/[id]/moderate
 *
 * Admin moderation endpoint. Allows SUPER_ADMIN and HR_ADMIN to:
 * - Edit/clear bio, social links, favorites
 * - Remove avatar
 * - Toggle directory_visible (hide/show on The Crew)
 * All changes are audit-logged and the user is notified.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: { code: "UNAUTHORIZED", message: "Authentication required." },
      meta: buildMeta()
    });
  }

  const profile = session.profile;

  const canModerate = MODERATE_ROLES.some((role) =>
    hasRole(profile.roles, role)
  );

  if (!canModerate) {
    return jsonResponse<null>(403, {
      data: null,
      error: { code: "FORBIDDEN", message: "Only administrators can moderate profiles." },
      meta: buildMeta()
    });
  }

  const { id: targetId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse<null>(400, {
      data: null,
      error: { code: "BAD_REQUEST", message: "Request body must be valid JSON." },
      meta: buildMeta()
    });
  }

  const parsed = moderateSchema.safeParse(body);
  if (!parsed.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsed.error.issues[0]?.message ?? "Invalid moderation payload."
      },
      meta: buildMeta()
    });
  }

  const updates: Record<string, unknown> = {};
  const changedFields: string[] = [];

  if (parsed.data.bio !== undefined) {
    updates.bio = parsed.data.bio;
    changedFields.push("bio");
  }
  if (parsed.data.socialLinkedin !== undefined) {
    updates.social_linkedin = parsed.data.socialLinkedin;
    changedFields.push("social_linkedin");
  }
  if (parsed.data.socialTwitter !== undefined) {
    updates.social_twitter = parsed.data.socialTwitter;
    changedFields.push("social_twitter");
  }
  if (parsed.data.socialInstagram !== undefined) {
    updates.social_instagram = parsed.data.socialInstagram;
    changedFields.push("social_instagram");
  }
  if (parsed.data.socialGithub !== undefined) {
    updates.social_github = parsed.data.socialGithub;
    changedFields.push("social_github");
  }
  if (parsed.data.socialWebsite !== undefined) {
    updates.social_website = parsed.data.socialWebsite;
    changedFields.push("social_website");
  }
  if (parsed.data.favoriteMusic !== undefined) {
    updates.favorite_music = parsed.data.favoriteMusic;
    changedFields.push("favorite_music");
  }
  if (parsed.data.favoriteBooks !== undefined) {
    updates.favorite_books = parsed.data.favoriteBooks;
    changedFields.push("favorite_books");
  }
  if (parsed.data.favoriteSports !== undefined) {
    updates.favorite_sports = parsed.data.favoriteSports;
    changedFields.push("favorite_sports");
  }
  if (parsed.data.avatarUrl !== undefined) {
    updates.avatar_url = parsed.data.avatarUrl;
    changedFields.push("avatar_url");
  }
  if (parsed.data.directoryVisible !== undefined) {
    updates.directory_visible = parsed.data.directoryVisible;
    changedFields.push("directory_visible");
  }

  if (Object.keys(updates).length === 0) {
    return jsonResponse<null>(422, {
      data: null,
      error: { code: "NO_CHANGES", message: "No fields provided to update." },
      meta: buildMeta()
    });
  }

  const serviceClient = createSupabaseServiceRoleClient();

  // Verify the target person exists in the same org
  const { data: targetProfile, error: lookupError } = await serviceClient
    .from("profiles")
    .select("id, org_id, full_name")
    .eq("id", targetId)
    .single();

  if (lookupError || !targetProfile) {
    return jsonResponse<null>(404, {
      data: null,
      error: { code: "NOT_FOUND", message: "Person not found." },
      meta: buildMeta()
    });
  }

  if (targetProfile.org_id !== profile.org_id) {
    return jsonResponse<null>(403, {
      data: null,
      error: { code: "FORBIDDEN", message: "Cannot moderate people outside your organization." },
      meta: buildMeta()
    });
  }

  const { error: updateError } = await serviceClient
    .from("profiles")
    .update(updates)
    .eq("id", targetId);

  if (updateError) {
    return jsonResponse<null>(500, {
      data: null,
      error: { code: "MODERATE_FAILED", message: "Unable to update profile." },
      meta: buildMeta()
    });
  }

  // Audit log
  try {
    await logAudit({
      action: "updated",
      tableName: "profiles",
      recordId: targetId,
      newValue: { changedFields, updates }
    });
  } catch {
    // Non-blocking — moderation still succeeded
  }

  // Notify the user that their profile was updated by an admin
  try {
    await createNotification({
      userId: targetId,
      orgId: profile.org_id,
      type: "profile_moderated",
      title: "Profile updated by administrator",
      body: `An administrator updated your profile. Fields changed: ${changedFields.join(", ")}.`,
      link: "/settings"
    });
  } catch {
    // Non-blocking
  }

  return jsonResponse<CrewModerateResponse["data"]>(200, {
    data: { updated: true },
    error: null,
    meta: buildMeta()
  });
}
