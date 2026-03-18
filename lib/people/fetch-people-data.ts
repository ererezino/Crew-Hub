import "server-only";

import { z } from "zod";

import type { SessionProfile } from "../auth/session";
import { hasRole } from "../roles";
import { createSupabaseServerClient } from "../supabase/server";
import { profileRowSchema, mapProfileRow } from "./shared";
import type { PeopleListResponseData } from "../../types/people";
import type { UserRole } from "../navigation";

/* ── Scope resolution ── */

export type PeopleScope = "all" | "reports" | "me";

function canViewAllPeople(roles: readonly UserRole[]): boolean {
  return (
    hasRole(roles, "HR_ADMIN") ||
    hasRole(roles, "FINANCE_ADMIN") ||
    hasRole(roles, "FINANCE_APPROVER") ||
    hasRole(roles, "SUPER_ADMIN")
  );
}

function canViewReports(roles: readonly UserRole[]): boolean {
  return hasRole(roles, "MANAGER") || hasRole(roles, "TEAM_LEAD") || canViewAllPeople(roles);
}

/* ── Query params ── */

export type PeopleQuery = {
  scope?: PeopleScope;
  limit?: number;
};

/* ── Main data-fetching function ── */

/**
 * Fetch the People list for the given session profile and scope.
 * Returns the same `PeopleListResponseData` shape the client expects.
 * Throws on unrecoverable errors so the caller can handle them.
 */
export async function fetchPeopleData(
  profile: SessionProfile,
  query: PeopleQuery = {},
  hasConfigAccess = false
): Promise<PeopleListResponseData> {
  const limit = query.limit ?? 250;
  let scope = query.scope ?? "all";

  // Enforce scope access rules
  if (scope === "all" && !canViewAllPeople(profile.roles) && !hasConfigAccess) {
    scope = canViewReports(profile.roles) ? "reports" : "me";
  }

  if (scope === "reports" && !canViewReports(profile.roles)) {
    scope = "me";
  }

  const supabase = await createSupabaseServerClient();

  // Resolve report IDs for scoped queries
  let reportsUserIds: string[] = [];

  if (scope === "reports") {
    if (hasRole(profile.roles, "MANAGER")) {
      const { data: reportRows, error: reportError } = await supabase
        .from("profiles")
        .select("id")
        .eq("org_id", profile.org_id)
        .is("deleted_at", null)
        .eq("manager_id", profile.id);

      if (reportError) {
        throw new Error("Unable to load manager reports.");
      }

      reportsUserIds = [
        profile.id,
        ...(reportRows ?? [])
          .map((row) => row.id)
          .filter((value): value is string => typeof value === "string")
      ];
    } else if (hasRole(profile.roles, "TEAM_LEAD") && profile.department) {
      const { data: deptRows, error: deptError } = await supabase
        .from("profiles")
        .select("id")
        .eq("org_id", profile.org_id)
        .is("deleted_at", null)
        .ilike("department", profile.department);

      if (deptError) {
        throw new Error("Unable to load department members.");
      }

      reportsUserIds = [
        profile.id,
        ...(deptRows ?? [])
          .map((row) => row.id)
          .filter((value): value is string => typeof value === "string")
      ];
    }
  }

  const PEOPLE_SELECT_FULL =
    "id, email, full_name, roles, department, title, country_code, timezone, phone, start_date, manager_id, team_lead_id, employment_type, payroll_mode, primary_currency, status, notice_period_end_date, avatar_url, directory_visible, schedule_type, weekend_shift_hours, bio, pronouns, emergency_contact_name, emergency_contact_phone, emergency_contact_relationship, favorite_music, favorite_books, favorite_sports, privacy_settings, social_linkedin, social_twitter, social_instagram, social_github, social_website, crew_hub_joined_at, first_invited_at, account_setup_at, last_seen_at, created_at, updated_at";
  const PEOPLE_SELECT_COMPAT =
    "id, email, full_name, roles, department, title, country_code, timezone, phone, start_date, manager_id, team_lead_id, employment_type, payroll_mode, primary_currency, status, notice_period_end_date, avatar_url, directory_visible, bio, pronouns, emergency_contact_name, emergency_contact_phone, emergency_contact_relationship, favorite_music, favorite_books, favorite_sports, privacy_settings, social_linkedin, social_twitter, social_instagram, social_github, social_website, crew_hub_joined_at, first_invited_at, account_setup_at, last_seen_at, created_at, updated_at";

  function buildPeopleQuery(selectString: string) {
    let q = supabase
      .from("profiles")
      .select(selectString)
      .eq("org_id", profile.org_id)
      .is("deleted_at", null)
      .order("full_name", { ascending: true })
      .limit(limit);

    if (scope === "me") {
      q = q.eq("id", profile.id);
    }

    if (scope === "reports") {
      q = q.in("id", reportsUserIds.length > 0 ? reportsUserIds : [profile.id]);
    }

    return q;
  }

  let { data: rawPeople, error: peopleError } = await buildPeopleQuery(PEOPLE_SELECT_FULL);

  // Fallback: if the query fails (e.g. schedule_type/weekend_shift_hours columns
  // don't exist yet), retry without those columns
  if (peopleError) {
    const fallback = await buildPeopleQuery(PEOPLE_SELECT_COMPAT);
    rawPeople = fallback.data;
    peopleError = fallback.error;
  }

  if (peopleError) {
    throw new Error("Unable to load people records.");
  }

  const parsedPeople = z.array(profileRowSchema).safeParse(rawPeople ?? []);

  if (!parsedPeople.success) {
    throw new Error("People data is not in the expected shape.");
  }

  // Resolve manager/team lead names
  const lookupIds = [
    ...new Set(
      parsedPeople.data
        .flatMap((row) => [row.manager_id, row.team_lead_id ?? null])
        .filter((value): value is string => Boolean(value))
    )
  ];

  let nameById = new Map<string, string>();

  if (lookupIds.length > 0) {
    const { data: nameRows, error: namesError } = await supabase
      .from("profiles")
      .select("id, full_name")
      .eq("org_id", profile.org_id)
      .is("deleted_at", null)
      .in("id", lookupIds);

    if (namesError) {
      throw new Error("Unable to load manager details.");
    }

    nameById = new Map(
      (nameRows ?? [])
        .filter(
          (row): row is { id: string; full_name: string } =>
            typeof row?.id === "string" && typeof row?.full_name === "string"
        )
        .map((row) => [row.id, row.full_name])
    );
  }

  // Fetch crew tags (admin only)
  const profileIds = parsedPeople.data.map((row) => row.id);
  let crewTagById = new Map<string, string>();

  if (profileIds.length > 0 && canViewAllPeople(profile.roles)) {
    const { data: paymentRows } = await supabase
      .from("employee_payment_details")
      .select("employee_id, crew_tag")
      .eq("org_id", profile.org_id)
      .in("employee_id", profileIds)
      .not("crew_tag", "is", null);

    if (paymentRows) {
      crewTagById = new Map(
        paymentRows
          .filter(
            (row): row is { employee_id: string; crew_tag: string } =>
              typeof row?.employee_id === "string" && typeof row?.crew_tag === "string"
          )
          .map((row) => [row.employee_id, row.crew_tag])
      );
    }
  }

  const people = parsedPeople.data.map((row) =>
    mapProfileRow(row, nameById, crewTagById.get(row.id) ?? null)
  );

  return { people };
}
