import { EmptyState } from "../../../components/shared/empty-state";
import { PageHeader } from "../../../components/shared/page-header";
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
  return {
    emailAnnouncements: Boolean(value?.emailAnnouncements),
    emailApprovals: Boolean(value?.emailApprovals),
    inAppReminders: Boolean(value?.inAppReminders)
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
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return (
      <>
        <PageHeader
          title="Settings"
          description="Profile, workspace preferences, and admin controls."
        />
        <EmptyState
          title="Profile is unavailable"
          description="No profile is linked to this account yet."
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
        title="Settings"
        description="Profile, workspace preferences, and admin controls."
      />

      <SettingsClient
        initialTab={requestedTab}
        profile={{
          fullName: session.profile.full_name,
          avatarUrl: session.profile.avatar_url ?? "",
          phone: session.profile.phone ?? "",
          email: session.profile.email,
          roles: session.profile.roles,
          notificationPreferences: normalizeNotificationPreferences(
            session.profile.notification_preferences
          )
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
