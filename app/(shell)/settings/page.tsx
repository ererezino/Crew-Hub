import { getTranslations } from "next-intl/server";

import { EmptyState } from "../../../components/shared/empty-state";
import { PageHeader } from "../../../components/shared/page-header";
import { DEFAULT_LOCALE, type AppLocale } from "../../../i18n/locales";
import { getAuthenticatedSession } from "../../../lib/auth/session";
import { hasRole } from "../../../lib/roles";
import { SETTINGS_TABS, type NotificationPreferences, type SettingsTab } from "../../../types/settings";
import { SettingsClient } from "./settings-client";

type SettingsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function normalizeNotificationPreferences(
  value: Record<string, unknown> | null
): NotificationPreferences {
  /* Default all preferences to ON when never explicitly set (null/undefined).
     Only respect an explicit `false` — any other value (including absence) = enabled. */
  return {
    emailAnnouncements: value?.emailAnnouncements !== false,
    emailApprovals: value?.emailApprovals !== false,
    inAppReminders: value?.inAppReminders !== false,
    browserPush: value?.browserPush === true /* Browser push still defaults OFF — requires explicit opt-in via permission grant */
  };
}

function resolveTab(searchParams: Record<string, string | string[] | undefined>): SettingsTab {
  const rawTab = searchParams.tab;

  if (typeof rawTab !== "string") {
    return "profile";
  }

  return SETTINGS_TABS.includes(rawTab as SettingsTab)
    ? (rawTab as SettingsTab)
    : "profile";
}

export default async function SettingsPage({ searchParams }: SettingsPageProps) {
  const session = await getAuthenticatedSession({ includeOrg: true });
  const tSettings = await getTranslations('settings');

  if (!session?.profile) {
    const t = await getTranslations('common');
    return (
      <>
        <PageHeader
          title={tSettings('title')}
          description={tSettings('fallbackDescription')}
        />
        <EmptyState
          title={t('emptyState.profileUnavailable')}
          description={t('emptyState.profileUnavailableBody')}
        />
      </>
    );
  }

  const resolvedSearchParams = await searchParams;
  const requestedTab = resolveTab(resolvedSearchParams);

  const canManageOrganization = hasRole(session.profile.roles, "SUPER_ADMIN");
  const canViewAudit =
    hasRole(session.profile.roles, "HR_ADMIN") ||
    hasRole(session.profile.roles, "FINANCE_ADMIN") ||
    hasRole(session.profile.roles, "SUPER_ADMIN");
  const canViewTimePolicies =
    hasRole(session.profile.roles, "HR_ADMIN") ||
    hasRole(session.profile.roles, "SUPER_ADMIN");

  return (
    <>
      <PageHeader
        title={tSettings('title')}
        description={tSettings('description')}
      />

      <SettingsClient
        initialTab={requestedTab}
        preferredLocale={(session.profile.preferred_locale ?? DEFAULT_LOCALE) as AppLocale}
        profile={{
          fullName: session.profile.full_name,
          avatarUrl: session.profile.avatar_url ?? "",
          phone: session.profile.phone ?? "",
          email: session.profile.email,
          roles: session.profile.roles,
          notificationPreferences: normalizeNotificationPreferences(
            session.profile.notification_preferences
          ),
          bio: session.profile.bio ?? "",
          pronouns: session.profile.pronouns ?? "",
          countryCode: session.profile.country_code ?? "",
          emergencyContactName: session.profile.emergency_contact_name ?? "",
          emergencyContactPhone: session.profile.emergency_contact_phone ?? "",
          emergencyContactRelationship: session.profile.emergency_contact_relationship ?? "",
          socialLinkedin: session.profile.social_linkedin ?? "",
          socialTwitter: session.profile.social_twitter ?? "",
          socialInstagram: session.profile.social_instagram ?? "",
          socialGithub: session.profile.social_github ?? "",
          socialWebsite: session.profile.social_website ?? "",
          favoriteMusic: session.profile.favorite_music ?? "",
          favoriteBooks: session.profile.favorite_books ?? "",
          favoriteSports: session.profile.favorite_sports ?? ""
        }}
        organization={{
          name: session.org?.name ?? "",
          logoUrl: session.org?.logo_url ?? ""
        }}
        canManageOrganization={canManageOrganization}
        canViewAudit={canViewAudit}
        canViewTimePolicies={canViewTimePolicies}
      />
    </>
  );
}
