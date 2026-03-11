"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { type ChangeEvent, type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { useUnsavedGuard } from "../../../hooks/use-unsaved-guard";
import { z } from "zod";

import { EmptyState } from "../../../components/shared/empty-state";
import { PageTabs, type PageTab } from "../../../components/shared/page-tabs";
import { LOCALE_META, SUPPORTED_LOCALES, type AppLocale } from "../../../i18n/locales";
import { updateLocale } from "../../../lib/i18n/update-locale";
import type { UserRole } from "../../../lib/navigation";
import { type NotificationPreferences, type SettingsTab } from "../../../types/settings";
import { AuditLogViewer } from "./audit-log-viewer";

const BROWSER_PUSH_PREF_KEY = "crewhub-browser-push-enabled";

type SettingsClientProps = {
  initialTab: SettingsTab;
  preferredLocale: AppLocale;
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
  phone: string;
};

type OrganizationFormValues = {
  name: string;
};

function makeProfileSchema(msgs: { nameRequired: string; nameTooLong: string; phoneTooLong: string }) {
  return z.object({
    fullName: z.string().trim().min(1, msgs.nameRequired).max(200, msgs.nameTooLong),
    phone: z.string().trim().max(30, msgs.phoneTooLong)
  });
}

function makeOrganizationSchema(msgs: { orgNameRequired: string; nameTooLong: string }) {
  return z.object({
    name: z.string().trim().min(1, msgs.orgNameRequired).max(200, msgs.nameTooLong)
  });
}

function validateProfile(values: ProfileFormValues, schema: ReturnType<typeof makeProfileSchema>) {
  const parsed = schema.safeParse(values);

  if (parsed.success) {
    return {};
  }

  const fieldErrors = parsed.error.flatten().fieldErrors;
  return {
    fullName: fieldErrors.fullName?.[0],
    phone: fieldErrors.phone?.[0]
  };
}

function validateOrganization(values: OrganizationFormValues, schema: ReturnType<typeof makeOrganizationSchema>) {
  const parsed = schema.safeParse(values);

  if (parsed.success) {
    return {};
  }

  const fieldErrors = parsed.error.flatten().fieldErrors;
  return {
    name: fieldErrors.name?.[0]
  };
}

function hasErrors(errors: Record<string, string | undefined>): boolean {
  return Object.values(errors).some((error) => Boolean(error));
}

function getInitials(fullName: string): string {
  const tokens = fullName.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return "CH";
  if (tokens.length === 1) return tokens[0].slice(0, 2).toUpperCase();
  return `${tokens[0][0] ?? ""}${tokens[1][0] ?? ""}`.toUpperCase();
}

