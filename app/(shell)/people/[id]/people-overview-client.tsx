"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Employee360 } from "../../../../components/people/employee-360";
import { ErrorState } from "../../../../components/shared/error-state";
import { SlidePanel } from "../../../../components/shared/slide-panel";
import { StatusBadge } from "../../../../components/shared/status-badge";
import { countryFlagFromCode, countryNameFromCode } from "../../../../lib/countries";
import { formatDate as formatDateLib } from "../../../../lib/datetime";
import type {
  PersonRecord,
  PeopleListResponse,
  PeopleUpdateResponse,
  PrivacySettings
} from "../../../../types/people";
import type { ApiResponse } from "../../../../types/auth";

/* ── Types ── */

type PeopleOverviewClientProps = {
  employeeId: string;
  isSelf: boolean;
  isAdmin: boolean;
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

function formatDate(dateString: string | null): string {
  if (!dateString) return "--";
  return formatDateLib(dateString);
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

/* ── Component ── */

export function PeopleOverviewClient({
  employeeId,
  isSelf,
  isAdmin,
  canInitiateOffboarding
}: PeopleOverviewClientProps) {
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

  // Offboarding state
  const [isOffboardModalOpen, setIsOffboardModalOpen] = useState(false);
  const [offboardLastDay, setOffboardLastDay] = useState("");
  const [offboardReason, setOffboardReason] = useState("");
  const [offboardConfirmName, setOffboardConfirmName] = useState("");
  const [isSubmittingOffboard, setIsSubmittingOffboard] = useState(false);
  const [offboardError, setOffboardError] = useState<string | null>(null);

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
          setErrorMessage(payload.error?.message ?? "Unable to load profile.");
          return;
        }

        const found = payload.data.people.find((p) => p.id === employeeId);

        if (!found) {
          setPerson(null);
          setErrorMessage("Profile not found.");
          return;
        }

        setPerson(found);
      } catch (error) {
        if (abortController.signal.aborted) return;
        setPerson(null);
        setErrorMessage(error instanceof Error ? error.message : "Unable to load profile.");
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
  }, [employeeId, reloadToken]);

  const refresh = useCallback(() => {
    setReloadToken((v) => v + 1);
  }, []);

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
          setAvatarError(payload.error?.message ?? "Unable to upload avatar.");
          return;
        }

        setPerson((prev) =>
          prev ? { ...prev, avatarUrl: payload.data!.avatarUrl } : prev
        );
      } catch (error) {
        setAvatarError(error instanceof Error ? error.message : "Unable to upload avatar.");
      } finally {
        setIsUploadingAvatar(false);
      }
    },
    [person]
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
        setAvatarError(payload.error?.message ?? "Unable to remove avatar.");
        return;
      }

      setPerson((prev) => (prev ? { ...prev, avatarUrl: null } : prev));
    } catch (error) {
      setAvatarError(error instanceof Error ? error.message : "Unable to remove avatar.");
    } finally {
      setIsUploadingAvatar(false);
    }
  }, [person]);

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
          setSaveError(payload.error?.message ?? "Unable to save profile.");
          return;
        }

        setPerson(payload.data.person);
        setIsEditOpen(false);
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : "Unable to save profile.");
      } finally {
        setIsSaving(false);
      }
    },
    [person, editValues, privacyValues]
  );

  // Offboarding handler
  const handleOffboard = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (!person) return;

      const confirmed = window.confirm(
        `Begin offboarding for ${person.fullName}? This will move the employee to offboarding and create related tasks.`
      );

      if (!confirmed) {
        return;
      }

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
          setOffboardError(payload.error?.message ?? "Unable to initiate offboarding.");
          return;
        }

        setIsOffboardModalOpen(false);
        refresh();
      } catch (error) {
        setOffboardError(error instanceof Error ? error.message : "Unable to initiate offboarding.");
      } finally {
        setIsSubmittingOffboard(false);
      }
    },
    [person, offboardLastDay, offboardReason, offboardConfirmName, refresh]
  );

  const offboardNameMatches = person
    ? offboardConfirmName === person.fullName
    : false;

  /* ── Loading & Error States ── */

  if (isLoading) {
    return (
      <section className="profile-overview-section" aria-label="Profile overview">
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
        title="Profile unavailable"
        message={errorMessage ?? "Could not load profile data."}
        onRetry={refresh}
      />
    );
  }

  /* ── Privacy ── */

  const privacy = resolvePrivacy(person.privacySettings);
  const canSeeAll = isSelf || isAdmin;

  return (
    <section className="profile-overview-section" aria-label="Profile overview">
      {/* Header with name, avatar, and edit button */}
      <div className="profile-overview-header">
        <div className="profile-overview-identity">
          <div className="profile-overview-avatar-wrapper">
            {person.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={person.avatarUrl}
                alt={`${person.fullName} avatar`}
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
                aria-label="Change profile photo"
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
              Remove Photo
            </button>
          ) : null}
          {isSelf ? (
            <button type="button" className="button button-secondary" onClick={openEdit}>
              Edit Profile
            </button>
          ) : null}
        </div>
      </div>

      {avatarError ? (
        <div className="form-error-banner">{avatarError}</div>
      ) : null}

      {/* Details Grid */}
      <div className="profile-overview-grid">
        {/* Basic Info */}
        <div className="profile-overview-card">
          <h3 className="profile-overview-card-title">Basic Information</h3>
          <dl className="profile-overview-dl">
            {(canSeeAll || privacy.showEmail) ? (
              <>
                <dt>Email</dt>
                <dd>{person.email}</dd>
              </>
            ) : null}

            {(canSeeAll || privacy.showPhone) && person.phone ? (
              <>
                <dt>Phone</dt>
                <dd>{person.phone}</dd>
              </>
            ) : null}

            {(canSeeAll || privacy.showDepartment) ? (
              <>
                <dt>Department</dt>
                <dd>{person.department ?? "--"}</dd>
              </>
            ) : null}

            {person.countryCode ? (
              <>
                <dt>Country</dt>
                <dd>
                  <span className="country-chip">
                    <span>{countryFlagFromCode(person.countryCode)}</span>
                    <span>{countryNameFromCode(person.countryCode)}</span>
                  </span>
                </dd>
              </>
            ) : null}

            {person.timezone ? (
              <>
                <dt>Timezone</dt>
                <dd>{person.timezone}</dd>
              </>
            ) : null}

            {person.pronouns ? (
              <>
                <dt>Pronouns</dt>
                <dd>{person.pronouns}</dd>
              </>
            ) : null}

            <dt>Joined</dt>
            <dd>{formatDate(person.startDate || person.createdAt)}</dd>

            {person.managerName ? (
              <>
                <dt>Reports to</dt>
                <dd>{person.managerName}</dd>
              </>
            ) : null}
          </dl>
        </div>

        {/* Bio */}
        {(canSeeAll || privacy.showBio) ? (
          <div className="profile-overview-card">
            <h3 className="profile-overview-card-title">About</h3>
            {person.bio ? (
              <p className="profile-overview-bio">{person.bio}</p>
            ) : (
              <p className="profile-overview-empty">
                {isSelf ? "Tell your colleagues a bit about yourself." : "No bio added yet."}
              </p>
            )}
          </div>
        ) : null}

        {/* Interests */}
        {(canSeeAll || privacy.showInterests) ? (
          <div className="profile-overview-card">
            <h3 className="profile-overview-card-title">Interests</h3>
            <dl className="profile-overview-dl">
              <dt>Music</dt>
              <dd>{person.favoriteMusic || (isSelf ? "Not set" : "--")}</dd>

              <dt>Books</dt>
              <dd>{person.favoriteBooks || (isSelf ? "Not set" : "--")}</dd>

              <dt>Sports</dt>
              <dd>{person.favoriteSports || (isSelf ? "Not set" : "--")}</dd>
            </dl>
          </div>
        ) : null}

        {/* Emergency Contact (self/admin only) */}
        {canSeeAll ? (
          <div className="profile-overview-card">
            <h3 className="profile-overview-card-title">Emergency Contact</h3>
            {person.emergencyContactName ? (
              <dl className="profile-overview-dl">
                <dt>Name</dt>
                <dd>{person.emergencyContactName}</dd>

                {person.emergencyContactRelationship ? (
                  <>
                    <dt>Relationship</dt>
                    <dd>{person.emergencyContactRelationship}</dd>
                  </>
                ) : null}

                {person.emergencyContactPhone ? (
                  <>
                    <dt>Phone</dt>
                    <dd>{person.emergencyContactPhone}</dd>
                  </>
                ) : null}
              </dl>
            ) : (
              <p className="profile-overview-empty">
                {isSelf ? "Add an emergency contact for your safety." : "No emergency contact on file."}
              </p>
            )}
          </div>
        ) : null}

        {/* Work Information (read-only) */}
        <div className="profile-overview-card">
          <h3 className="profile-overview-card-title">Work Information</h3>
          <dl className="profile-overview-dl profile-overview-dl-readonly">
            <dt>Email</dt>
            <dd>{person.email}</dd>

            <dt>Department</dt>
            <dd>{person.department ?? "--"}</dd>

            <dt>Job Title</dt>
            <dd>{person.title ?? "--"}</dd>

            {person.countryCode ? (
              <>
                <dt>Country</dt>
                <dd>
                  <span className="country-chip">
                    <span>{countryFlagFromCode(person.countryCode)}</span>
                    <span>{countryNameFromCode(person.countryCode)}</span>
                  </span>
                </dd>
              </>
            ) : (
              <>
                <dt>Country</dt>
                <dd>--</dd>
              </>
            )}

            <dt>Employment Type</dt>
            <dd>{formatEmploymentType(person.employmentType)}</dd>

            {person.managerName ? (
              <>
                <dt>Manager</dt>
                <dd>{person.managerName}</dd>
              </>
            ) : null}

            <dt>Roles</dt>
            <dd>{person.roles.join(", ")}</dd>

            <dt>Start Date</dt>
            <dd>{formatDate(person.startDate)}</dd>
          </dl>
        </div>

        {/* Privacy Settings (self only) */}
        {isSelf ? (
          <div className="profile-overview-card">
            <h3 className="profile-overview-card-title">Privacy Settings</h3>
            <p className="profile-overview-privacy-desc">
              Control what your colleagues can see on your profile.
            </p>
            <div className="profile-privacy-toggles">
              {(
                [
                  { key: "showEmail" as const, label: "Email address" },
                  { key: "showPhone" as const, label: "Phone number" },
                  { key: "showDepartment" as const, label: "Department" },
                  { key: "showBio" as const, label: "Bio" },
                  { key: "showInterests" as const, label: "Interests" }
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
            <StatusBadge tone="warning">Offboarding</StatusBadge>
            <p className="offboarding-banner-text">
              This employee is being offboarded.{person.noticePeriodEndDate
                ? ` Last working day: ${formatDate(person.noticePeriodEndDate)}.`
                : ""}
            </p>
          </div>
        </div>
      ) : null}

      {/* Danger Zone -- HR Admin/Super Admin only, non-self, non-offboarding */}
      {canInitiateOffboarding && !isSelf && person.status !== "offboarding" ? (
        <div className="danger-zone">
          <h3 className="danger-zone-title">Danger zone</h3>
          <div className="danger-zone-content">
            <div className="danger-zone-description">
              <p className="danger-zone-label">Initiate offboarding</p>
              <p className="settings-card-description">
                Begin the offboarding process for this crew member. This will change their status, create offboarding tasks, and notify relevant parties.
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
              Initiate offboarding
            </button>
          </div>
        </div>
      ) : null}

      {/* Offboarding Confirmation Modal */}
      {isOffboardModalOpen && person ? (
        <div className="modal-overlay" onClick={() => setIsOffboardModalOpen(false)}>
          <div
            className="modal-dialog modal-dialog-danger"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="modal-title">Initiate offboarding for {person.fullName}</h2>
            <form onSubmit={handleOffboard} noValidate>
              {offboardError ? (
                <div className="form-error-banner">{offboardError}</div>
              ) : null}

              <label className="form-field" htmlFor="offboard-last-day">
                <span className="form-label">Last working day</span>
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
                <span className="form-label">Reason for departure</span>
                <select
                  id="offboard-reason"
                  className="form-input"
                  required
                  value={offboardReason}
                  onChange={(e) => setOffboardReason(e.currentTarget.value)}
                  disabled={isSubmittingOffboard}
                >
                  <option value="">Select a reason</option>
                  <option value="resignation">Resignation</option>
                  <option value="redundancy">Redundancy</option>
                  <option value="performance">Performance</option>
                  <option value="contract_end">Contract end</option>
                  <option value="other">Other</option>
                </select>
              </label>

              <label className="form-field" htmlFor="offboard-confirm-name">
                <span className="form-label">To confirm, type {person.fullName} below</span>
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
                  Cancel
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
                  {isSubmittingOffboard ? "Processing..." : "Begin offboarding"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {/* Edit Profile Slide Panel */}
      <SlidePanel
        isOpen={isEditOpen}
        title="Edit Profile"
        description="Update your personal information, bio, and interests."
        onClose={closeEdit}
      >
        <form className="slide-panel-form-wrapper" onSubmit={handleSave} noValidate>
          {saveError ? (
            <div className="form-error-banner">{saveError}</div>
          ) : null}

          <label className="form-field" htmlFor="profile-fullname">
            <span className="form-label">Display Name</span>
            <input
              id="profile-fullname"
              className="form-input"
              maxLength={200}
              placeholder="Your full name"
              value={editValues.fullName}
              onChange={(e) =>
                setEditValues((prev) => ({ ...prev, fullName: e.currentTarget.value }))
              }
            />
          </label>

          <label className="form-field" htmlFor="profile-pronouns">
            <span className="form-label">Pronouns</span>
            <input
              id="profile-pronouns"
              className="form-input"
              maxLength={50}
              placeholder="e.g. he/him, she/her, they/them"
              value={editValues.pronouns}
              onChange={(e) =>
                setEditValues((prev) => ({ ...prev, pronouns: e.currentTarget.value }))
              }
            />
          </label>

          <label className="form-field" htmlFor="profile-phone">
            <span className="form-label">Phone Number</span>
            <input
              id="profile-phone"
              className="form-input"
              type="tel"
              maxLength={30}
              placeholder="e.g. +1 555-0100"
              value={editValues.phone}
              onChange={(e) =>
                setEditValues((prev) => ({ ...prev, phone: e.currentTarget.value }))
              }
            />
          </label>

          <label className="form-field" htmlFor="profile-timezone">
            <span className="form-label">Timezone</span>
            <input
              id="profile-timezone"
              className="form-input"
              maxLength={50}
              placeholder="e.g. Africa/Lagos"
              value={editValues.timezone}
              onChange={(e) =>
                setEditValues((prev) => ({ ...prev, timezone: e.currentTarget.value }))
              }
            />
          </label>

          <label className="form-field" htmlFor="profile-bio">
            <span className="form-label">Bio</span>
            <textarea
              id="profile-bio"
              className="form-input"
              rows={4}
              maxLength={500}
              placeholder="Tell your colleagues about yourself..."
              value={editValues.bio}
              onChange={(e) =>
                setEditValues((prev) => ({ ...prev, bio: e.currentTarget.value }))
              }
            />
            <span className="form-field-hint">{editValues.bio.length}/500</span>
          </label>

          <fieldset className="form-fieldset">
            <legend className="form-fieldset-legend">Emergency Contact</legend>

            <label className="form-field" htmlFor="profile-ec-name">
              <span className="form-label">Name</span>
              <input
                id="profile-ec-name"
                className="form-input"
                maxLength={200}
                placeholder="Emergency contact name"
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
              <span className="form-label">Phone</span>
              <input
                id="profile-ec-phone"
                className="form-input"
                type="tel"
                maxLength={30}
                placeholder="Emergency contact phone"
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
              <span className="form-label">Relationship</span>
              <input
                id="profile-ec-relationship"
                className="form-input"
                maxLength={100}
                placeholder="e.g. Spouse, Parent, Sibling"
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
            <legend className="form-fieldset-legend">Interests</legend>

            <label className="form-field" htmlFor="profile-music">
              <span className="form-label">Favorite Music</span>
              <input
                id="profile-music"
                className="form-input"
                maxLength={200}
                placeholder="e.g. Jazz, Afrobeats, Classical"
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
              <span className="form-label">Favorite Books</span>
              <input
                id="profile-books"
                className="form-input"
                maxLength={200}
                placeholder="e.g. Atomic Habits, Deep Work"
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
              <span className="form-label">Favorite Sports</span>
              <input
                id="profile-sports"
                className="form-input"
                maxLength={200}
                placeholder="e.g. Football, Basketball, Swimming"
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
              Cancel
            </button>
            <button type="submit" className="button button-accent" disabled={isSaving}>
              {isSaving ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </form>
      </SlidePanel>
    </section>
  );
}
