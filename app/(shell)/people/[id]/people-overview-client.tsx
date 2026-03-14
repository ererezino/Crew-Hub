"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { ConfirmDialog } from "../../../../components/shared/confirm-dialog";
import { Employee360 } from "../../../../components/people/employee-360";
import { ErrorState } from "../../../../components/shared/error-state";
import { SlidePanel } from "../../../../components/shared/slide-panel";
import { StatusBadge } from "../../../../components/shared/status-badge";
import { countryFlagFromCode, countryNameFromCode } from "../../../../lib/countries";
import { formatDate as formatDateLib, formatRelativeTime } from "../../../../lib/datetime";
import { DEPARTMENTS } from "../../../../lib/departments";
import { USER_ROLES } from "../../../../lib/navigation";
import type { ApiResponse, AppRole } from "../../../../types/auth";
import type {
  PersonRecord,
  PeopleListResponse,
  PeopleUpdateResponse,
  PrivacySettings
} from "../../../../types/people";
import { humanizeError } from "@/lib/errors";

/* ── Types ── */

type AppLocale = "en" | "fr";

type PeopleOverviewClientProps = {
  employeeId: string;
  isSelf: boolean;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  canInitiateOffboarding: boolean;
};

type EditFormValues = {
  fullName: string;
  phone: string;
  timezone: string;
  pronouns: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  emergencyContactRelationship: string;
  bio: string;
  favoriteMusic: string;
  favoriteBooks: string;
  favoriteSports: string;
};

const INITIAL_EDIT_VALUES: EditFormValues = {
  fullName: "",
  phone: "",
  timezone: "",
  pronouns: "",
  emergencyContactName: "",
  emergencyContactPhone: "",
  emergencyContactRelationship: "",
  bio: "",
  favoriteMusic: "",
  favoriteBooks: "",
  favoriteSports: ""
};

/* ── Privacy Defaults ── */

const DEFAULT_PRIVACY: PrivacySettings = {
  showEmail: true,
  showPhone: false,
  showDepartment: true,
  showBio: true,
  showInterests: true
};

function resolvePrivacy(settings: PrivacySettings | null | undefined): Required<PrivacySettings> {
  return {
    showEmail: settings?.showEmail ?? DEFAULT_PRIVACY.showEmail ?? true,
    showPhone: settings?.showPhone ?? DEFAULT_PRIVACY.showPhone ?? false,
    showDepartment: settings?.showDepartment ?? DEFAULT_PRIVACY.showDepartment ?? true,
    showBio: settings?.showBio ?? DEFAULT_PRIVACY.showBio ?? true,
    showInterests: settings?.showInterests ?? DEFAULT_PRIVACY.showInterests ?? true
  };
}

/* ── Helpers ── */

function formatDate(dateString: string | null, locale?: AppLocale): string {
  if (!dateString) return "--";
  return formatDateLib(dateString, locale);
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function formatEmploymentType(type: string): string {
  return type
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function getBrowserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "";
  }
}

async function parseJsonResponse<T>(response: Response): Promise<T | null> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return null;
  }

  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

/* ── Component ── */

