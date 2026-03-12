import "server-only";

import * as Sentry from "@sentry/nextjs";
import { cache } from "react";

import { normalizeUserRoles, type UserRole } from "../navigation";
import { createSupabaseServerClient } from "../supabase/server";

export type SessionOrg = {
  id: string;
  name: string;
  logo_url: string | null;
};

export type SessionProfile = {
  id: string;
  org_id: string;
  email: string;
  full_name: string;
  avatar_url: string | null;
  department: string | null;
  phone: string | null;
  notification_preferences: Record<string, unknown> | null;
  roles: UserRole[];
  manager_id: string | null;
  country_code: string | null;
  start_date: string | null;
  employment_type: string | null;
  status: "active" | "inactive" | "onboarding" | "offboarding";
  preferred_locale: string;
  bio: string | null;
  pronouns: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  emergency_contact_relationship: string | null;
  social_linkedin: string | null;
  social_twitter: string | null;
  social_instagram: string | null;
  social_github: string | null;
  social_website: string | null;
  favorite_music: string | null;
  favorite_books: string | null;
  favorite_sports: string | null;
};

export type AuthenticatedSession = {
  userId: string;
  profile: SessionProfile | null;
  org: SessionOrg | null;
};

type GetAuthenticatedSessionOptions = {
  includeOrg?: boolean;
  requireMfa?: boolean;
};

const MFA_VERIFICATION_TTL_MS = 45_000;
const FAILED_MFA_CACHE_TTL_MS = 5_000;
const MAX_MFA_CACHE_ENTRIES = 2_000;
const SESSION_CACHE_TTL_MS = 5_000;
const MAX_SESSION_CACHE_ENTRIES = 2_000;

type MfaVerificationCacheEntry = {
  verified: boolean;
  expiresAt: number;
};

type SessionCacheEntry = {
  value: AuthenticatedSession | null;
  expiresAt: number;
};

const mfaVerificationCache = new Map<string, MfaVerificationCacheEntry>();
const sessionCache = new Map<string, SessionCacheEntry>();

function getCachedMfaVerification(userId: string): boolean | null {
  const cached = mfaVerificationCache.get(userId);

  if (!cached) {
    return null;
  }

  if (cached.expiresAt <= Date.now()) {
    mfaVerificationCache.delete(userId);
    return null;
  }

  return cached.verified;
}

function setCachedMfaVerification(userId: string, verified: boolean): void {
  if (mfaVerificationCache.size >= MAX_MFA_CACHE_ENTRIES) {
    mfaVerificationCache.clear();
  }

  mfaVerificationCache.set(userId, {
    verified,
    expiresAt: Date.now() + (verified ? MFA_VERIFICATION_TTL_MS : FAILED_MFA_CACHE_TTL_MS)
  });
}

function toSessionCacheKey(userId: string, includeOrg: boolean, requireMfa: boolean): string {
  return `${userId}:${includeOrg ? "org" : "no-org"}:${requireMfa ? "mfa" : "no-mfa"}`;
}

function cloneSession(
  session: AuthenticatedSession | null
): AuthenticatedSession | null {
  if (!session) {
    return null;
  }

  return {
    userId: session.userId,
    profile: session.profile
      ? {
          ...session.profile,
          roles: [...session.profile.roles],
          notification_preferences: session.profile.notification_preferences
            ? { ...session.profile.notification_preferences }
            : null
        }
      : null,
    org: session.org
      ? {
          ...session.org
        }
      : null
  };
}

function readSessionCache(cacheKey: string): AuthenticatedSession | null | undefined {
  const cached = sessionCache.get(cacheKey);

  if (!cached) {
    return undefined;
  }

  if (cached.expiresAt <= Date.now()) {
    sessionCache.delete(cacheKey);
    return undefined;
  }

  return cloneSession(cached.value);
}

function writeSessionCache(cacheKey: string, value: AuthenticatedSession | null): void {
  if (sessionCache.size >= MAX_SESSION_CACHE_ENTRIES) {
    sessionCache.clear();
  }

  sessionCache.set(cacheKey, {
    value: cloneSession(value),
    expiresAt: Date.now() + SESSION_CACHE_TTL_MS
  });
}

function hasVerifiedTotpFactor(
  factors: { factor_type?: string; status?: string }[] | undefined
): boolean {
  if (!Array.isArray(factors)) {
    return false;
  }

  return factors.some(
    (factor) => factor.factor_type === "totp" && factor.status === "verified"
  );
}

async function isMfaVerified(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  user: { id: string; factors?: { factor_type?: string; status?: string }[] }
): Promise<boolean> {
  const cachedVerification = getCachedMfaVerification(user.id);

  if (cachedVerification !== null) {
    return cachedVerification;
  }

  let hasVerifiedTotp = hasVerifiedTotpFactor(user.factors);

  if (!hasVerifiedTotp && !Array.isArray(user.factors)) {
    const { data: factorsData, error: factorsError } = await supabase.auth.mfa.listFactors();

    if (factorsError) {
      setCachedMfaVerification(user.id, false);
      return false;
    }

    hasVerifiedTotp = hasVerifiedTotpFactor(factorsData?.all);
  }

  if (!hasVerifiedTotp) {
    setCachedMfaVerification(user.id, false);
    return false;
  }

  const { data: aalData, error: aalError } =
    await supabase.auth.mfa.getAuthenticatorAssuranceLevel();

  const isVerified = !aalError && aalData?.currentLevel === "aal2";
  setCachedMfaVerification(user.id, isVerified);
  return isVerified;
}

