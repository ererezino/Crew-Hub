import { NextResponse } from "next/server";
import { z } from "zod";

import { USER_ROLES } from "../navigation";
import type { ApiResponse, AppRole } from "../../types/auth";
import {
  EMPLOYMENT_TYPES,
  PAYROLL_MODES,
  PROFILE_STATUSES,
  type PersonRecord,
  type PrivacySettings
} from "../../types/people";

// ── Response helpers ──

export function buildMeta() {
  return { timestamp: new Date().toISOString() };
}

export function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return NextResponse.json(payload, { status });
}

// ── Role normalization ──

export function normalizeRoles(values: readonly string[]): AppRole[] {
  return values.filter((value): value is AppRole =>
    USER_ROLES.includes(value as AppRole)
  );
}

// ── Access status derivation ──

export function deriveAccessStatus(
  crewHubJoinedAt: string | null,
  firstInvitedAt: string | null
): "signed_in" | "invited" | "not_invited" {
  // Three-state model based on application-managed fields:
  // - "signed_in"   = crew_hub_joined_at IS NOT NULL (first real sign-in recorded)
  // - "invited"     = first_invited_at IS NOT NULL AND crew_hub_joined_at IS NULL
  // - "not_invited" = both are NULL
  if (crewHubJoinedAt) return "signed_in";
  if (firstInvitedAt) return "invited";
  return "not_invited";
}

// ── Profile row schema (superset) ──
//
// This schema is the union of all fields selected by both the list route
// and the detail route. Fields that may be absent from a particular query
// use `.default(null)` so the schema parses successfully regardless of
// which SELECT was used.

export const profileRowSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  full_name: z.string(),
  roles: z.array(z.string()),
  department: z.string().nullable(),
  title: z.string().nullable(),
  country_code: z.string().nullable(),
  timezone: z.string().nullable(),
  phone: z.string().nullable(),
  start_date: z.string().nullable(),
  // detail-only: absent from list SELECT → defaults to null
  date_of_birth: z.string().nullable().optional().default(null),
  manager_id: z.string().uuid().nullable(),
  employment_type: z.enum(EMPLOYMENT_TYPES),
  payroll_mode: z.enum(PAYROLL_MODES),
  primary_currency: z.string(),
  status: z.enum(PROFILE_STATUSES),
  // detail-only: absent from list SELECT → defaults to null
  notice_period_end_date: z.string().nullable().optional().default(null),
  bio: z.string().nullable().default(null),
  favorite_music: z.string().nullable().default(null),
  favorite_books: z.string().nullable().default(null),
  favorite_sports: z.string().nullable().default(null),
  avatar_url: z.string().nullable().default(null),
  emergency_contact_name: z.string().nullable().default(null),
  emergency_contact_phone: z.string().nullable().default(null),
  emergency_contact_relationship: z.string().nullable().default(null),
  pronouns: z.string().nullable().default(null),
  directory_visible: z.boolean().default(true),
  // Both routes return this as a JSON object; use z.unknown() to
  // accept both the list route's record shape and the detail route's
  // unknown shape. The mapper normalizes it.
  privacy_settings: z.unknown().default(null),
  schedule_type: z.string().nullable().optional().default(null),
  weekend_shift_hours: z.string().nullable().optional().default(null),
  // list-only: absent from detail SELECT → defaults to null
  social_linkedin: z.string().nullable().optional().default(null),
  social_twitter: z.string().nullable().optional().default(null),
  social_instagram: z.string().nullable().optional().default(null),
  social_github: z.string().nullable().optional().default(null),
  social_website: z.string().nullable().optional().default(null),
  crew_hub_joined_at: z.string().nullable().default(null),
  first_invited_at: z.string().nullable().default(null),
  account_setup_at: z.string().nullable().default(null),
  last_seen_at: z.string().nullable().default(null),
  created_at: z.string(),
  updated_at: z.string()
});

export type ProfileRow = z.infer<typeof profileRowSchema>;

// ── Profile row → PersonRecord mapper ──
//
// Callers resolve `crewTag` before calling — the list route looks it up
// from a Map<string, string>, the detail route passes a string | null.

export function mapProfileRow(
  row: ProfileRow,
  managerNameById: ReadonlyMap<string, string>,
  crewTag: string | null
): PersonRecord {
  const privacySettings: PrivacySettings =
    row.privacy_settings &&
    typeof row.privacy_settings === "object" &&
    !Array.isArray(row.privacy_settings)
      ? (row.privacy_settings as PrivacySettings)
      : {};

  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    roles: normalizeRoles(row.roles),
    department: row.department,
    title: row.title,
    countryCode: row.country_code,
    timezone: row.timezone,
    phone: row.phone,
    startDate: row.start_date,
    dateOfBirth: row.date_of_birth ?? null,
    managerId: row.manager_id,
    managerName: row.manager_id ? managerNameById.get(row.manager_id) ?? null : null,
    employmentType: row.employment_type,
    payrollMode: row.payroll_mode,
    primaryCurrency: row.primary_currency,
    status: row.status,
    noticePeriodEndDate: row.notice_period_end_date ?? null,
    avatarUrl: row.avatar_url ?? null,
    bio: row.bio ?? null,
    favoriteMusic: row.favorite_music ?? null,
    favoriteBooks: row.favorite_books ?? null,
    favoriteSports: row.favorite_sports ?? null,
    emergencyContactName: row.emergency_contact_name ?? null,
    emergencyContactPhone: row.emergency_contact_phone ?? null,
    emergencyContactRelationship: row.emergency_contact_relationship ?? null,
    pronouns: row.pronouns ?? null,
    socialLinkedin: row.social_linkedin ?? null,
    socialTwitter: row.social_twitter ?? null,
    socialInstagram: row.social_instagram ?? null,
    socialGithub: row.social_github ?? null,
    socialWebsite: row.social_website ?? null,
    directoryVisible: row.directory_visible,
    privacySettings,
    scheduleType: row.schedule_type ?? null,
    weekendShiftHours: row.weekend_shift_hours ?? null,
    crewTag,
    accessStatus: deriveAccessStatus(row.crew_hub_joined_at, row.first_invited_at),
    crewHubJoinedAt: row.crew_hub_joined_at,
    firstInvitedAt: row.first_invited_at,
    accountSetupAt: row.account_setup_at,
    lastSeenAt: row.last_seen_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
