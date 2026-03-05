"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, useMemo, useState } from "react";

import { useUnsavedGuard } from "../../../hooks/use-unsaved-guard";
import { z } from "zod";

import { EmptyState } from "../../../components/shared/empty-state";
import { PageTabs, type PageTab } from "../../../components/shared/page-tabs";
import type { UserRole } from "../../../lib/navigation";
import { type NotificationPreferences, type SettingsTab } from "../../../types/settings";
import { TimePoliciesClient } from "../admin/time-policies/time-policies-client";
import { AuditLogViewer } from "./audit-log-viewer";

type SettingsClientProps = {
  initialTab: SettingsTab;
  profile: {
    fullName: string;
    avatarUrl: string;
    phone: string;
    email: string;
    roles: UserRole[];
    notificationPreferences: NotificationPreferences;
  };
  organization: {
    name: string;
    logoUrl: string;
  };
  canManageOrganization: boolean;
  canViewAudit: boolean;
  canViewTimePolicies: boolean;
};

type ProfileFormValues = {
  fullName: string;
  avatarUrl: string;
  phone: string;
};

type OrganizationFormValues = {
  name: string;
  logoUrl: string;
};

const profileSchema = z.object({
  fullName: z.string().trim().min(1, "Name is required").max(200, "Name is too long"),
  avatarUrl: z
    .string()
    .trim()
    .max(500, "Avatar URL is too long")
    .refine((value) => value.length === 0 || /^https?:\/\//.test(value), {
      message: "Avatar URL must start with http:// or https://"
    }),
  phone: z.string().trim().max(30, "Phone number is too long")
});

const organizationSchema = z.object({
  name: z.string().trim().min(1, "Organization name is required").max(200, "Name is too long"),
  logoUrl: z
    .string()
    .trim()
    .max(500, "Logo URL is too long")
    .refine((value) => value.length === 0 || /^https?:\/\//.test(value), {
      message: "Logo URL must start with http:// or https://"
    })
});

const settingsTabs: PageTab[] = [
  {
    key: "profile",
    label: "Profile"
  },
  {
    key: "notifications",
    label: "Notifications"
  },
  {
    key: "organization",
    label: "Organization",
    requiredRoles: ["SUPER_ADMIN"]
  },
  {
    key: "time-policies",
    label: "Time Policies",
    requiredRoles: ["HR_ADMIN", "SUPER_ADMIN"]
  },
  {
    key: "audit",
    label: "Audit Log",
    requiredRoles: ["HR_ADMIN", "FINANCE_ADMIN", "SUPER_ADMIN"]
  }
];

function validateProfile(values: ProfileFormValues) {
  const parsed = profileSchema.safeParse(values);

  if (parsed.success) {
    return {};
  }

  const fieldErrors = parsed.error.flatten().fieldErrors;
  return {
    fullName: fieldErrors.fullName?.[0],
    avatarUrl: fieldErrors.avatarUrl?.[0],
    phone: fieldErrors.phone?.[0]
  };
}

function validateOrganization(values: OrganizationFormValues) {
  const parsed = organizationSchema.safeParse(values);

  if (parsed.success) {
    return {};
  }

  const fieldErrors = parsed.error.flatten().fieldErrors;
  return {
    name: fieldErrors.name?.[0],
    logoUrl: fieldErrors.logoUrl?.[0]
  };
}

function hasErrors(errors: Record<string, string | undefined>): boolean {
  return Object.values(errors).some((error) => Boolean(error));
}

