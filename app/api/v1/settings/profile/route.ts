import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../lib/auth/session";
import { createSupabaseServiceRoleClient } from "../../../../../lib/supabase/service-role";
import { getBirthdayParts } from "../../../../../lib/time-off";
import type { ApiResponse } from "../../../../../types/auth";

const optionalUrl = z
  .string()
  .trim()
  .max(255, "URL is too long")
  .refine((value) => value.length === 0 || /^https?:\/\//.test(value), {
    message: "URL must start with http:// or https://"
  })
  .optional();

const optionalLongUrl = z
  .string()
  .trim()
  .max(1000, "URL is too long")
  .refine((value) => value.length === 0 || /^https?:\/\//.test(value), {
    message: "URL must start with http:// or https://"
  })
  .optional();

const profileSchema = z
  .object({
    fullName: z.string().trim().min(1, "Name is required").max(200, "Name is too long"),
    avatarUrl: z
      .string()
      .trim()
      .max(500, "Avatar URL is too long")
      .refine((value) => value.length === 0 || /^https?:\/\//.test(value), {
        message: "Avatar URL must start with http:// or https://"
      }),
    phone: z.string().trim().max(30, "Phone number is too long"),
    dateOfBirth: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Date of birth must be YYYY-MM-DD.")
      .nullable()
      .optional(),
    birthdayMonth: z.number().int().min(1).max(12).nullable().optional(),
    birthdayDay: z.number().int().min(1).max(31).nullable().optional(),
    homeAddress: z.string().trim().max(500, "Home address is too long").optional(),
    governmentIdUrl: optionalLongUrl,
    bio: z.string().trim().max(500, "Bio is too long").optional(),
    pronouns: z.string().trim().max(50, "Pronouns value is too long").optional(),
    countryCode: z.string().trim().max(2, "Country code must be 2 characters").optional(),
    emergencyContactName: z.string().trim().min(1, "Emergency contact name is required").max(200, "Emergency contact name is too long"),
    emergencyContactPhone: z.string().trim().min(1, "Emergency contact phone is required").max(30, "Emergency contact phone is too long"),
    emergencyContactRelationship: z.string().trim().min(1, "Emergency contact relationship is required").max(100, "Emergency contact relationship is too long"),
    /* Social links (The Crew) */
    socialLinkedin: optionalUrl,
    socialTwitter: optionalUrl,
    socialInstagram: optionalUrl,
    socialGithub: optionalUrl,
    socialTiktok: optionalUrl,
    socialWebsite: optionalUrl,
    /* Favorites (The Crew) */
    favoriteMusic: z.string().trim().max(200, "Favorite music is too long").optional(),
    favoriteBooks: z.string().trim().max(200, "Favorite books is too long").optional(),
    favoriteSports: z.string().trim().max(200, "Favorite sports is too long").optional()
  })
  .superRefine((value, ctx) => {
    const hasBirthdayMonth = value.birthdayMonth !== undefined && value.birthdayMonth !== null;
    const hasBirthdayDay = value.birthdayDay !== undefined && value.birthdayDay !== null;

    if (hasBirthdayMonth !== hasBirthdayDay) {
      ctx.addIssue({
        code: "custom",
        path: ["dateOfBirth"],
        message: "Birthday month and day must be provided together."
      });
    }

    if ((hasBirthdayMonth || hasBirthdayDay) && !value.dateOfBirth) {
      ctx.addIssue({
        code: "custom",
        path: ["dateOfBirth"],
        message: "Please add your birth year before saving your birthday."
      });
      return;
    }

    if (value.dateOfBirth) {
      const parts = getBirthdayParts(value.dateOfBirth);

      if (!parts) {
        ctx.addIssue({
          code: "custom",
          path: ["dateOfBirth"],
          message: "Date of birth must be a real calendar date."
        });
        return;
      }

      if (hasBirthdayMonth && hasBirthdayDay) {
        if (value.birthdayMonth !== parts.month || value.birthdayDay !== parts.day) {
          ctx.addIssue({
            code: "custom",
            path: ["dateOfBirth"],
            message: "Birthday month/day do not match the selected date."
          });
        }
      }
    }
  });

type ProfileResponseData = {
  fullName: string;
  avatarUrl: string | null;
  phone: string | null;
  dateOfBirth: string | null;
  birthdayMonth: number | null;
  birthdayDay: number | null;
  homeAddress: string | null;
  governmentIdUrl: string | null;
  bio: string | null;
  pronouns: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  emergencyContactRelationship: string | null;
  socialLinkedin: string | null;
  socialTwitter: string | null;
  socialInstagram: string | null;
  socialGithub: string | null;
  socialTiktok: string | null;
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

  const birthdayParts = parsed.data.dateOfBirth ? getBirthdayParts(parsed.data.dateOfBirth) : null;

  const serviceClient = createSupabaseServiceRoleClient();

  const { data, error } = await serviceClient
    .from("profiles")
    .update({
      full_name: parsed.data.fullName,
      avatar_url: parsed.data.avatarUrl || null,
      phone: parsed.data.phone || null,
      date_of_birth: parsed.data.dateOfBirth ?? null,
      birthday_month: birthdayParts?.month ?? null,
      birthday_day: birthdayParts?.day ?? null,
      home_address: parsed.data.homeAddress ?? null,
      government_id_url: parsed.data.governmentIdUrl ?? null,
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
      social_tiktok: parsed.data.socialTiktok ?? null,
      social_website: parsed.data.socialWebsite ?? null,
      favorite_music: parsed.data.favoriteMusic ?? null,
      favorite_books: parsed.data.favoriteBooks ?? null,
      favorite_sports: parsed.data.favoriteSports ?? null
    })
    .eq("id", session.profile.id)
    .select(
      `full_name, avatar_url, phone, date_of_birth, birthday_month, birthday_day, home_address, government_id_url, bio, pronouns,
       emergency_contact_name, emergency_contact_phone, emergency_contact_relationship,
       social_linkedin, social_twitter, social_instagram, social_github, social_tiktok, social_website,
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
      dateOfBirth: data.date_of_birth,
      birthdayMonth: data.birthday_month,
      birthdayDay: data.birthday_day,
      homeAddress: data.home_address,
      governmentIdUrl: data.government_id_url,
      bio: data.bio,
      pronouns: data.pronouns,
      emergencyContactName: data.emergency_contact_name,
      emergencyContactPhone: data.emergency_contact_phone,
      emergencyContactRelationship: data.emergency_contact_relationship,
      socialLinkedin: data.social_linkedin,
      socialTwitter: data.social_twitter,
      socialInstagram: data.social_instagram,
      socialGithub: data.social_github,
      socialTiktok: data.social_tiktok,
      socialWebsite: data.social_website,
      favoriteMusic: data.favorite_music,
      favoriteBooks: data.favorite_books,
      favoriteSports: data.favorite_sports
    },
    error: null,
    meta: buildMeta()
  });
}