const getAuthenticatedSessionInternal = cache(
  async (includeOrg: boolean, requireMfa: boolean): Promise<AuthenticatedSession | null> => {
    let supabase;

    try {
      supabase = await createSupabaseServerClient();
    } catch {
      return null;
    }

    const {
      data: { user },
      error: userError
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return null;
    }

    const sessionCacheKey = toSessionCacheKey(user.id, includeOrg, requireMfa);
    const cachedSession = readSessionCache(sessionCacheKey);

    if (cachedSession !== undefined) {
      return cachedSession;
    }

    if (requireMfa) {
      const mfaVerified = await isMfaVerified(supabase, user);

      if (!mfaVerified) {
        writeSessionCache(sessionCacheKey, null);
        return null;
      }
    }

    const { data: profileData, error: profileError } = await supabase
      .from("profiles")
      .select(
        "id, org_id, email, full_name, avatar_url, department, phone, notification_preferences, roles, manager_id, country_code, start_date, employment_type, status, preferred_locale, bio, pronouns, emergency_contact_name, emergency_contact_phone, emergency_contact_relationship, social_linkedin, social_twitter, social_instagram, social_github, social_website, favorite_music, favorite_books, favorite_sports"
      )
      .eq("id", user.id)
      .is("deleted_at", null)
      .single();

    if (profileError || !profileData) {
      const unresolvedProfileSession = {
        userId: user.id,
        profile: null,
        org: null
      };
      writeSessionCache(sessionCacheKey, unresolvedProfileSession);
      return unresolvedProfileSession;
    }

    const roles = normalizeUserRoles(profileData.roles);

    if (profileData.status === "inactive") {
      writeSessionCache(sessionCacheKey, null);
      return null;
    }

    const profile: SessionProfile = {
      id: profileData.id,
      org_id: profileData.org_id,
      email: profileData.email,
      full_name: profileData.full_name,
      avatar_url: profileData.avatar_url,
      department: profileData.department,
      phone: profileData.phone,
      notification_preferences: profileData.notification_preferences,
      roles,
      manager_id: profileData.manager_id,
      country_code: profileData.country_code,
      start_date: profileData.start_date,
      employment_type: profileData.employment_type,
      status: profileData.status,
      preferred_locale: profileData.preferred_locale ?? "en",
      bio: profileData.bio ?? null,
      pronouns: profileData.pronouns ?? null,
      emergency_contact_name: profileData.emergency_contact_name ?? null,
      emergency_contact_phone: profileData.emergency_contact_phone ?? null,
      emergency_contact_relationship: profileData.emergency_contact_relationship ?? null,
      social_linkedin: profileData.social_linkedin ?? null,
      social_twitter: profileData.social_twitter ?? null,
      social_instagram: profileData.social_instagram ?? null,
      social_github: profileData.social_github ?? null,
      social_website: profileData.social_website ?? null,
      favorite_music: profileData.favorite_music ?? null,
      favorite_books: profileData.favorite_books ?? null,
      favorite_sports: profileData.favorite_sports ?? null
    };

    if (!includeOrg) {
      const sessionWithoutOrg = {
        userId: user.id,
        profile,
        org: null
      };
      writeSessionCache(sessionCacheKey, sessionWithoutOrg);
      return sessionWithoutOrg;
    }

    const { data: orgData, error: orgError } = await supabase
      .from("orgs")
      .select("id, name, logo_url")
      .eq("id", profile.org_id)
      .single();

    if (orgError || !orgData) {
      const sessionWithoutResolvedOrg = {
        userId: user.id,
        profile,
        org: null
      };
      writeSessionCache(sessionCacheKey, sessionWithoutResolvedOrg);
      return sessionWithoutResolvedOrg;
    }

    // Set Sentry context with non-PII data for every authenticated request
    const highestRole = roles.length > 0 ? roles[0] : "EMPLOYEE";
    Sentry.setContext("crew_hub", {
      org_id: profile.org_id,
      user_role: highestRole
    });
    Sentry.setUser({ id: profile.id });

    const resolvedSession = {
      userId: user.id,
      profile,
      org: orgData
    };
    writeSessionCache(sessionCacheKey, resolvedSession);
    return resolvedSession;
  }
);

export async function getAuthenticatedSession(
  options: GetAuthenticatedSessionOptions = {}
): Promise<AuthenticatedSession | null> {
  const includeOrg = options.includeOrg === true;
  const requireMfa = options.requireMfa !== false;

  return getAuthenticatedSessionInternal(includeOrg, requireMfa);
}