export function PeopleOverviewClient({
  employeeId,
  isSelf,
  isAdmin,
  isSuperAdmin,
  canInitiateOffboarding
}: PeopleOverviewClientProps) {
  const t = useTranslations('peopleOverview');
  const tCommon = useTranslations('common');
  const locale = useLocale() as AppLocale;
  const td = t as (key: string, params?: Record<string, unknown>) => string;

  const [person, setPerson] = useState<PersonRecord | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  // Avatar upload state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);

  // Edit panel state
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editValues, setEditValues] = useState<EditFormValues>(INITIAL_EDIT_VALUES);
  const [privacyValues, setPrivacyValues] = useState<Required<PrivacySettings>>(
    resolvePrivacy(null)
  );
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Admin edit state
  const [isAdminEditOpen, setIsAdminEditOpen] = useState(false);
  const [adminEditValues, setAdminEditValues] = useState({
    roles: ["EMPLOYEE"] as AppRole[],
    department: "",
    managerId: "",
    title: "",
    startDate: "",
    status: "active" as string
  });
  const [adminEditError, setAdminEditError] = useState<string | null>(null);
  const [isAdminEditSaving, setIsAdminEditSaving] = useState(false);
  const [allPeople, setAllPeople] = useState<PersonRecord[]>([]);

  // Invite state
  const [isInviting, setIsInviting] = useState(false);
  const [inviteConfirmOpen, setInviteConfirmOpen] = useState(false);
  const [inviteMessage, setInviteMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [inviteLink, setInviteLink] = useState<string | null>(null);

  // Offboarding state
  const [isOffboardModalOpen, setIsOffboardModalOpen] = useState(false);
  const [offboardLastDay, setOffboardLastDay] = useState("");
  const [offboardReason, setOffboardReason] = useState("");
  const [offboardConfirmName, setOffboardConfirmName] = useState("");
  const [isSubmittingOffboard, setIsSubmittingOffboard] = useState(false);
  const [offboardError, setOffboardError] = useState<string | null>(null);

  // Disable/enable account state
  const [confirmDisableOpen, setConfirmDisableOpen] = useState(false);
  const [isTogglingStatus, setIsTogglingStatus] = useState(false);

  // Fetch person data
  useEffect(() => {
    const abortController = new AbortController();

    const fetchPerson = async () => {
      setIsLoading(true);
      setErrorMessage(null);

      try {
        const response = await fetch("/api/v1/people?scope=all", {
          method: "GET",
          signal: abortController.signal
        });

        const payload = (await response.json()) as PeopleListResponse;

        if (!response.ok || !payload.data) {
          setPerson(null);
          setErrorMessage(payload.error?.message ?? t('errorState.unableToLoad'));
          return;
        }

        const found = payload.data.people.find((p) => p.id === employeeId);

        if (!found) {
          setPerson(null);
          setErrorMessage(t('errorState.notFound'));
          return;
        }

        setPerson(found);
        setAllPeople(payload.data.people);
      } catch (error) {
        if (abortController.signal.aborted) return;
        setPerson(null);
        setErrorMessage(error instanceof Error ? error.message : t('errorState.unableToLoad'));
      } finally {
        if (!abortController.signal.aborted) {
          setIsLoading(false);
        }
      }
    };

    void fetchPerson();

    return () => {
      abortController.abort();
    };
  }, [employeeId, reloadToken, t]);

  const refresh = useCallback(() => {
    setReloadToken((v) => v + 1);
  }, []);

  // Role labels
  const roleLabels: Record<AppRole, string> = useMemo(() => ({
    EMPLOYEE: tCommon('role.employee'),
    TEAM_LEAD: tCommon('role.teamLead'),
    MANAGER: tCommon('role.manager'),
    HR_ADMIN: tCommon('role.hrAdmin'),
    FINANCE_ADMIN: tCommon('role.financeAdmin'),
    SUPER_ADMIN: tCommon('role.superAdmin')
  }), [tCommon]);

  // Admin edit handlers
  const openAdminEdit = useCallback(() => {
    if (!person) return;
    setAdminEditValues({
      roles: person.roles.length > 0 ? [...person.roles] : ["EMPLOYEE"],
      department: person.department ?? "",
      managerId: person.managerId ?? "",
      title: person.title ?? "",
      startDate: person.startDate ?? "",
      status: person.status ?? "active"
    });
    setAdminEditError(null);
    setIsAdminEditOpen(true);
  }, [person]);

  const closeAdminEdit = useCallback(() => {
    if (isAdminEditSaving) return;
    setIsAdminEditOpen(false);
    setAdminEditError(null);
  }, [isAdminEditSaving]);

  const handleAdminEditRoleToggle = useCallback((role: AppRole) => {
    setAdminEditValues((prev) => {
      const has = prev.roles.includes(role);
      const next = has
        ? prev.roles.filter((r) => r !== role)
        : [...prev.roles, role];
      return { ...prev, roles: next.length > 0 ? next : ["EMPLOYEE"] };
    });
  }, []);

  const handleAdminEditSave = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (!person) return;

      setIsAdminEditSaving(true);
      setAdminEditError(null);

      try {
        const response = await fetch(`/api/v1/people/${person.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            roles: adminEditValues.roles,
            department: adminEditValues.department.trim() || null,
            managerId: adminEditValues.managerId.trim() || null,
            title: adminEditValues.title.trim() || null,
            startDate: adminEditValues.startDate.trim() || null,
            status: adminEditValues.status || undefined
          })
        });

        const payload = (await response.json()) as PeopleUpdateResponse;

        if (!response.ok || !payload.data?.person) {
          setAdminEditError(humanizeError(payload.error?.message ?? t('toast.unableToSave')));
          return;
        }

        setPerson(payload.data.person);
        setIsAdminEditOpen(false);
      } catch (error) {
        setAdminEditError(error instanceof Error ? error.message : t('toast.unableToSave'));
      } finally {
        setIsAdminEditSaving(false);
      }
    },
    [person, adminEditValues, t]
  );

  // Invite handler
  const handleSendInvite = useCallback(async () => {
    if (!person) return;

    setIsInviting(true);
    setInviteConfirmOpen(false);
    setInviteMessage(null);
    setInviteLink(null);

    try {
      const response = await fetch(`/api/v1/people/${person.id}/invite`, {
        method: "POST"
      });

      const payload = await parseJsonResponse<ApiResponse<{
        inviteSent: boolean;
        inviteLink: string | null;
        isResend: boolean;
      }>>(response);

      if (!response.ok || !payload?.data?.inviteSent) {
        const fallbackMsg = response.status === 401
          ? t('toast.sessionExpired')
          : response.status === 403
            ? t('toast.noInvitePermission')
            : response.status === 404
              ? t('toast.personNotFound')
              : t('toast.unableToSendInvite');
        setInviteMessage({
          type: "error",
          text: humanizeError(payload?.error?.message ?? fallbackMsg)
        });
        return;
      }

      /* Store invite link for manual sharing */
      setInviteLink(payload.data.inviteLink ?? null);

      setInviteMessage({
        type: "success",
        text: payload.data.isResend
          ? t('toast.inviteResent', { email: person.email })
          : t('toast.inviteSent', { email: person.email })
      });
    } catch (error) {
      setInviteMessage({
        type: "error",
        text: error instanceof Error ? error.message : t('toast.unableToSendInvite')
      });
    } finally {
      setIsInviting(false);
    }
  }, [person, t]);

  // Avatar upload handler
  const handleAvatarUpload = useCallback(
    async (file: File) => {
      if (!person) return;

      setIsUploadingAvatar(true);
      setAvatarError(null);

      try {
        const formData = new FormData();
        formData.append("file", file);

        const response = await fetch("/api/v1/me/avatar", {
          method: "POST",
          body: formData
        });

        const payload = (await response.json()) as ApiResponse<{ avatarUrl: string }>;

        if (!response.ok || !payload.data) {
          setAvatarError(payload.error?.message ?? t('toast.unableToUploadAvatar'));
          return;
        }

        setPerson((prev) =>
          prev ? { ...prev, avatarUrl: payload.data!.avatarUrl } : prev
        );
      } catch (error) {
        setAvatarError(error instanceof Error ? error.message : t('toast.unableToUploadAvatar'));
      } finally {
        setIsUploadingAvatar(false);
      }
    },
    [person, t]
  );

  const handleFileChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.currentTarget.files?.[0];
      if (file) {
        void handleAvatarUpload(file);
      }
      // Reset the input so the same file can be re-selected
      event.currentTarget.value = "";
    },
    [handleAvatarUpload]
  );

  const handleRemoveAvatar = useCallback(async () => {
    if (!person) return;

    setIsUploadingAvatar(true);
    setAvatarError(null);

    try {
      const response = await fetch("/api/v1/me/avatar", {
        method: "DELETE"
      });

      const payload = (await response.json()) as ApiResponse<{ avatarUrl: null }>;

      if (!response.ok || !payload.data) {
        setAvatarError(payload.error?.message ?? t('toast.unableToRemoveAvatar'));
        return;
      }

      setPerson((prev) => (prev ? { ...prev, avatarUrl: null } : prev));
    } catch (error) {
      setAvatarError(error instanceof Error ? error.message : t('toast.unableToRemoveAvatar'));
    } finally {
      setIsUploadingAvatar(false);
    }
  }, [person, t]);

  // Open edit panel
  const openEdit = useCallback(() => {
    if (!person) return;
    setEditValues({
      fullName: person.fullName ?? "",
      phone: person.phone ?? "",
      timezone: person.timezone ?? getBrowserTimezone(),
      pronouns: person.pronouns ?? "",
      emergencyContactName: person.emergencyContactName ?? "",
      emergencyContactPhone: person.emergencyContactPhone ?? "",
      emergencyContactRelationship: person.emergencyContactRelationship ?? "",
      bio: person.bio ?? "",
      favoriteMusic: person.favoriteMusic ?? "",
      favoriteBooks: person.favoriteBooks ?? "",
      favoriteSports: person.favoriteSports ?? ""
    });
    setPrivacyValues(resolvePrivacy(person.privacySettings));
    setSaveError(null);
    setIsEditOpen(true);
  }, [person]);

  const closeEdit = useCallback(() => {
    setIsEditOpen(false);
  }, []);

  // Save profile
  const handleSave = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (!person) return;

      setIsSaving(true);
      setSaveError(null);

      try {
        const response = await fetch(`/api/v1/people/${person.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fullName: editValues.fullName.trim() || person.fullName,
            phone: editValues.phone.trim() || null,
            timezone: editValues.timezone.trim() || null,
            pronouns: editValues.pronouns.trim() || null,
            emergencyContactName: editValues.emergencyContactName.trim() || null,
            emergencyContactPhone: editValues.emergencyContactPhone.trim() || null,
            emergencyContactRelationship: editValues.emergencyContactRelationship.trim() || null,
            bio: editValues.bio.trim() || null,
            favoriteMusic: editValues.favoriteMusic.trim() || null,
            favoriteBooks: editValues.favoriteBooks.trim() || null,
            favoriteSports: editValues.favoriteSports.trim() || null,
            privacySettings: privacyValues
          })
        });

        const payload = (await response.json()) as PeopleUpdateResponse;

        if (!response.ok || !payload.data) {
          setSaveError(payload.error?.message ?? t('toast.unableToSaveProfile'));
          return;
        }

        setPerson(payload.data.person);
        setIsEditOpen(false);
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : t('toast.unableToSaveProfile'));
      } finally {
        setIsSaving(false);
      }
    },
    [person, editValues, privacyValues, t]
  );

  // Disable / enable account handler
  const handleToggleAccountStatus = useCallback(async () => {
    if (!person) return;

    const newStatus = person.status === "inactive" ? "active" : "inactive";
    setIsTogglingStatus(true);

    try {
      const response = await fetch(`/api/v1/people/${person.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus })
      });

      const payload = (await response.json()) as PeopleUpdateResponse;

      if (!response.ok || !payload.data) {
        const msg = payload.error?.message ?? (newStatus === "inactive"
          ? t('toast.unableToDisable')
          : t('toast.unableToEnable'));
        alert(msg);
        return;
      }

      setConfirmDisableOpen(false);
      refresh();
    } catch (error) {
      alert(error instanceof Error ? error.message : tCommon('error.generic'));
    } finally {
      setIsTogglingStatus(false);
    }
  }, [person, refresh, t, tCommon]);

  // Offboarding handler
  const handleOffboard = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (!person) return;

      setIsSubmittingOffboard(true);
      setOffboardError(null);

      try {
        const response = await fetch(`/api/v1/people/${person.id}/offboard`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            lastWorkingDay: offboardLastDay,
            reason: offboardReason,
            confirmName: offboardConfirmName
          })
        });

        const payload = (await response.json()) as ApiResponse<{ profileId: string; instanceId: string | null; status: string }>;

        if (!response.ok || !payload.data) {
          setOffboardError(payload.error?.message ?? t('toast.unableToOffboard'));
          return;
        }

        setIsOffboardModalOpen(false);
        refresh();
      } catch (error) {
        setOffboardError(error instanceof Error ? error.message : t('toast.unableToOffboard'));
      } finally {
        setIsSubmittingOffboard(false);
      }
    },
    [person, offboardLastDay, offboardReason, offboardConfirmName, refresh, t]
  );

  const offboardNameMatches = person
    ? offboardConfirmName === person.fullName
    : false;

  /* ── Loading & Error States ── */

  if (isLoading) {
    return (
      <section className="profile-overview-section" aria-label={t('header.ariaLabel')}>
        <div className="profile-overview-skeleton">
          <div className="skeleton-block skeleton-block-lg" />
          <div className="skeleton-block skeleton-block-md" />
          <div className="skeleton-block skeleton-block-md" />
        </div>
      </section>
    );
  }

  if (errorMessage || !person) {
    return (
      <ErrorState
        title={t('errorState.title')}
        message={errorMessage ?? t('errorState.defaultMessage')}
        onRetry={refresh}
      />
    );
  }

  /* ── Privacy ── */

  const privacy = resolvePrivacy(person.privacySettings);
  const canSeeAll = isSelf || isAdmin;

  return (
    <section className="profile-overview-section" aria-label={t('header.ariaLabel')}>
      {/* Header with name, avatar, and edit button */}
      <div className="profile-overview-header">
        <div className="profile-overview-identity">
          <div className="profile-overview-avatar-wrapper">
            {person.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={person.avatarUrl}
                alt={t('header.avatarAlt', { name: person.fullName })}
                className="profile-overview-avatar profile-overview-avatar-img"
              />
            ) : (
              <div className="profile-overview-avatar">
                {getInitials(person.fullName)}
              </div>
            )}
            {isSelf ? (
              <button
                type="button"
                className="profile-avatar-overlay"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploadingAvatar}
                aria-label={t('header.changePhoto')}
              >
                {isUploadingAvatar ? (
                  <span className="profile-avatar-overlay-text">...</span>
                ) : (
                  <svg
                    className="profile-avatar-overlay-icon"
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                    <circle cx="12" cy="13" r="4" />
                  </svg>
                )}
              </button>
            ) : null}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={handleFileChange}
              style={{ display: "none" }}
              aria-hidden="true"
            />
          </div>
          <div>
            <h2 className="profile-overview-name">
              {person.fullName}
              {person.pronouns ? (
                <span className="profile-overview-pronouns">({person.pronouns})</span>
              ) : null}
            </h2>
            {person.title ? (
              <p className="profile-overview-title">{person.title}</p>
            ) : null}
          </div>
        </div>
        <div className="profile-overview-header-actions">
          {isSelf && person.avatarUrl ? (
            <button
              type="button"
              className="button button-ghost"
              onClick={handleRemoveAvatar}
              disabled={isUploadingAvatar}
            >
              {t('header.removePhoto')}
            </button>
          ) : null}
          {isSelf ? (
            <button type="button" className="button button-secondary" onClick={openEdit}>
              {t('header.editProfile')}
            </button>
          ) : null}
          {isAdmin && !isSelf ? (
            <>
              <button
                type="button"
                className="button button-secondary"
                onClick={openAdminEdit}
              >
                {t('header.edit')}
              </button>
              <button
                type="button"
                className="button button-accent"
                onClick={() => setInviteConfirmOpen(true)}
                disabled={isInviting}
              >
                {isInviting ? t('header.sendingInvite') : t('header.sendInvite')}
              </button>
            </>
          ) : null}
        </div>
      </div>

      {avatarError ? (
        <div className="form-error-banner">{avatarError}</div>
      ) : null}

      {inviteMessage ? (
        <div className={inviteMessage.type === "success" ? "invite-success-banner" : "form-error-banner"}>
          {inviteMessage.text}
        </div>
      ) : null}

      {inviteLink ? (
        <div className="invite-link-area">
          <p className="invite-link-label">
            {t('inviteLink.label', { name: person.fullName })}
          </p>
          <div className="invite-link-input-row">
            <input
              className="form-input"
              value={inviteLink}
              readOnly
              onClick={(e) => (e.target as HTMLInputElement).select()}
            />
            <button
              type="button"
              className="button button-accent"
              onClick={() => {
                void navigator.clipboard.writeText(inviteLink);
                setInviteMessage({ type: "success", text: t('inviteLink.copied') });
              }}
            >
              {t('inviteLink.copyLink')}
            </button>
          </div>
        </div>
      ) : null}

      {/* Details Grid */}
      <div className="profile-overview-grid">
        {/* Basic Info */}
        <div className="profile-overview-card">
          <h3 className="profile-overview-card-title">{t('basicInfo.title')}</h3>
          <dl className="profile-overview-dl">
            {(canSeeAll || privacy.showEmail) ? (
              <>
                <dt>{t('basicInfo.email')}</dt>
                <dd>{person.email}</dd>
              </>
            ) : null}

            {(canSeeAll || privacy.showPhone) && person.phone ? (
              <>
                <dt>{t('basicInfo.phone')}</dt>
                <dd>{person.phone}</dd>
              </>
            ) : null}

            {(canSeeAll || privacy.showDepartment) ? (
              <>
                <dt>{t('basicInfo.department')}</dt>
                <dd>{person.department ?? "--"}</dd>
              </>
            ) : null}

            {person.countryCode ? (
              <>
                <dt>{t('basicInfo.country')}</dt>
                <dd>
                  <span className="country-chip">
                    <span>{countryFlagFromCode(person.countryCode)}</span>
                    <span>{countryNameFromCode(person.countryCode, locale)}</span>
                  </span>
                </dd>
              </>
            ) : null}

            {person.timezone ? (
              <>
                <dt>{t('basicInfo.timezone')}</dt>
                <dd>{person.timezone}</dd>
              </>
            ) : null}

            {person.pronouns ? (
              <>
                <dt>{t('basicInfo.pronouns')}</dt>
                <dd>{person.pronouns}</dd>
              </>
            ) : null}

            <dt>{t('basicInfo.joined')}</dt>
            <dd>{person.startDate ? formatDate(person.startDate, locale) : "—"}</dd>

            {person.managerName ? (
              <>
                <dt>{t('basicInfo.reportsTo')}</dt>
                <dd>{person.managerName}</dd>
              </>
            ) : null}
          </dl>
        </div>

        {/* Bio */}
        {(canSeeAll || privacy.showBio) ? (
          <div className="profile-overview-card">
            <h3 className="profile-overview-card-title">{t('about.title')}</h3>
            {person.bio ? (
              <p className="profile-overview-bio">{person.bio}</p>
            ) : (
              <p className="profile-overview-empty">
                {isSelf ? t('about.emptySelf') : t('about.emptyOther')}
              </p>
            )}
          </div>
        ) : null}

        {/* Interests */}
        {(canSeeAll || privacy.showInterests) ? (
          <div className="profile-overview-card">
            <h3 className="profile-overview-card-title">{t('interests.title')}</h3>
            <dl className="profile-overview-dl">
              <dt>{t('interests.music')}</dt>
              <dd>{person.favoriteMusic || (isSelf ? t('interests.notSet') : "--")}</dd>

              <dt>{t('interests.books')}</dt>
              <dd>{person.favoriteBooks || (isSelf ? t('interests.notSet') : "--")}</dd>

              <dt>{t('interests.sports')}</dt>
              <dd>{person.favoriteSports || (isSelf ? t('interests.notSet') : "--")}</dd>
            </dl>
          </div>
        ) : null}

        {/* Emergency Contact (self/admin only) */}
        {canSeeAll ? (
          <div className="profile-overview-card">
            <h3 className="profile-overview-card-title">{t('emergencyContact.title')}</h3>
            {person.emergencyContactName ? (
              <dl className="profile-overview-dl">
                <dt>{t('emergencyContact.name')}</dt>
                <dd>{person.emergencyContactName}</dd>

                {person.emergencyContactRelationship ? (
                  <>
                    <dt>{t('emergencyContact.relationship')}</dt>
                    <dd>{person.emergencyContactRelationship}</dd>
                  </>
                ) : null}

                {person.emergencyContactPhone ? (
                  <>
                    <dt>{t('emergencyContact.phone')}</dt>
                    <dd>{person.emergencyContactPhone}</dd>
                  </>
                ) : null}
              </dl>
            ) : (
              <p className="profile-overview-empty">
                {isSelf ? t('emergencyContact.emptySelf') : t('emergencyContact.emptyOther')}
              </p>
            )}
          </div>
        ) : null}

        {/* Work Information (read-only) */}
        <div className="profile-overview-card">
          <h3 className="profile-overview-card-title">{t('workInfo.title')}</h3>
          <dl className="profile-overview-dl profile-overview-dl-readonly">
            <dt>{t('workInfo.email')}</dt>
            <dd>{person.email}</dd>

            <dt>{t('workInfo.department')}</dt>
            <dd>{person.department ?? "--"}</dd>

            <dt>{t('workInfo.jobTitle')}</dt>
            <dd>{person.title ?? "--"}</dd>

            {person.countryCode ? (
              <>
                <dt>{t('workInfo.country')}</dt>
                <dd>
                  <span className="country-chip">
                    <span>{countryFlagFromCode(person.countryCode)}</span>
                    <span>{countryNameFromCode(person.countryCode, locale)}</span>
                  </span>
                </dd>
              </>
            ) : (
              <>
                <dt>{t('workInfo.country')}</dt>
                <dd>--</dd>
              </>
            )}

            <dt>{t('workInfo.employmentType')}</dt>
            <dd>{formatEmploymentType(person.employmentType)}</dd>

            {person.managerName ? (
              <>
                <dt>{t('workInfo.manager')}</dt>
                <dd>{person.managerName}</dd>
              </>
            ) : null}

            <dt>{t('workInfo.roles')}</dt>
            <dd>{person.roles.join(", ")}</dd>

            <dt>{t('workInfo.startDate')}</dt>
            <dd>{formatDate(person.startDate, locale)}</dd>
          </dl>
        </div>

        {/* System Info (admin only) */}
        {isAdmin ? (
          <div className="profile-overview-card">
            <h3 className="profile-overview-card-title">{t('systemInfo.title')}</h3>
            <dl className="profile-overview-dl">
              <dt>{t('systemInfo.employeeStatus')}</dt>
              <dd>
                <StatusBadge
                  tone={
                    person.status === "active" ? "success"
                    : person.status === "onboarding" ? "info"
                    : person.status === "offboarding" ? "warning"
                    : "draft"
                  }
                >
                  {person.status.charAt(0).toUpperCase() + person.status.slice(1)}
                </StatusBadge>
              </dd>

              <dt>{t('systemInfo.joinedCompany')}</dt>
              <dd>{person.startDate ? formatDate(person.startDate, locale) : "—"}</dd>

              <dt>{t('systemInfo.addedToCrewHub')}</dt>
              <dd>{formatDate(person.createdAt, locale)}</dd>

              <dt>{t('systemInfo.accountAccess')}</dt>
              <dd>
                {person.inviteStatus === "signed_in"
                  ? t('systemInfo.accessActive')
                  : person.inviteStatus === "invited"
                    ? t('systemInfo.accessInvited')
                    : t('systemInfo.accessNotInvited')}
              </dd>

              <dt>{t('systemInfo.accountSetupDate')}</dt>
              <dd>{person.accountSetupAt ? formatDate(person.accountSetupAt, locale) : "—"}</dd>

              <dt>{t('systemInfo.lastSignIn')}</dt>
              <dd>{person.lastSeenAt ? formatRelativeTime(person.lastSeenAt) : t('systemInfo.never')}</dd>
            </dl>
          </div>
        ) : null}

        {/* Privacy Settings (self only) */}
        {isSelf ? (
          <div className="profile-overview-card">
            <h3 className="profile-overview-card-title">{t('privacy.title')}</h3>
            <p className="profile-overview-privacy-desc">
              {t('privacy.description')}
            </p>
            <div className="profile-privacy-toggles">
              {(
                [
                  { key: "showEmail" as const, label: t('privacy.emailAddress') },
                  { key: "showPhone" as const, label: t('privacy.phoneNumber') },
                  { key: "showDepartment" as const, label: t('privacy.department') },
                  { key: "showBio" as const, label: t('privacy.bio') },
                  { key: "showInterests" as const, label: t('privacy.interests') }
                ] as const
              ).map(({ key, label }) => (
                <label key={key} className="profile-privacy-toggle">
                  <input
                    type="checkbox"
                    checked={privacy[key]}
                    onChange={() => {
                      const updated = { ...privacy, [key]: !privacy[key] };

                      // Save immediately
                      void fetch(`/api/v1/people/${person.id}`, {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ privacySettings: updated })
                      }).then(() => {
                        setPerson((prev) =>
                          prev ? { ...prev, privacySettings: updated } : prev
                        );
                      });
                    }}
                  />
                  <span className="profile-privacy-toggle-label">{label}</span>
                </label>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      {/* Employee 360 Overview */}
      <Employee360 employeeId={employeeId} />

      {/* Offboarding Banner */}
      {person.status === "offboarding" ? (
        <div className="offboarding-banner">
          <div className="offboarding-banner-content">
            <StatusBadge tone="warning">{t('offboarding.badgeLabel')}</StatusBadge>
            <p className="offboarding-banner-text">
              {t('offboarding.bannerText')}{person.noticePeriodEndDate
                ? ` ${t('offboarding.lastWorkingDay', { date: formatDate(person.noticePeriodEndDate, locale) })}`
                : ""}
            </p>
          </div>
        </div>
      ) : null}

      {/* Danger Zone -- Super Admin / HR Admin only, non-self, non-offboarding */}
      {(isSuperAdmin || canInitiateOffboarding) && !isSelf && person.status !== "offboarding" ? (
        <div className="danger-zone">
          <h3 className="danger-zone-title">{t('dangerZone.title')}</h3>

          {/* Disable / Enable account -- Super Admin only */}
          {isSuperAdmin ? (
            <div className="danger-zone-content">
              <div className="danger-zone-description">
                <p className="danger-zone-label">
                  {person.status === "inactive" ? t('dangerZone.enableAccount') : t('dangerZone.disableAccount')}
                </p>
                <p className="settings-card-description">
                  {person.status === "inactive"
                    ? t('dangerZone.enableDescription')
                    : t('dangerZone.disableDescription')}
                </p>
              </div>
              <button
                type="button"
                className={person.status === "inactive" ? "button button-accent" : "button button-danger"}
                onClick={() => setConfirmDisableOpen(true)}
              >
                {person.status === "inactive" ? t('dangerZone.enableAccount') : t('dangerZone.disableAccount')}
              </button>
            </div>
          ) : null}

          {/* Initiate offboarding */}
          {canInitiateOffboarding ? (
            <div className="danger-zone-content">
              <div className="danger-zone-description">
                <p className="danger-zone-label">{t('dangerZone.initiateOffboarding')}</p>
                <p className="settings-card-description">
                  {t('dangerZone.offboardingDescription')}
                </p>
              </div>
              <button
                type="button"
                className="button button-danger"
                onClick={() => {
                  setOffboardLastDay("");
                  setOffboardReason("");
                  setOffboardConfirmName("");
                  setOffboardError(null);
                  setIsOffboardModalOpen(true);
                }}
              >
                {t('dangerZone.initiateOffboarding')}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Offboarding Confirmation Modal */}
      {isOffboardModalOpen && person ? (
        <div className="modal-overlay" onClick={() => setIsOffboardModalOpen(false)}>
          <div
            className="modal-dialog modal-dialog-danger"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="modal-title">{t('offboardModal.title', { name: person.fullName })}</h2>
            <form onSubmit={handleOffboard} noValidate>
              {offboardError ? (
                <div className="form-error-banner">{offboardError}</div>
              ) : null}

              <label className="form-field" htmlFor="offboard-last-day">
                <span className="form-label">{t('offboardModal.lastWorkingDay')}</span>
                <input
                  id="offboard-last-day"
                  type="date"
                  className="form-input"
                  required
                  value={offboardLastDay}
                  onChange={(e) => setOffboardLastDay(e.currentTarget.value)}
                  disabled={isSubmittingOffboard}
                />
              </label>

              <label className="form-field" htmlFor="offboard-reason">
                <span className="form-label">{t('offboardModal.reasonLabel')}</span>
                <select
                  id="offboard-reason"
                  className="form-input"
                  required
                  value={offboardReason}
                  onChange={(e) => setOffboardReason(e.currentTarget.value)}
                  disabled={isSubmittingOffboard}
                >
                  <option value="">{t('offboardModal.selectReason')}</option>
                  <option value="resignation">{t('offboardModal.resignation')}</option>
                  <option value="redundancy">{t('offboardModal.redundancy')}</option>
                  <option value="performance">{t('offboardModal.performance')}</option>
                  <option value="contract_end">{t('offboardModal.contractEnd')}</option>
                  <option value="other">{t('offboardModal.other')}</option>
                </select>
              </label>

              <label className="form-field" htmlFor="offboard-confirm-name">
                <span className="form-label">{t('offboardModal.confirmLabel', { name: person.fullName })}</span>
                <input
                  id="offboard-confirm-name"
                  className="form-input"
                  placeholder={person.fullName}
                  value={offboardConfirmName}
                  onChange={(e) => setOffboardConfirmName(e.currentTarget.value)}
                  disabled={isSubmittingOffboard}
                />
              </label>

              <div className="modal-actions">
                <button
                  type="button"
                  className="button button-ghost"
                  onClick={() => setIsOffboardModalOpen(false)}
                  disabled={isSubmittingOffboard}
                >
                  {tCommon('cancel')}
                </button>
                <button
                  type="submit"
                  className="button button-danger"
                  disabled={
                    isSubmittingOffboard ||
                    !offboardNameMatches ||
                    !offboardLastDay ||
                    !offboardReason
                  }
                >
                  {isSubmittingOffboard ? t('offboardModal.processing') : t('offboardModal.beginOffboarding')}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {/* Edit Profile Slide Panel */}
      <SlidePanel
        isOpen={isEditOpen}
        title={t('editPanel.title')}
        description={t('editPanel.description')}
        onClose={closeEdit}
      >
        <form className="slide-panel-form-wrapper" onSubmit={handleSave} noValidate>
          {saveError ? (
            <div className="form-error-banner">{saveError}</div>
          ) : null}

          <label className="form-field" htmlFor="profile-fullname">
            <span className="form-label">{t('editPanel.displayName')}</span>
            <input
              id="profile-fullname"
              className="form-input"
              maxLength={200}
              placeholder={t('editPanel.displayNamePlaceholder')}
              value={editValues.fullName}
              onChange={(e) =>
                setEditValues((prev) => ({ ...prev, fullName: e.currentTarget.value }))
              }
            />
          </label>

          <label className="form-field" htmlFor="profile-pronouns">
            <span className="form-label">{t('editPanel.pronouns')}</span>
            <input
              id="profile-pronouns"
              className="form-input"
              maxLength={50}
              placeholder={t('editPanel.pronounsPlaceholder')}
              value={editValues.pronouns}
              onChange={(e) =>
                setEditValues((prev) => ({ ...prev, pronouns: e.currentTarget.value }))
              }
            />
          </label>

          <label className="form-field" htmlFor="profile-phone">
            <span className="form-label">{t('editPanel.phoneNumber')}</span>
            <input
              id="profile-phone"
              className="form-input"
              type="tel"
              maxLength={30}
              placeholder={t('editPanel.phonePlaceholder')}
              value={editValues.phone}
              onChange={(e) =>
                setEditValues((prev) => ({ ...prev, phone: e.currentTarget.value }))
              }
            />
          </label>

          <label className="form-field" htmlFor="profile-timezone">
            <span className="form-label">{t('editPanel.timezone')}</span>
            <input
              id="profile-timezone"
              className="form-input"
              maxLength={50}
              placeholder={t('editPanel.timezonePlaceholder')}
              value={editValues.timezone}
              onChange={(e) =>
                setEditValues((prev) => ({ ...prev, timezone: e.currentTarget.value }))
              }
            />
          </label>

          <label className="form-field" htmlFor="profile-bio">
            <span className="form-label">{t('editPanel.bio')}</span>
            <textarea
              id="profile-bio"
              className="form-input"
              rows={4}
              maxLength={500}
              placeholder={t('editPanel.bioPlaceholder')}
              value={editValues.bio}
              onChange={(e) =>
                setEditValues((prev) => ({ ...prev, bio: e.currentTarget.value }))
              }
            />
            <span className="form-field-hint">{editValues.bio.length}/500</span>
          </label>

          <fieldset className="form-fieldset">
            <legend className="form-fieldset-legend">{t('editPanel.emergencyContactLegend')}</legend>

            <label className="form-field" htmlFor="profile-ec-name">
              <span className="form-label">{t('editPanel.ecName')}</span>
              <input
                id="profile-ec-name"
                className="form-input"
                maxLength={200}
                placeholder={t('editPanel.ecNamePlaceholder')}
                value={editValues.emergencyContactName}
                onChange={(e) =>
                  setEditValues((prev) => ({
                    ...prev,
                    emergencyContactName: e.currentTarget.value
                  }))
                }
              />
            </label>

            <label className="form-field" htmlFor="profile-ec-phone">
              <span className="form-label">{t('editPanel.ecPhone')}</span>
              <input
                id="profile-ec-phone"
                className="form-input"
                type="tel"
                maxLength={30}
                placeholder={t('editPanel.ecPhonePlaceholder')}
                value={editValues.emergencyContactPhone}
                onChange={(e) =>
                  setEditValues((prev) => ({
                    ...prev,
                    emergencyContactPhone: e.currentTarget.value
                  }))
                }
              />
            </label>

            <label className="form-field" htmlFor="profile-ec-relationship">
              <span className="form-label">{t('editPanel.ecRelationship')}</span>
              <input
                id="profile-ec-relationship"
                className="form-input"
                maxLength={100}
                placeholder={t('editPanel.ecRelationshipPlaceholder')}
                value={editValues.emergencyContactRelationship}
                onChange={(e) =>
                  setEditValues((prev) => ({
                    ...prev,
                    emergencyContactRelationship: e.currentTarget.value
                  }))
                }
              />
            </label>
          </fieldset>

          <fieldset className="form-fieldset">
            <legend className="form-fieldset-legend">{t('editPanel.interestsLegend')}</legend>

            <label className="form-field" htmlFor="profile-music">
              <span className="form-label">{t('editPanel.favoriteMusic')}</span>
              <input
                id="profile-music"
                className="form-input"
                maxLength={200}
                placeholder={t('editPanel.musicPlaceholder')}
                value={editValues.favoriteMusic}
                onChange={(e) =>
                  setEditValues((prev) => ({
                    ...prev,
                    favoriteMusic: e.currentTarget.value
                  }))
                }
              />
            </label>

            <label className="form-field" htmlFor="profile-books">
              <span className="form-label">{t('editPanel.favoriteBooks')}</span>
              <input
                id="profile-books"
                className="form-input"
                maxLength={200}
                placeholder={t('editPanel.booksPlaceholder')}
                value={editValues.favoriteBooks}
                onChange={(e) =>
                  setEditValues((prev) => ({
                    ...prev,
                    favoriteBooks: e.currentTarget.value
                  }))
                }
              />
            </label>

            <label className="form-field" htmlFor="profile-sports">
              <span className="form-label">{t('editPanel.favoriteSports')}</span>
              <input
                id="profile-sports"
                className="form-input"
                maxLength={200}
                placeholder={t('editPanel.sportsPlaceholder')}
                value={editValues.favoriteSports}
                onChange={(e) =>
                  setEditValues((prev) => ({
                    ...prev,
                    favoriteSports: e.currentTarget.value
                  }))
                }
              />
            </label>
          </fieldset>

          <div className="slide-panel-actions">
            <button type="button" className="button button-ghost" onClick={closeEdit}>
              {tCommon('cancel')}
            </button>
            <button type="submit" className="button button-accent" disabled={isSaving}>
              {isSaving ? tCommon('working') : tCommon('save')}
            </button>
          </div>
        </form>
      </SlidePanel>

      {/* Admin Edit Slide Panel */}
      <SlidePanel
        isOpen={isAdminEditOpen}
        title={person ? t('adminEditPanel.titleWithName', { name: person.fullName }) : t('adminEditPanel.titleDefault')}
        description={t('adminEditPanel.description')}
        onClose={closeAdminEdit}
      >
        {person ? (
          <form className="slide-panel-form-wrapper" onSubmit={handleAdminEditSave} noValidate>
            {adminEditError ? <div className="form-error-banner">{adminEditError}</div> : null}

            <label className="form-field" htmlFor="admin-edit-title">
              <span className="form-label">{t('adminEditPanel.jobTitle')}</span>
              <input
                id="admin-edit-title"
                className="form-input"
                maxLength={200}
                placeholder={t('adminEditPanel.jobTitlePlaceholder')}
                value={adminEditValues.title}
                onChange={(e) => {
                  const val = e.currentTarget.value;
                  setAdminEditValues((prev) => ({ ...prev, title: val }));
                }}
              />
            </label>

            <label className="form-field" htmlFor="admin-edit-start-date">
              <span className="form-label">{t('adminEditPanel.startDate')}</span>
              <input
                id="admin-edit-start-date"
                type="date"
                className="form-input"
                value={adminEditValues.startDate}
                onChange={(e) => {
                  const val = e.currentTarget.value;
                  setAdminEditValues((prev) => ({ ...prev, startDate: val }));
                }}
              />
            </label>

            <fieldset className="form-field people-role-fieldset">
              <legend className="form-label">{t('adminEditPanel.roles')}</legend>
              <div className="people-role-selection">
                {USER_ROLES.map((role) => (
                  <label key={`admin-role-${role}`} className="settings-checkbox">
                    <input
                      type="checkbox"
                      checked={adminEditValues.roles.includes(role)}
                      onChange={() => handleAdminEditRoleToggle(role)}
                    />
                    <span>{roleLabels[role]}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <label className="form-field" htmlFor="admin-edit-department">
              <span className="form-label">{t('adminEditPanel.department')}</span>
              <select
                id="admin-edit-department"
                className="form-input"
                value={adminEditValues.department}
                onChange={(e) => {
                  const val = e.currentTarget.value;
                  setAdminEditValues((prev) => ({ ...prev, department: val }));
                }}
              >
                <option value="">{t('adminEditPanel.noDepartment')}</option>
                {DEPARTMENTS.map((dept) => (
                  <option key={dept} value={dept}>
                    {dept}
                  </option>
                ))}
              </select>
            </label>

            <label className="form-field" htmlFor="admin-edit-manager">
              <span className="form-label">{t('adminEditPanel.manager')}</span>
              <select
                id="admin-edit-manager"
                className="form-input"
                value={adminEditValues.managerId}
                onChange={(e) => {
                  const val = e.currentTarget.value;
                  setAdminEditValues((prev) => ({ ...prev, managerId: val }));
                }}
              >
                <option value="">{t('adminEditPanel.noManager')}</option>
                {allPeople
                  .filter((p) => p.id !== person.id && p.status === "active")
                  .sort((a, b) => a.fullName.localeCompare(b.fullName))
                  .map((p) => (
                    <option key={`admin-mgr-${p.id}`} value={p.id}>
                      {p.fullName}
                    </option>
                  ))}
              </select>
            </label>

            <label className="form-field" htmlFor="admin-edit-status">
              <span className="form-label">{t('adminEditPanel.statusLabel')}</span>
              <select
                id="admin-edit-status"
                className="form-input"
                value={adminEditValues.status}
                onChange={(e) => {
                  const val = e.currentTarget.value;
                  setAdminEditValues((prev) => ({ ...prev, status: val }));
                }}
              >
                <option value="active">{t('adminEditPanel.statusActive')}</option>
                <option value="onboarding">{t('adminEditPanel.statusOnboarding')}</option>
                <option value="offboarding">{t('adminEditPanel.statusOffboarding')}</option>
                <option value="inactive">{t('adminEditPanel.statusInactive')}</option>
              </select>
            </label>

            <div className="slide-panel-actions">
              <button type="button" className="button button-ghost" onClick={closeAdminEdit} disabled={isAdminEditSaving}>
                {tCommon('cancel')}
              </button>
              <button type="submit" className="button button-accent" disabled={isAdminEditSaving}>
                {isAdminEditSaving ? tCommon('working') : tCommon('save')}
              </button>
            </div>
          </form>
        ) : null}
      </SlidePanel>

      {/* Invite Confirmation Dialog */}
      <ConfirmDialog
        isOpen={inviteConfirmOpen}
        title={t('confirmInvite.title')}
        description={
          person
            ? t('confirmInvite.description', { name: person.fullName, email: person.email })
            : ""
        }
        confirmLabel={t('confirmInvite.confirmLabel')}
        isConfirming={isInviting}
        onConfirm={() => void handleSendInvite()}
        onCancel={() => setInviteConfirmOpen(false)}
      />

      {/* Disable / Enable Account Confirmation Dialog */}
      <ConfirmDialog
        isOpen={confirmDisableOpen}
        title={
          person?.status === "inactive"
            ? t('confirmDisable.enableTitle', { name: person?.fullName ?? t('confirmDisable.thisPerson') })
            : t('confirmDisable.disableTitle', { name: person?.fullName ?? t('confirmDisable.thisPerson') })
        }
        description={
          person?.status === "inactive"
            ? t('confirmDisable.enableDescription', { name: person?.fullName ?? t('confirmDisable.thisPerson') })
            : t('confirmDisable.disableDescription', { name: person?.fullName ?? t('confirmDisable.thisPerson') })
        }
        confirmLabel={person?.status === "inactive" ? t('confirmDisable.enableLabel') : t('confirmDisable.disableLabel')}
        tone={person?.status === "inactive" ? "default" : "danger"}
        isConfirming={isTogglingStatus}
        onConfirm={() => void handleToggleAccountStatus()}
        onCancel={() => setConfirmDisableOpen(false)}
      />
    </section>
  );
}
