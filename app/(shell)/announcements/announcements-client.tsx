"use client";

import {
  type ChangeEvent,
  type FormEvent,
  useMemo,
  useState
} from "react";
import { z } from "zod";
import Link from "next/link";

import { EmptyState } from "../../../components/shared/empty-state";
import { PageHeader } from "../../../components/shared/page-header";
import { SlidePanel } from "../../../components/shared/slide-panel";
import { StatusBadge } from "../../../components/shared/status-badge";
import { useAnnouncements } from "../../../hooks/use-announcements";
import { useNotifications } from "../../../hooks/use-notifications";
import { useUnsavedGuard } from "../../../hooks/use-unsaved-guard";
import { formatDateTimeTooltip, formatRelativeTime } from "../../../lib/datetime";
import { Archive, Megaphone } from "lucide-react";
import type {
  Announcement,
  AnnouncementDismissResponse,
  AnnouncementMutationResponse,
  AnnouncementReadResponse
} from "../../../types/announcements";
import type { NotificationRecord } from "../../../types/notifications";
import { humanizeError } from "@/lib/errors";

const NOTIFICATION_TYPE_LABELS: Record<string, string> = {
  status_change: "Status Update",
  leave_submitted: "Leave Request",
  leave_approved: "Leave Approved",
  leave_rejected: "Leave Rejected",
  expense_submitted: "Expense",
  expense_approved: "Expense Approved",
  expense_rejected: "Expense Rejected",
  payroll_approved: "Payroll",
  timesheet_submitted: "Timesheet",
  timesheet_approved: "Timesheet Approved",
  schedule_published: "Schedule",
  shift_swap_requested: "Shift Swap",
  shift_swap_accepted: "Shift Swap",
  shift_swap_rejected: "Shift Swap",
  course_assigned: "Learning",
  review_cycle_started: "Performance",
  review_reminder: "Performance",
  survey_launched: "Survey",
  document_expiry_warning: "Document",
  signature_requested: "Signature",
  signature_signed: "Signature",
  signature_completed: "Signature",
  compliance_policy_acknowledgment: "Compliance"
};

function getNotificationTypeLabel(type: string): string {
  return NOTIFICATION_TYPE_LABELS[type] ?? "Notification";
}