export function SettingsClient({
  initialTab,
  profile,
  organization,
  canManageOrganization,
  canViewAudit,
  canViewTimePolicies
}: SettingsClientProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  const userRoles = profile.roles;

  const visibleTabs = useMemo(
    () =>
      settingsTabs.filter((tab) => {
        if (tab.key === "organization") {
          return canManageOrganization;
        }

        if (tab.key === "time-policies") {
          return canViewTimePolicies;
        }

        if (tab.key === "audit") {
          return canViewAudit;
        }

        return true;
      }),
    [canManageOrganization, canViewAudit, canViewTimePolicies]
  );

  const fallbackTab = (visibleTabs[0]?.key as SettingsTab | undefined) ?? "profile";
  const initialActiveTab = visibleTabs.some((tab) => tab.key === initialTab)
    ? initialTab
    : fallbackTab;

  const [activeTab, setActiveTab] = useState<SettingsTab>(initialActiveTab);

  const [profileValues, setProfileValues] = useState<ProfileFormValues>({
    fullName: profile.fullName,
    avatarUrl: profile.avatarUrl,
    phone: profile.phone
  });
  const [profileErrors, setProfileErrors] = useState<Record<string, string | undefined>>({});
  const [profileMessage, setProfileMessage] = useState<string | null>(null);
  const [isProfileSaving, setIsProfileSaving] = useState(false);

  const [organizationValues, setOrganizationValues] = useState<OrganizationFormValues>({
    name: organization.name,
    logoUrl: organization.logoUrl
  });
  const [organizationErrors, setOrganizationErrors] = useState<Record<string, string | undefined>>(
    {}
  );
  const [organizationMessage, setOrganizationMessage] = useState<string | null>(null);
  const [isOrganizationSaving, setIsOrganizationSaving] = useState(false);

  const [notificationValues, setNotificationValues] = useState<NotificationPreferences>(
    profile.notificationPreferences
  );
  const [notificationMessage, setNotificationMessage] = useState<string | null>(null);
  const [isNotificationSaving, setIsNotificationSaving] = useState(false);

  const [formDirty, setFormDirty] = useState(false);
  useUnsavedGuard(formDirty);

  const handleTabChange = (tabKey: string) => {
    const nextTab = tabKey as SettingsTab;
    setActiveTab(nextTab);

    const nextParams = new URLSearchParams(searchParams.toString());

    if (nextTab === "profile") {
      nextParams.delete("tab");
    } else {
      nextParams.set("tab", nextTab);
    }

    const queryString = nextParams.toString();
    router.replace(queryString.length > 0 ? `${pathname}?${queryString}` : pathname, {
      scroll: false
    });
  };

  const handleProfileSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const errors = validateProfile(profileValues);
    setProfileErrors(errors);

    if (hasErrors(errors)) {
      return;
    }

    setProfileMessage(null);
    setIsProfileSaving(true);

    try {
      const response = await fetch("/api/v1/settings/profile", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(profileValues)
      });

      const payload = (await response.json()) as {
        error: { message: string } | null;
      };

      if (!response.ok) {
        setProfileMessage(payload.error?.message ?? "Unable to update profile settings.");
        return;
      }

      setProfileMessage("Profile settings saved.");
      setFormDirty(false);
    } catch (error) {
      setProfileMessage(error instanceof Error ? error.message : "Unable to update profile settings.");
    } finally {
      setIsProfileSaving(false);
    }
  };

  const handleOrganizationSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const errors = validateOrganization(organizationValues);
    setOrganizationErrors(errors);

    if (hasErrors(errors)) {
      return;
    }

    setOrganizationMessage(null);
    setIsOrganizationSaving(true);

    try {
      const response = await fetch("/api/v1/settings/organization", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(organizationValues)
      });

      const payload = (await response.json()) as {
        error: { message: string } | null;
      };

      if (!response.ok) {
        setOrganizationMessage(
          payload.error?.message ?? "Unable to update organization settings."
        );
        return;
      }

      setOrganizationMessage("Organization settings saved.");
      setFormDirty(false);
    } catch (error) {
      setOrganizationMessage(
        error instanceof Error ? error.message : "Unable to update organization settings."
      );
    } finally {
      setIsOrganizationSaving(false);
    }
  };

  const handleNotificationsSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    setNotificationMessage(null);
    setIsNotificationSaving(true);

    try {
      const response = await fetch("/api/v1/settings/notifications", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(notificationValues)
      });

      const payload = (await response.json()) as {
        error: { message: string } | null;
      };

      if (!response.ok) {
        setNotificationMessage(
          payload.error?.message ?? "Unable to update notification settings."
        );
        return;
      }

      setNotificationMessage("Notification settings saved.");
      setFormDirty(false);
    } catch (error) {
      setNotificationMessage(
        error instanceof Error ? error.message : "Unable to update notification settings."
      );
    } finally {
      setIsNotificationSaving(false);
    }
  };

  return (
    <section className="settings-layout" aria-label="Settings tabs">
      <PageTabs
        tabs={settingsTabs}
        activeTab={activeTab}
        onTabChange={handleTabChange}
        userRoles={userRoles}
      />

      <div className="settings-content">
        {activeTab === "profile" ? (
          <section className="settings-card" aria-label="Profile settings">
            <h2 className="section-title">Profile</h2>
            <p className="settings-card-description">Update your personal contact information.</p>

            <form className="settings-form" onSubmit={handleProfileSubmit} noValidate>
              <label className="form-field" htmlFor="profile-full-name">
                <span className="form-label">Full name</span>
                <input
                  id="profile-full-name"
                  className={
                    profileErrors.fullName ? "form-input form-input-error" : "form-input"
                  }
                  value={profileValues.fullName}
                  onChange={(event) => {
                    const nextValues = {
                      ...profileValues,
                      fullName: event.currentTarget.value
                    };

                    setProfileValues(nextValues);
                    setProfileErrors(validateProfile(nextValues));
                    setFormDirty(true);
                  }}
                />
                {profileErrors.fullName ? (
                  <p className="form-field-error">{profileErrors.fullName}</p>
                ) : null}
              </label>

              <label className="form-field" htmlFor="profile-avatar-url">
                <span className="form-label">Avatar URL</span>
                <input
                  id="profile-avatar-url"
                  className={
                    profileErrors.avatarUrl ? "form-input form-input-error" : "form-input"
                  }
                  value={profileValues.avatarUrl}
                  onChange={(event) => {
                    const nextValues = {
                      ...profileValues,
                      avatarUrl: event.currentTarget.value
                    };

                    setProfileValues(nextValues);
                    setProfileErrors(validateProfile(nextValues));
                    setFormDirty(true);
                  }}
                />
                {profileErrors.avatarUrl ? (
                  <p className="form-field-error">{profileErrors.avatarUrl}</p>
                ) : null}
              </label>

              <label className="form-field" htmlFor="profile-phone">
                <span className="form-label">Phone</span>
                <input
                  id="profile-phone"
                  className={profileErrors.phone ? "form-input form-input-error" : "form-input"}
                  value={profileValues.phone}
                  onChange={(event) => {
                    const nextValues = {
                      ...profileValues,
                      phone: event.currentTarget.value
                    };

                    setProfileValues(nextValues);
                    setProfileErrors(validateProfile(nextValues));
                    setFormDirty(true);
                  }}
                />
                {profileErrors.phone ? (
                  <p className="form-field-error">{profileErrors.phone}</p>
                ) : null}
              </label>

              <label className="form-field" htmlFor="profile-email">
                <span className="form-label">Email</span>
                <input id="profile-email" className="form-input" value={profile.email} disabled />
              </label>

              <div className="settings-actions">
                <button type="submit" className="button button-accent" disabled={isProfileSaving}>
                  {isProfileSaving ? "Saving..." : "Save profile"}
                </button>
              </div>

              {profileMessage ? <p className="settings-feedback">{profileMessage}</p> : null}
            </form>
          </section>
        ) : null}

        {activeTab === "notifications" ? (
          <section className="settings-card" aria-label="Notification settings">
            <h2 className="section-title">Notifications</h2>
            <p className="settings-card-description">
              Choose how you receive updates from Crew Hub modules.
            </p>

            <form className="settings-form" onSubmit={handleNotificationsSubmit}>
              <label className="settings-checkbox">
                <input
                  type="checkbox"
                  checked={notificationValues.emailAnnouncements}
                  onChange={(event) => {
                    setNotificationValues((previous) => ({
                      ...previous,
                      emailAnnouncements: event.currentTarget.checked
                    }));
                    setFormDirty(true);
                  }}
                />
                <span>Email announcements</span>
              </label>

              <label className="settings-checkbox">
                <input
                  type="checkbox"
                  checked={notificationValues.emailApprovals}
                  onChange={(event) => {
                    setNotificationValues((previous) => ({
                      ...previous,
                      emailApprovals: event.currentTarget.checked
                    }));
                    setFormDirty(true);
                  }}
                />
                <span>Email approval requests</span>
              </label>

              <label className="settings-checkbox">
                <input
                  type="checkbox"
                  checked={notificationValues.inAppReminders}
                  onChange={(event) => {
                    setNotificationValues((previous) => ({
                      ...previous,
                      inAppReminders: event.currentTarget.checked
                    }));
                    setFormDirty(true);
                  }}
                />
                <span>In-app reminders</span>
              </label>

              <div className="settings-actions">
                <button
                  type="submit"
                  className="button button-accent"
                  disabled={isNotificationSaving}
                >
                  {isNotificationSaving ? "Saving..." : "Save notifications"}
                </button>
              </div>

              {notificationMessage ? <p className="settings-feedback">{notificationMessage}</p> : null}
            </form>
          </section>
        ) : null}

        {activeTab === "organization" ? (
          canManageOrganization ? (
            <section className="settings-card" aria-label="Organization settings">
              <h2 className="section-title">Organization</h2>
              <p className="settings-card-description">
                Manage organization branding for Crew Hub.
              </p>

              <form className="settings-form" onSubmit={handleOrganizationSubmit} noValidate>
                <label className="form-field" htmlFor="organization-name">
                  <span className="form-label">Organization name</span>
                  <input
                    id="organization-name"
                    className={
                      organizationErrors.name ? "form-input form-input-error" : "form-input"
                    }
                    value={organizationValues.name}
                    onChange={(event) => {
                      const nextValues = {
                        ...organizationValues,
                        name: event.currentTarget.value
                      };

                      setOrganizationValues(nextValues);
                      setOrganizationErrors(validateOrganization(nextValues));
                      setFormDirty(true);
                    }}
                  />
                  {organizationErrors.name ? (
                    <p className="form-field-error">{organizationErrors.name}</p>
                  ) : null}
                </label>

                <label className="form-field" htmlFor="organization-logo-url">
                  <span className="form-label">Logo URL</span>
                  <input
                    id="organization-logo-url"
                    className={
                      organizationErrors.logoUrl ? "form-input form-input-error" : "form-input"
                    }
                    value={organizationValues.logoUrl}
                    onChange={(event) => {
                      const nextValues = {
                        ...organizationValues,
                        logoUrl: event.currentTarget.value
                      };

                      setOrganizationValues(nextValues);
                      setOrganizationErrors(validateOrganization(nextValues));
                      setFormDirty(true);
                    }}
                  />
                  {organizationErrors.logoUrl ? (
                    <p className="form-field-error">{organizationErrors.logoUrl}</p>
                  ) : null}
                </label>

                <div className="settings-actions">
                  <button
                    type="submit"
                    className="button button-accent"
                    disabled={isOrganizationSaving}
                  >
                    {isOrganizationSaving ? "Saving..." : "Save organization"}
                  </button>
                </div>

                {organizationMessage ? (
                  <p className="settings-feedback">{organizationMessage}</p>
                ) : null}
              </form>
            </section>
          ) : (
            <EmptyState
              title="Organization settings are restricted"
              description="Only a Super Admin can edit organization name and logo."
              ctaLabel="Back to profile"
              ctaHref="/settings"
            />
          )
        ) : null}

        {activeTab === "time-policies" ? (
          canViewTimePolicies ? (
            <TimePoliciesClient embedded />
          ) : (
            <EmptyState
              title="Time policies are restricted"
              description="Only HR Admin and Super Admin can review attendance policies."
              ctaLabel="Back to settings"
              ctaHref="/settings"
            />
          )
        ) : null}

        {activeTab === "audit" ? (
          canViewAudit ? (
            <AuditLogViewer />
          ) : (
            <EmptyState
              title="Audit log is restricted"
              description="Only HR Admin, Finance Admin, and Super Admin can view audit history."
              ctaLabel="Back to settings"
              ctaHref="/settings"
            />
          )
        ) : null}
      </div>
    </section>
  );
}