export function SettingsClient({
  initialTab,
  preferredLocale,
  profile,
  organization,
  canManageOrganization,
  canViewAudit,
  canViewTimePolicies: _canViewTimePolicies
}: SettingsClientProps) {
  const t = useTranslations('settings');
  const tCommon = useTranslations('common');
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  const userRoles = profile.roles;

  const settingsTabs = useMemo<PageTab[]>(() => [
    { key: "profile", label: t('tab.profile') },
    { key: "notifications", label: t('tab.preferences') },
    { key: "security", label: t('tab.security') },
    { key: "organization", label: t('tab.organization'), requiredRoles: ["SUPER_ADMIN"] },
    { key: "audit", label: t('tab.auditLog'), requiredRoles: ["HR_ADMIN", "SUPER_ADMIN"] }
  ], [t]);

  const profileSchema = useMemo(() => makeProfileSchema({
    nameRequired: t('validation.nameRequired'),
    nameTooLong: t('validation.nameTooLong'),
    phoneTooLong: t('validation.phoneTooLong')
  }), [t]);

  const organizationSchema = useMemo(() => makeOrganizationSchema({
    orgNameRequired: t('validation.orgNameRequired'),
    nameTooLong: t('validation.nameTooLong')
  }), [t]);

  const visibleTabs = useMemo(
    () =>
      settingsTabs.filter((tab) => {
        if (tab.key === "organization") {
          return canManageOrganization;
        }

        if (tab.key === "audit") {
          return canViewAudit;
        }

        return true;
      }),
    [settingsTabs, canManageOrganization, canViewAudit]
  );

  const fallbackTab = (visibleTabs[0]?.key as SettingsTab | undefined) ?? "profile";
  const initialActiveTab = visibleTabs.some((tab) => tab.key === initialTab)
    ? initialTab
    : fallbackTab;

  const [activeTab, setActiveTab] = useState<SettingsTab>(initialActiveTab);

  const [profileValues, setProfileValues] = useState<ProfileFormValues>({
    fullName: profile.fullName,
    phone: profile.phone
  });
  const [profileErrors, setProfileErrors] = useState<Record<string, string | undefined>>({});
  const [profileMessage, setProfileMessage] = useState<string | null>(null);
  const [isProfileSaving, setIsProfileSaving] = useState(false);

  // Avatar upload state
  const [avatarUrl, setAvatarUrl] = useState<string>(profile.avatarUrl);
  const [isAvatarUploading, setIsAvatarUploading] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);

  const [organizationValues, setOrganizationValues] = useState<OrganizationFormValues>({
    name: organization.name
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
  const [browserPushPermission, setBrowserPushPermission] = useState<NotificationPermission | "unsupported">(
    "unsupported"
  );

  // Language preference state
  const [isLocaleSaving, setIsLocaleSaving] = useState(false);
  const [localeFeedback, setLocaleFeedback] = useState<string | null>(null);

  // MFA state
  const [mfaEnrolled, setMfaEnrolled] = useState<boolean | null>(null);
  const [isMfaLoading, setIsMfaLoading] = useState(false);

  const fetchMfaStatus = useCallback(() => {
    setIsMfaLoading(true);
    fetch("/api/v1/me/mfa")
      .then((res) => res.json())
      .then((data: { data?: { enrolled?: boolean } }) => {
        setMfaEnrolled(data.data?.enrolled ?? false);
      })
      .catch(() => setMfaEnrolled(null))
      .finally(() => setIsMfaLoading(false));
  }, []);

  useEffect(() => {
    if (activeTab !== "security") return;
    fetchMfaStatus();
  }, [activeTab, fetchMfaStatus]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (!("Notification" in window)) {
      setBrowserPushPermission("unsupported");
      return;
    }

    setBrowserPushPermission(Notification.permission);
    const storedPreference = window.localStorage.getItem(BROWSER_PUSH_PREF_KEY);
    if (storedPreference === null) {
      window.localStorage.setItem(
        BROWSER_PUSH_PREF_KEY,
        profile.notificationPreferences.browserPush ? "true" : "false"
      );
      return;
    }

    const storedEnabled = storedPreference === "true";
    if (storedEnabled !== profile.notificationPreferences.browserPush) {
      setNotificationValues((previous) => ({
        ...previous,
        browserPush: storedEnabled
      }));
    }
  }, [profile.notificationPreferences.browserPush]);

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

  const handleAvatarUpload = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsAvatarUploading(true);
    setAvatarError(null);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/v1/me/avatar", {
        method: "POST",
        body: formData
      });

      const payload = (await response.json()) as {
        data?: { avatarUrl: string } | null;
        error?: { message: string } | null;
      };

      if (!response.ok || !payload.data) {
        setAvatarError(payload.error?.message ?? t('profile.unableToUpload'));
        return;
      }

      setAvatarUrl(payload.data.avatarUrl);
    } catch {
      setAvatarError(t('profile.unableToUpload'));
    } finally {
      setIsAvatarUploading(false);
      if (event.target) event.target.value = "";
    }
  }, [t]);

  const handleAvatarRemove = useCallback(async () => {
    setIsAvatarUploading(true);
    setAvatarError(null);

    try {
      const response = await fetch("/api/v1/me/avatar", { method: "DELETE" });

      if (!response.ok) {
        setAvatarError(t('profile.unableToRemove'));
        return;
      }

      setAvatarUrl("");
    } catch {
      setAvatarError(t('profile.unableToRemove'));
    } finally {
      setIsAvatarUploading(false);
    }
  }, [t]);

  const handleProfileSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const errors = validateProfile(profileValues, profileSchema);
    setProfileErrors(errors);

    if (hasErrors(errors)) {
      return;
    }

    setProfileMessage(null);
    setIsProfileSaving(true);

    try {
      const response = await fetch("/api/v1/settings/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...profileValues, avatarUrl })
      });

      const payload = (await response.json()) as {
        error: { message: string } | null;
      };

      if (!response.ok) {
        setProfileMessage(payload.error?.message ?? t('profile.unableToUpdate'));
        return;
      }

      setProfileMessage(t('profile.saved'));
      setFormDirty(false);
    } catch (error) {
      setProfileMessage(error instanceof Error ? error.message : t('profile.unableToUpdate'));
    } finally {
      setIsProfileSaving(false);
    }
  };

  const handleOrganizationSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const errors = validateOrganization(organizationValues, organizationSchema);
    setOrganizationErrors(errors);

    if (hasErrors(errors)) {
      return;
    }

    setOrganizationMessage(null);
    setIsOrganizationSaving(true);

    try {
      const response = await fetch("/api/v1/settings/organization", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(organizationValues)
      });

      const payload = (await response.json()) as {
        error: { message: string } | null;
      };

      if (!response.ok) {
        setOrganizationMessage(
          payload.error?.message ?? t('organization.unableToUpdate')
        );
        return;
      }

      setOrganizationMessage(t('organization.saved'));
      setFormDirty(false);
    } catch (error) {
      setOrganizationMessage(
        error instanceof Error ? error.message : t('organization.unableToUpdate')
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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(notificationValues)
      });

      const payload = (await response.json()) as {
        error: { message: string } | null;
      };

      if (!response.ok) {
        setNotificationMessage(
          payload.error?.message ?? t('notificationSettings.unableToUpdate')
        );
        return;
      }

      setNotificationMessage(t('notificationSettings.saved'));
      if (typeof window !== "undefined") {
        window.localStorage.setItem(
          BROWSER_PUSH_PREF_KEY,
          notificationValues.browserPush ? "true" : "false"
        );
        window.dispatchEvent(new Event("crewhub:browser-push-pref-updated"));
      }
      setFormDirty(false);
    } catch (error) {
      setNotificationMessage(
        error instanceof Error ? error.message : t('notificationSettings.unableToUpdate')
      );
    } finally {
      setIsNotificationSaving(false);
    }
  };

  const initials = getInitials(profile.fullName);

  const handleBrowserPushToggle = async (nextValue: boolean) => {
    if (!nextValue) {
      setNotificationValues((previous) => ({ ...previous, browserPush: false }));
      setNotificationMessage(null);
      setFormDirty(true);
      return;
    }

    if (typeof window === "undefined" || !("Notification" in window)) {
      setNotificationMessage(t('notificationSettings.browserUnsupported'));
      setNotificationValues((previous) => ({ ...previous, browserPush: false }));
      return;
    }

    if (Notification.permission === "denied") {
      setNotificationMessage(t('notificationSettings.browserBlocked'));
      setNotificationValues((previous) => ({ ...previous, browserPush: false }));
      return;
    }

    let permission: NotificationPermission = Notification.permission;
    if (permission === "default") {
      permission = await Notification.requestPermission();
      setBrowserPushPermission(permission);
    }

    if (permission !== "granted") {
      setNotificationMessage(t('notificationSettings.permissionDenied'));
      setNotificationValues((previous) => ({ ...previous, browserPush: false }));
      return;
    }

    setNotificationValues((previous) => ({ ...previous, browserPush: true }));
    setNotificationMessage(null);
    setFormDirty(true);
  };

  const handleLocaleChange = async (event: ChangeEvent<HTMLSelectElement>) => {
    const newLocale = event.target.value as AppLocale;
    if (newLocale === preferredLocale) return;

    setIsLocaleSaving(true);
    setLocaleFeedback(null);

    const result = await updateLocale(newLocale);

    if (result.ok) {
      router.refresh();
    } else if (result.cookieSet) {
      router.refresh();
      setLocaleFeedback(t('languagePreference.failedPartial'));
    } else {
      setLocaleFeedback(t('languagePreference.failed'));
    }

    setIsLocaleSaving(false);
  };

  return (
    <section className="settings-layout" aria-label={t('ariaLabel')}>
      <PageTabs
        tabs={settingsTabs}
        activeTab={activeTab}
        onTabChange={handleTabChange}
        userRoles={userRoles}
      />

      <div className="settings-content">
        {activeTab === "profile" ? (
          <section className="settings-card" aria-label={t('profile.ariaLabel')}>
            <h2 className="section-title">{t('profile.heading')}</h2>
            <p className="settings-card-description">{t('profile.profileDescription')}</p>

            {/* Avatar upload */}
            <div className="profile-avatar-section">
              <div className="profile-avatar-preview">
                {avatarUrl ? (
                  <Image
                    src={avatarUrl}
                    alt={profile.fullName}
                    width={72}
                    height={72}
                    className="profile-avatar-image"
                    unoptimized
                  />
                ) : (
                  <span className="profile-avatar-placeholder numeric">{initials}</span>
                )}
              </div>
              <div className="profile-avatar-controls">
                <input
                  ref={avatarInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="sr-only"
                  onChange={handleAvatarUpload}
                  disabled={isAvatarUploading}
                />
                <button
                  type="button"
                  className="button"
                  disabled={isAvatarUploading}
                  onClick={() => avatarInputRef.current?.click()}
                >
                  {isAvatarUploading ? t('profile.uploading') : t('profile.uploadPhoto')}
                </button>
                {avatarUrl ? (
                  <button
                    type="button"
                    className="table-row-action table-row-action-danger"
                    disabled={isAvatarUploading}
                    onClick={() => void handleAvatarRemove()}
                  >
                    {t('profile.removePhoto')}
                  </button>
                ) : null}
                <p className="settings-card-description">{t('profile.photoHint')}</p>
              </div>
              {avatarError ? <p className="form-field-error">{avatarError}</p> : null}
            </div>

            <form className="settings-form" onSubmit={handleProfileSubmit} noValidate>
              <label className="form-field" htmlFor="profile-full-name">
                <span className="form-label">{t('profile.fullName')}</span>
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
                    setProfileErrors(validateProfile(nextValues, profileSchema));
                    setFormDirty(true);
                  }}
                />
                {profileErrors.fullName ? (
                  <p className="form-field-error">{profileErrors.fullName}</p>
                ) : null}
              </label>

              <label className="form-field" htmlFor="profile-phone">
                <span className="form-label">{t('profile.phone')}</span>
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
                    setProfileErrors(validateProfile(nextValues, profileSchema));
                    setFormDirty(true);
                  }}
                />
                {profileErrors.phone ? (
                  <p className="form-field-error">{profileErrors.phone}</p>
                ) : null}
              </label>

              <label className="form-field" htmlFor="profile-email">
                <span className="form-label">{t('profile.email')}</span>
                <input id="profile-email" className="form-input" value={profile.email} disabled />
              </label>

              <div className="settings-actions">
                <button type="submit" className="button button-accent" disabled={isProfileSaving}>
                  {isProfileSaving ? tCommon('saving') : t('profile.saveProfile')}
                </button>
              </div>

              {profileMessage ? <p className="settings-feedback">{profileMessage}</p> : null}
            </form>
          </section>
        ) : null}

        {activeTab === "notifications" ? (
          <section className="settings-card" aria-label={t('notificationSettings.ariaLabel')}>
            {/* ── Language preference ─────────────────────── */}
            <div className="settings-language-section">
              <h2 className="section-title">{t('languagePreference.heading')}</h2>
              <p className="settings-card-description">
                {t('languagePreference.description')}
              </p>

              <select
                className="form-input settings-language-select"
                value={preferredLocale}
                onChange={(e) => void handleLocaleChange(e)}
                disabled={isLocaleSaving}
              >
                {SUPPORTED_LOCALES.map((loc) => (
                  <option key={loc} value={loc}>
                    {LOCALE_META[loc].nativeName}
                  </option>
                ))}
              </select>

              {localeFeedback ? (
                <p className="settings-language-feedback">{localeFeedback}</p>
              ) : null}
            </div>

            {/* ── Notification preferences ────────────────── */}
            <h2 className="section-title">{t('notificationSettings.heading')}</h2>
            <p className="settings-card-description">
              {t('notificationSettings.notifDescription')}
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
                <span>{t('notificationSettings.emailAnnouncements')}</span>
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
                <span>{t('notificationSettings.emailApprovals')}</span>
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
                <span>{t('notificationSettings.inAppReminders')}</span>
              </label>

              <label className="settings-checkbox">
                <input
                  type="checkbox"
                  checked={notificationValues.browserPush}
                  onChange={(event) => {
                    void handleBrowserPushToggle(event.currentTarget.checked);
                  }}
                />
                <span>{t('notificationSettings.browserAlerts')}</span>
              </label>
              <p className="settings-card-description">
                {t('notificationSettings.permissionStatus')}{" "}
                <strong>
                  {browserPushPermission === "unsupported"
                    ? t('notificationSettings.permUnsupported')
                    : browserPushPermission === "granted"
                      ? t('notificationSettings.permGranted')
                      : browserPushPermission === "denied"
                        ? t('notificationSettings.permBlocked')
                        : t('notificationSettings.permNotGranted')}
                </strong>
              </p>

              <div className="settings-actions">
                <button
                  type="submit"
                  className="button button-accent"
                  disabled={isNotificationSaving}
                >
                  {isNotificationSaving ? tCommon('saving') : t('notificationSettings.saveNotifications')}
                </button>
              </div>

              {notificationMessage ? <p className="settings-feedback">{notificationMessage}</p> : null}
            </form>
          </section>
        ) : null}

        {activeTab === "organization" ? (
          canManageOrganization ? (
            <section className="settings-card" aria-label={t('organization.ariaLabel')}>
              <h2 className="section-title">{t('organization.heading')}</h2>
              <p className="settings-card-description">
                {t('organization.orgDescription')}
              </p>

              <form className="settings-form" onSubmit={handleOrganizationSubmit} noValidate>
                <label className="form-field" htmlFor="organization-name">
                  <span className="form-label">{t('organization.orgName')}</span>
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
                      setOrganizationErrors(validateOrganization(nextValues, organizationSchema));
                      setFormDirty(true);
                    }}
                  />
                  {organizationErrors.name ? (
                    <p className="form-field-error">{organizationErrors.name}</p>
                  ) : null}
                </label>

                <div className="settings-actions">
                  <button
                    type="submit"
                    className="button button-accent"
                    disabled={isOrganizationSaving}
                  >
                    {isOrganizationSaving ? tCommon('saving') : t('organization.saveOrganization')}
                  </button>
                </div>

                {organizationMessage ? (
                  <p className="settings-feedback">{organizationMessage}</p>
                ) : null}
              </form>
            </section>
          ) : (
            <EmptyState
              title={t('organization.restricted')}
              description={t('organization.restrictedBody')}
              ctaLabel={t('organization.backToProfile')}
              ctaHref="/settings"
            />
          )
        ) : null}

        {activeTab === "security" ? (
          <section className="settings-card" aria-label={t('security.ariaLabel')}>
            <h2 className="section-title">{t('security.heading')}</h2>
            <p className="settings-card-description">
              {t('security.securityDescription')}
            </p>

            <div className="security-action-row">
              <div className="security-action-copy">
                <p className="form-label">{t('security.authenticator')}</p>
                <p className="settings-card-description">
                  {isMfaLoading
                    ? t('security.checkingStatus')
                    : mfaEnrolled
                      ? t('security.enrolledDescription')
                      : t('security.notEnrolledDescription')}
                </p>
                {!isMfaLoading && mfaEnrolled ? (
                  <p className="settings-card-description" style={{ marginTop: "var(--space-2)" }}>
                    {t('security.resetContact')}
                  </p>
                ) : null}
              </div>
            </div>

            <div className="security-action-row">
              <div className="security-action-copy">
                <p className="form-label">{t('security.supportLabel')}</p>
                <p className="settings-card-description">
                  {t('security.supportDescription')}
                </p>
              </div>
              <Link href="/support" className="button">
                {t('security.helpSupport')}
              </Link>
            </div>

          </section>
        ) : null}

        {activeTab === "audit" ? (
          canViewAudit ? (
            <AuditLogViewer />
          ) : (
            <EmptyState
              title={t('audit.restricted')}
              description={t('audit.restrictedBody')}
              ctaLabel={t('audit.backToSettings')}
              ctaHref="/settings"
            />
          )
        ) : null}
      </div>
    </section>
  );
}
