"use client";

import {
  type ChangeEvent,
  type FormEvent,
  useMemo,
  useState
} from "react";
import { z } from "zod";

import { EmptyState } from "../../../components/shared/empty-state";
import { PageHeader } from "../../../components/shared/page-header";
import { SlidePanel } from "../../../components/shared/slide-panel";
import { StatusBadge } from "../../../components/shared/status-badge";
import { useAnnouncements } from "../../../hooks/use-announcements";
import { useUnsavedGuard } from "../../../hooks/use-unsaved-guard";
import { formatDateTimeTooltip, formatRelativeTime } from "../../../lib/datetime";
import { Megaphone } from "lucide-react";
import type {
  Announcement,
  AnnouncementMutationResponse,
  AnnouncementReadResponse
} from "../../../types/announcements";
import { humanizeError } from "@/lib/errors";

type AnnouncementsClientProps = {
  canManageAnnouncements: boolean;
  currentUserName: string;
};

type ToastVariant = "success" | "error" | "info";

type ToastMessage = {
  id: string;
  message: string;
  variant: ToastVariant;
};

const announcementFormSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200, "Title is too long"),
  body: z.string().trim().min(1, "Body is required").max(5000, "Body is too long"),
  isPinned: z.boolean()
});

type AnnouncementFormValues = z.infer<typeof announcementFormSchema>;
type AnnouncementFormField = "title" | "body";
type AnnouncementFormErrors = Partial<Record<AnnouncementFormField, string>>;
type AnnouncementFormTouched = Record<AnnouncementFormField, boolean>;

const INITIAL_FORM_VALUES: AnnouncementFormValues = {
  title: "",
  body: "",
  isPinned: false
};

const INITIAL_FORM_TOUCHED: AnnouncementFormTouched = {
  title: false,
  body: false
};

const ALL_FIELDS_TOUCHED: AnnouncementFormTouched = {
  title: true,
  body: true
};

function createToastId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function hasAnyFormError(errors: AnnouncementFormErrors): boolean {
  return Boolean(errors.title || errors.body);
}

function getValidationErrors(
  values: AnnouncementFormValues,
  touched: AnnouncementFormTouched
): AnnouncementFormErrors {
  const parsed = announcementFormSchema.safeParse(values);

  if (parsed.success) {
    return {};
  }

  const fieldErrors = parsed.error.flatten().fieldErrors;

  return {
    title: touched.title ? fieldErrors.title?.[0] : undefined,
    body: touched.body ? fieldErrors.body?.[0] : undefined
  };
}

function AnnouncementCard({
  announcement,
  canManageAnnouncements,
  isMarkingRead,
  onMarkRead,
  onEdit
}: {
  announcement: Announcement;
  canManageAnnouncements: boolean;
  isMarkingRead: boolean;
  onMarkRead: (announcementId: string) => void;
  onEdit: (announcement: Announcement) => void;
}) {
  return (
    <li
      className={
        announcement.isRead
          ? "announcement-item"
          : "announcement-item announcement-item-unread"
      }
    >
      <article className="announcement-item-card">
        <header className="announcement-item-header">
          <div>
            <h3 className="announcement-item-title">{announcement.title}</h3>
            <p className="announcement-item-meta">
              <time
                dateTime={announcement.createdAt}
                title={formatDateTimeTooltip(announcement.createdAt)}
              >
                {formatRelativeTime(announcement.createdAt)}
              </time>
              <span aria-hidden="true">•</span>
              <span>{announcement.creatorName}</span>
            </p>
          </div>
          <div className="announcement-item-status">
            {announcement.isPinned ? (
              <StatusBadge tone="info">Pinned</StatusBadge>
            ) : null}
            {announcement.isRead ? (
              <span className="announcement-read-check" title="Read">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    d="M5 12.5l4.5 4.5L19 7.5"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    fill="none"
                  />
                </svg>
                Read
              </span>
            ) : (
              <StatusBadge tone="pending">Unread</StatusBadge>
            )}
          </div>
        </header>

        <p className="announcement-item-body">{announcement.body}</p>

        <div className="announcement-row-actions">
          {!announcement.isRead ? (
            <button
              type="button"
              className="table-row-action"
              onClick={() => onMarkRead(announcement.id)}
              disabled={isMarkingRead}
            >
              {isMarkingRead ? "Marking..." : "Mark read"}
            </button>
          ) : null}
          {canManageAnnouncements ? (
            <button
              type="button"
              className="table-row-action"
              onClick={() => onEdit(announcement)}
            >
              Edit
            </button>
          ) : null}
        </div>
      </article>
    </li>
  );
}

