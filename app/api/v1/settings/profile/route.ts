import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../lib/auth/session";
import { createSupabaseServiceRoleClient } from "../../../../../lib/supabase/service-role";
import type { ApiResponse } from "../../../../../types/auth";

const optionalUrl = z
  .string()
  .trim()
  .max(255, "URL is too long")
  .refine((value) => value.length === 0 || /^https?:\/\//.test(value), {
    message: "URL must start with http:// or https://"
  })
  .optional();

const profileSchema = z.object({
  fullName: z.string().trim().min(1, "Name is required").max(200, "Name is too long"),
  avatarUrl: z
    .string()
    .trim()
    .max(500, "Avatar URL is too long")
    .refine((value) => value.length === 0 || /^https?:\/\//.test(value), {
      message: "Avatar URL must start with http:// or https://"
    }),
  phone: z.string().trim().max(30, "Phone number is too long"),
  bio: z.string().trim().max(500, "Bio is too long").optional(),
  pronouns: z.string().trim().max(50, "Pronouns value is too long").optional(),
  countryCode: z.string().trim().max(2, "Country code must be 2 characters").optional(),
  emergencyContactName: z.string().trim().max(200, "Emergency contact name is too long").optional(),
  emergencyContactPhone: z.string().trim().max(30, "Emergency contact phone is too long").optional(),
  emergencyContactRelationship: z.string().trim().max(100, "Emergency contact relationship is too long").optional(),
  /* Social links (The Crew) */
  socialLinkedin: optionalUrl,
  socialTwitter: optionalUrl,
  socialInstagram: optionalUrl,
  socialGithub: optionalUrl,
  socialWebsite: optionalUrl,
  /* Favorites (The Crew) */
  favoriteMusic: z.string().trim().max(200, "Favorite music is too long").optional(),
  favoriteBooks: z.string().trim().max(200, "Favorite books is too long").optional(),
  favoriteSports: z.string().trim().max(200, "Favorite sports is too long").optional()
});

type ProfileResponseData = {
  fullName: string;
  avatarUrl: string | null;
  phone: string | null;
  bio: string | null;
  pronouns: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  emergencyContactRelationship: string | null;
  socialLinkedin: string | null;
  socialTwitter: string | null;
  socialInstagram: string | null;
  socialGithub: string | null;
  socialWebsite: string | null;
  favoriteMusic: string | null;
  favoriteBooks: string | null;
  favoriteSports: string | null;
};

function buildMeta() {
  return { timestamp: new Date().toISOString() };
}

function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return NextResponse.json(payload, { status });
}

export async function PATCH(request: Request) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to update profile settings."
      },
      meta: buildMeta()
    });
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return jsonResponse<null>(400, {
      data: null,
      error: {
        code: "BAD_REQUEST",
        message: "Request body must be valid JSON."
      },
      meta: buildMeta()
    });
  }

  const parsed = profileSchema.safeParse(body);

  if (!parsed.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: parsed.error.issues[0]?.message ?? "Invalid profile payload."
      },
      meta: buildMeta()
    });
  }

  const serviceClient = createSupabaseServiceRoleClient();

  const { data, error } = await serviceClient
    .from("profiles")
    .update({
      full_name: parsed.data.fullName,
      avatar_url: parsed.data.avatarUrl || null,
      phone: parsed.data.phone || null,
      bio: parsed.data.bio ?? null,
      pronouns: parsed.data.pronouns ?? null,
      country_code: parsed.data.countryCode || null,
      emergency_contact_name: parsed.data.emergencyContactName ?? null,
      emergency_contact_phone: parsed.data.emergencyContactPhone ?? null,
      emergency_contact_relationship: parsed.data.emergencyContactRelationship ?? null,
      social_linkedin: parsed.data.socialLinkedin ?? null,
      social_twitter: parsed.data.socialTwitter ?? null,
      social_instagram: parsed.data.socialInstagram ?? null,
      social_github: parsed.data.socialGithub ?? null,
      social_website: parsed.data.socialWebsite ?? null,
      favorite_music: parsed.data.favoriteMusic ?? null,
      favorite_books: parsed.data.favoriteBooks ?? null,
      favorite_sports: parsed.data.favoriteSports ?? null
    })
    .eq("id", session.profile.id)
    .select(
      `full_name, avatar_url, phone, bio, pronouns,
       emergency_contact_name, emergency_contact_phone, emergency_contact_relationship,
       social_linkedin, social_twitter, social_instagram, social_github, social_website,
       favorite_music, favorite_books, favorite_sports`
    )
    .single();

  if (error || !data) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "PROFILE_UPDATE_FAILED",
        message: "Unable to update profile settings."
      },
      meta: buildMeta()
    });
  }

  return jsonResponse<ProfileResponseData>(200, {
    data: {
      fullName: data.full_name,
      avatarUrl: data.avatar_url,
      phone: data.phone,
      bio: data.bio,
      pronouns: data.pronouns,
      emergencyContactName: data.emergency_contact_name,
      emergencyContactPhone: data.emergency_contact_phone,
      emergencyContactRelationship: data.emergency_contact_relationship,
      socialLinkedin: data.social_linkedin,
      socialTwitter: data.social_twitter,
      socialInstagram: data.social_instagram,
      socialGithub: data.social_github,
      socialWebsite: data.social_website,
      favoriteMusic: data.favorite_music,
      favoriteBooks: data.favorite_books,
      favoriteSports: data.favorite_sports
    },
    error: null,
    meta: buildMeta()
  });
}