type AnnouncementsClientProps = {
  canManageAnnouncements: boolean;
  isSuperAdmin: boolean;
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
  isSuperAdmin,
  isArchiveView,
  isDismissing,
  isMarkingRead,
  onDismiss,
  onMarkRead,
  onEdit,
  onDelete
}: {
  announcement: Announcement;
  canManageAnnouncements: boolean;
  isSuperAdmin: boolean;
  isArchiveView: boolean;
  isDismissing: boolean;
  isMarkingRead: boolean;
  onDismiss: (announcementId: string) => void;
  onMarkRead: (announcementId: string) => void;
  onEdit: (announcement: Announcement) => void;
  onDelete: (announcement: Announcement) => void;
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
          {announcement.isRead && !isArchiveView ? (
            <button
              type="button"
              className="table-row-action"
              onClick={() => onDismiss(announcement.id)}
              disabled={isDismissing}
            >
              {isDismissing ? "Dismissing..." : "Dismiss"}
            </button>
          ) : null}
          {canManageAnnouncements && !isArchiveView ? (
            <button
              type="button"
              className="table-row-action"
              onClick={() => onEdit(announcement)}
            >
              Edit
            </button>
          ) : null}
          {isSuperAdmin && isArchiveView ? (
            <button
              type="button"
              className="table-row-action table-row-action-danger"
              onClick={() => onDelete(announcement)}
            >
              Delete
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
  isSuperAdmin,
  currentUserName
}: AnnouncementsClientProps) {
  const {
    announcements,
    isLoading,
    errorMessage,
    refresh,
    setAnnouncements
  } = useAnnouncements();

  const notificationsQuery = useNotifications({ limit: 20 });

  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [editingAnnouncementId, setEditingAnnouncementId] = useState<string | null>(null);
  const [formValues, setFormValues] = useState<AnnouncementFormValues>(INITIAL_FORM_VALUES);
  const [formTouched, setFormTouched] = useState<AnnouncementFormTouched>(INITIAL_FORM_TOUCHED);
  const [formErrors, setFormErrors] = useState<AnnouncementFormErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isMarkingReadById, setIsMarkingReadById] = useState<Record<string, boolean>>({});
  const [isDismissingById, setIsDismissingById] = useState<Record<string, boolean>>({});
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [announcementFormDirty, setAnnouncementFormDirty] = useState(false);
  useUnsavedGuard(announcementFormDirty);

  type UnifiedItem =
    | { source: "announcement"; data: Announcement }
    | { source: "notification"; data: NotificationRecord };

  const unifiedFeed = useMemo((): UnifiedItem[] => {
    const items: UnifiedItem[] = [];

    for (const a of announcements) {
      items.push({ source: "announcement", data: a });
    }

    for (const n of notificationsQuery.data?.notifications ?? []) {
      items.push({ source: "notification", data: n });
    }

    items.sort((a, b) => {
      const aPinned = a.source === "announcement" ? a.data.isPinned : false;
      const bPinned = b.source === "announcement" ? b.data.isPinned : false;
      if (aPinned && !bPinned) return -1;
      if (!aPinned && bPinned) return 1;
      return new Date(b.data.createdAt).getTime() - new Date(a.data.createdAt).getTime();
    });

    return items;
  }, [announcements, notificationsQuery.data?.notifications]);

  const totalUnreadCount = useMemo(() => {
    const unreadAnnouncements = announcements.filter((a) => !a.isRead).length;
    const unreadNotifications = notificationsQuery.data?.unreadCount ?? 0;
    return unreadAnnouncements + unreadNotifications;
  }, [announcements, notificationsQuery.data?.unreadCount]);

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

      window.dispatchEvent(new CustomEvent("crew-hub:badge-refresh"));
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

  const handleDismiss = async (announcementId: string) => {
    setIsDismissingById((currentState) => ({
      ...currentState,
      [announcementId]: true
    }));

    try {
      const response = await fetch("/api/v1/announcements/dismiss", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ announcementId })
      });

      const payload = (await response.json()) as AnnouncementDismissResponse;

      if (!response.ok || !payload.data) {
        showToast("error", payload.error?.message ?? "Unable to dismiss announcement.");
        return;
      }

      setAnnouncements((currentAnnouncements) =>
        currentAnnouncements.filter((a) => a.id !== announcementId)
      );

      window.dispatchEvent(new CustomEvent("crew-hub:badge-refresh"));
      showToast("info", "Announcement dismissed.");
    } catch (error) {
      showToast(
        "error",
        error instanceof Error ? error.message : "Unable to dismiss announcement."
      );
    } finally {
      setIsDismissingById((currentState) => {
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
        title="Notifications"
        description="Company updates, alerts, and messages since your last visit."
        actions={
          <div className="page-header-actions">
            <Link className="button" href="/announcements/archive">
              <Archive size={14} />
              Archive
            </Link>
            {canManageAnnouncements ? (
              <button type="button" className="button button-accent" onClick={openCreatePanel}>
                New announcement
              </button>
            ) : null}
          </div>
        }
      />

      {isLoading ? <AnnouncementsSkeleton /> : null}

      {!isLoading && errorMessage ? (
        <EmptyState
          title="Notifications are unavailable"
          description={errorMessage}
          ctaLabel="Retry"
          ctaHref="/announcements"
        />
      ) : null}

      {!isLoading && !errorMessage && unifiedFeed.length === 0 ? (
        <>
          <EmptyState
            icon={<Megaphone size={32} />}
            title="No notifications yet"
            description="Notifications and announcements will appear here."
          />
          {canManageAnnouncements ? (
            <button type="button" className="button button-accent" onClick={openCreatePanel}>
              Publish first announcement
            </button>
          ) : null}
        </>
      ) : null}

      {!isLoading && !errorMessage && unifiedFeed.length > 0 ? (
        <div className="announcements-grid">
          <section className="settings-card" aria-label="All notifications">
            <header className="announcements-section-header">
              <div>
                <h2 className="section-title">Notifications</h2>
                <p className="settings-card-description">
                  All updates, newest first. Pinned items stay at the top.
                </p>
              </div>
              {totalUnreadCount > 0 ? (
                <StatusBadge tone="pending">{totalUnreadCount} unread</StatusBadge>
              ) : null}
            </header>

            <ul className="announcement-list">
              {unifiedFeed.map((item) => {
                if (item.source === "announcement") {
                  return (
                    <AnnouncementCard
                      key={`announcement-${item.data.id}`}
                      announcement={item.data}
                      canManageAnnouncements={canManageAnnouncements}
                      isSuperAdmin={isSuperAdmin}
                      isArchiveView={false}
                      isDismissing={Boolean(isDismissingById[item.data.id])}
                      isMarkingRead={Boolean(isMarkingReadById[item.data.id])}
                      onDismiss={handleDismiss}
                      onMarkRead={handleMarkRead}
                      onEdit={openEditPanel}
                      onDelete={() => {}}
                    />
                  );
                }

                const notification = item.data;
                return (
                  <li
                    key={`notification-${notification.id}`}
                    className={
                      notification.isRead
                        ? "announcement-item"
                        : "announcement-item announcement-item-unread"
                    }
                  >
                    <article className="announcement-item-card">
                      <header className="announcement-item-header">
                        <div>
                          <div className="notification-type-row">
                            <span className="notification-type-label">
                              {getNotificationTypeLabel(notification.type)}
                            </span>
                          </div>
                          <h3 className="announcement-item-title">{notification.title}</h3>
                          <p className="announcement-item-meta">
                            <time
                              dateTime={notification.createdAt}
                              title={formatDateTimeTooltip(notification.createdAt)}
                            >
                              {formatRelativeTime(notification.createdAt)}
                            </time>
                          </p>
                        </div>
                        <div className="announcement-item-status">
                          {notification.isRead ? (
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
                      <p className="announcement-item-body">{notification.body}</p>
                      <div className="announcement-row-actions">
                        {!notification.isRead ? (
                          <button
                            type="button"
                            className="table-row-action"
                            onClick={() => {
                              void notificationsQuery.markRead(notification.id).then(() => {
                                window.dispatchEvent(new CustomEvent("crew-hub:badge-refresh"));
                              });
                            }}
                          >
                            Mark read
                          </button>
                        ) : null}
                        {notification.link ? (
                          <Link href={notification.link} className="table-row-action">
                            View
                          </Link>
                        ) : null}
                      </div>
                    </article>
                  </li>
                );
              })}
            </ul>
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