function AnnouncementsSkeleton() {
  return (
    <div className="announcements-skeleton-grid" aria-hidden="true">
      {Array.from({ length: 2 }, (_, sectionIndex) => (
        <section key={`announcement-skeleton-section-${sectionIndex}`} className="settings-card">
          <div className="announcements-skeleton-row announcements-skeleton-title" />
          {Array.from({ length: 3 }, (_, rowIndex) => (
            <div key={`announcement-skeleton-${sectionIndex}-${rowIndex}`} className="announcements-skeleton-row" />
          ))}
        </section>
      ))}
    </div>
  );
}

export function AnnouncementsClient({
  canManageAnnouncements,
  currentUserName
}: AnnouncementsClientProps) {
  const {
    announcements,
    isLoading,
    errorMessage,
    refresh,
    setAnnouncements
  } = useAnnouncements();

  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [editingAnnouncementId, setEditingAnnouncementId] = useState<string | null>(null);
  const [formValues, setFormValues] = useState<AnnouncementFormValues>(INITIAL_FORM_VALUES);
  const [formTouched, setFormTouched] = useState<AnnouncementFormTouched>(INITIAL_FORM_TOUCHED);
  const [formErrors, setFormErrors] = useState<AnnouncementFormErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isMarkingReadById, setIsMarkingReadById] = useState<Record<string, boolean>>({});
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [announcementFormDirty, setAnnouncementFormDirty] = useState(false);
  useUnsavedGuard(announcementFormDirty);

  const pinnedAnnouncements = useMemo(
    () => announcements.filter((announcement) => announcement.isPinned),
    [announcements]
  );

  const recentAnnouncements = useMemo(
    () => announcements.filter((announcement) => !announcement.isPinned),
    [announcements]
  );

  const openCreatePanel = () => {
    setEditingAnnouncementId(null);
    setFormValues(INITIAL_FORM_VALUES);
    setFormTouched(INITIAL_FORM_TOUCHED);
    setFormErrors({});
    setSubmitError(null);
    setIsPanelOpen(true);
  };

  const openEditPanel = (announcement: Announcement) => {
    setEditingAnnouncementId(announcement.id);
    setFormValues({
      title: announcement.title,
      body: announcement.body,
      isPinned: announcement.isPinned
    });
    setFormTouched(INITIAL_FORM_TOUCHED);
    setFormErrors({});
    setSubmitError(null);
    setIsPanelOpen(true);
  };

  const closePanel = () => {
    setIsPanelOpen(false);
    setEditingAnnouncementId(null);
    setFormValues(INITIAL_FORM_VALUES);
    setFormTouched(INITIAL_FORM_TOUCHED);
    setFormErrors({});
    setSubmitError(null);
    setAnnouncementFormDirty(false);
  };

  const dismissToast = (toastId: string) => {
    setToasts((currentToasts) => currentToasts.filter((toast) => toast.id !== toastId));
  };

  const showToast = (variant: ToastVariant, rawMessage: string) => {
    const message = variant === "error" ? humanizeError(rawMessage) : rawMessage;
    const toastId = createToastId();

    setToasts((currentToasts) => [...currentToasts, { id: toastId, variant, message }]);

    window.setTimeout(() => {
      dismissToast(toastId);
    }, 4000);
  };

  const handleTitleOrBodyChange =
    (field: AnnouncementFormField) =>
    (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const nextValues = {
        ...formValues,
        [field]: event.currentTarget.value
      };

      setFormValues(nextValues);
      setAnnouncementFormDirty(true);

      if (formTouched[field]) {
        setFormErrors(getValidationErrors(nextValues, formTouched));
      }

      if (submitError) {
        setSubmitError(null);
      }
    };

  const handleFieldBlur = (field: AnnouncementFormField) => () => {
    const nextTouched = {
      ...formTouched,
      [field]: true
    };

    setFormTouched(nextTouched);
    setFormErrors(getValidationErrors(formValues, nextTouched));
  };

  const handlePinnedToggle = (event: ChangeEvent<HTMLInputElement>) => {
    const nextValues = {
      ...formValues,
      isPinned: event.currentTarget.checked
    };

    setFormValues(nextValues);
    setAnnouncementFormDirty(true);
  };

  const handleMarkRead = async (announcementId: string) => {
    setIsMarkingReadById((currentState) => ({
      ...currentState,
      [announcementId]: true
    }));

    try {
      const response = await fetch("/api/v1/announcements/read", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          announcementId
        })
      });

      const payload = (await response.json()) as AnnouncementReadResponse;

      if (!response.ok || !payload.data) {
        showToast("error", payload.error?.message ?? "Unable to mark announcement as read.");
        return;
      }

      setAnnouncements((currentAnnouncements) =>
        currentAnnouncements.map((announcement) =>
          announcement.id === announcementId
            ? {
                ...announcement,
                isRead: true,
                readAt: payload.data?.readAt ?? announcement.readAt
              }
            : announcement
        )
      );

      showToast("info", "Announcement marked as read.");
    } catch (error) {
      showToast(
        "error",
        error instanceof Error ? error.message : "Unable to mark announcement as read."
      );
    } finally {
      setIsMarkingReadById((currentState) => {
        const nextState = { ...currentState };
        delete nextState[announcementId];
        return nextState;
      });
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    setFormTouched(ALL_FIELDS_TOUCHED);
    const nextErrors = getValidationErrors(formValues, ALL_FIELDS_TOUCHED);
    setFormErrors(nextErrors);
    setSubmitError(null);

    if (hasAnyFormError(nextErrors)) {
      return;
    }

    setIsSaving(true);

    const payload = {
      title: formValues.title.trim(),
      body: formValues.body.trim(),
      isPinned: formValues.isPinned
    };

    const endpoint = editingAnnouncementId
      ? `/api/v1/announcements/${editingAnnouncementId}`
      : "/api/v1/announcements";
    const method = editingAnnouncementId ? "PATCH" : "POST";

    try {
      const response = await fetch(endpoint, {
        method,
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      const result = (await response.json()) as AnnouncementMutationResponse;

      if (!response.ok || !result.data?.announcement) {
        const message = result.error?.message ?? "Unable to save announcement.";
        setSubmitError(message);
        showToast("error", message);
        return;
      }

      showToast(
        "success",
        editingAnnouncementId ? "Announcement updated." : "Announcement published."
      );
      closePanel();
      refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to save announcement.";
      setSubmitError(message);
      showToast("error", message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Announcements"
        description="Company updates and news since your last visit."
        actions={
          canManageAnnouncements ? (
            <button type="button" className="button button-accent" onClick={openCreatePanel}>
              New announcement
            </button>
          ) : null
        }
      />

      {isLoading ? <AnnouncementsSkeleton /> : null}

      {!isLoading && errorMessage ? (
        <EmptyState
          title="Announcements are unavailable"
          description={errorMessage}
          ctaLabel="Retry"
          ctaHref="/announcements"
        />
      ) : null}

      {!isLoading && !errorMessage && announcements.length === 0 ? (
        <>
          <EmptyState
            icon={<Megaphone size={32} />}
            title="No announcements yet"
            description="Announcements will appear here once updates are published for your team."
          />
          {canManageAnnouncements ? (
            <button type="button" className="button button-accent" onClick={openCreatePanel}>
              Publish first announcement
            </button>
          ) : null}
        </>
      ) : null}

      {!isLoading && !errorMessage && announcements.length > 0 ? (
        <div className="announcements-grid">
          <section className="settings-card" aria-label="Pinned announcements">
            <header className="announcements-section-header">
              <div>
                <h2 className="section-title">Pinned</h2>
                <p className="settings-card-description">
                  High-priority updates stay at the top for everyone.
                </p>
              </div>
              <StatusBadge tone="info">{pinnedAnnouncements.length} pinned</StatusBadge>
            </header>

            {pinnedAnnouncements.length > 0 ? (
              <ul className="announcement-list">
                {pinnedAnnouncements.map((announcement) => (
                  <AnnouncementCard
                    key={announcement.id}
                    announcement={announcement}
                    canManageAnnouncements={canManageAnnouncements}
                    isMarkingRead={Boolean(isMarkingReadById[announcement.id])}
                    onMarkRead={handleMarkRead}
                    onEdit={openEditPanel}
                  />
                ))}
              </ul>
            ) : (
              <p className="announcements-muted">No pinned announcements right now.</p>
            )}
          </section>

          <section className="settings-card" aria-label="Recent announcements">
            <header className="announcements-section-header">
              <div>
                <h2 className="section-title">Recent</h2>
                <p className="settings-card-description">
                  Chronological updates, newest to oldest.
                </p>
              </div>
              <StatusBadge tone="processing">{recentAnnouncements.length} recent</StatusBadge>
            </header>

            {recentAnnouncements.length > 0 ? (
              <ul className="announcement-list">
                {recentAnnouncements.map((announcement) => (
                  <AnnouncementCard
                    key={announcement.id}
                    announcement={announcement}
                    canManageAnnouncements={canManageAnnouncements}
                    isMarkingRead={Boolean(isMarkingReadById[announcement.id])}
                    onMarkRead={handleMarkRead}
                    onEdit={openEditPanel}
                  />
                ))}
              </ul>
            ) : (
              <p className="announcements-muted">No recent non-pinned announcements right now.</p>
            )}
          </section>
        </div>
      ) : null}

      <SlidePanel
        isOpen={isPanelOpen}
        onClose={closePanel}
        title={editingAnnouncementId ? "Edit announcement" : "Create announcement"}
        description={`Visible to all Crew Hub users. Publishing as ${currentUserName}.`}
      >
        <div className="slide-panel-form-wrapper">
          <form className="settings-form" noValidate onSubmit={handleSubmit}>
            <label className="form-field" htmlFor="announcement-title">
              <span className="form-label">Title</span>
              <input
                id="announcement-title"
                name="title"
                className={formErrors.title ? "form-input form-input-error" : "form-input"}
                type="text"
                value={formValues.title}
                onChange={handleTitleOrBodyChange("title")}
                onBlur={handleFieldBlur("title")}
                aria-invalid={Boolean(formErrors.title)}
                aria-describedby={formErrors.title ? "announcement-title-error" : undefined}
                disabled={isSaving}
              />
              {formErrors.title ? (
                <p id="announcement-title-error" className="form-field-error" role="alert">
                  {formErrors.title}
                </p>
              ) : null}
            </label>

            <label className="form-field" htmlFor="announcement-body">
              <span className="form-label">Body</span>
              <textarea
                id="announcement-body"
                name="body"
                className={formErrors.body ? "form-input form-input-error" : "form-input"}
                value={formValues.body}
                onChange={handleTitleOrBodyChange("body")}
                onBlur={handleFieldBlur("body")}
                aria-invalid={Boolean(formErrors.body)}
                aria-describedby={formErrors.body ? "announcement-body-error" : undefined}
                disabled={isSaving}
                rows={6}
              />
              {formErrors.body ? (
                <p id="announcement-body-error" className="form-field-error" role="alert">
                  {formErrors.body}
                </p>
              ) : null}
            </label>

            <label className="settings-checkbox" htmlFor="announcement-pinned">
              <input
                id="announcement-pinned"
                name="isPinned"
                type="checkbox"
                checked={formValues.isPinned}
                onChange={handlePinnedToggle}
                disabled={isSaving}
              />
              <span>Pin announcement</span>
            </label>

            {submitError ? (
              <p className="form-submit-error" role="alert">
                {submitError}
              </p>
            ) : null}

            <div className="slide-panel-actions">
              <button type="button" className="button" onClick={closePanel} disabled={isSaving}>
                Cancel
              </button>
              <button type="submit" className="button button-accent" disabled={isSaving}>
                {isSaving
                  ? "Saving..."
                  : editingAnnouncementId
                    ? "Save changes"
                    : "Publish announcement"}
              </button>
            </div>
          </form>
        </div>
      </SlidePanel>

      {toasts.length > 0 ? (
        <div className="toast-region" aria-live="polite" aria-atomic="true">
          {toasts.map((toast) => (
            <div
              key={toast.id}
              className={`toast-message toast-message-${toast.variant}`}
              role="status"
            >
              <span>{toast.message}</span>
              <button
                type="button"
                className="toast-dismiss"
                onClick={() => dismissToast(toast.id)}
                aria-label="Dismiss notification"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    d="M6 6l12 12M18 6L6 18"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </>
  );
}
