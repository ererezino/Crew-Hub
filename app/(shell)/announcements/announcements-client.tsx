"use client";

import {
  type ChangeEvent,
  type FormEvent,
  useEffect,
  useMemo,
  useState
} from "react";
import { z } from "zod";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";

import { ConfirmDialog } from "../../../components/shared/confirm-dialog";
import { EmptyState } from "../../../components/shared/empty-state";
import { PageHeader } from "../../../components/shared/page-header";
import { SlidePanel } from "../../../components/shared/slide-panel";
import { StatusBadge } from "../../../components/shared/status-badge";
import { useAnnouncements } from "../../../hooks/use-announcements";
import { useNotifications } from "../../../hooks/use-notifications";
import { useUnsavedGuard } from "../../../hooks/use-unsaved-guard";
import { formatDateTimeTooltip, formatRelativeTime } from "../../../lib/datetime";
import { Archive, ChevronLeft, ChevronRight, Download, FileText, ImageIcon, Maximize2, Megaphone, Paperclip, X } from "lucide-react";
import type {
  Announcement,
  AnnouncementDismissResponse,
  AnnouncementMutationResponse,
  AnnouncementReadResponse
} from "../../../types/announcements";
import type { NotificationRecord } from "../../../types/notifications";
import { humanizeError } from "@/lib/errors";

type AppLocale = "en" | "fr";

const NOTIFICATION_TYPE_KEYS: Record<string, string> = {
  status_change: "typeStatusChange",
  leave_submitted: "typeLeaveSubmitted",
  leave_approved: "typeLeaveApproved",
  leave_rejected: "typeLeaveRejected",
  expense_submitted: "typeExpenseSubmitted",
  expense_approved: "typeExpenseApproved",
  expense_rejected: "typeExpenseRejected",
  payroll_approved: "typePayrollApproved",
  schedule_published: "typeSchedulePublished",
  shift_swap_requested: "typeShiftSwap",
  shift_swap_accepted: "typeShiftSwap",
  shift_swap_rejected: "typeShiftSwap",
  course_assigned: "typeCourseAssigned",
  review_cycle_started: "typeReviewCycle",
  review_reminder: "typeReviewCycle",
  survey_launched: "typeSurvey",
  document_expiry_warning: "typeDocumentExpiry",
  signature_requested: "typeSignature",
  signature_signed: "typeSignature",
  signature_completed: "typeSignature",
  compliance_policy_acknowledgment: "typeCompliance"
};

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

type AnnouncementFormValues = {
  title: string;
  body: string;
  isPinned: boolean;
};
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
  onDelete,
  onOpenLightbox,
  t,
  locale
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
  onOpenLightbox: (announcementId: string, images: { attachmentId: string; fileName: string }[], index: number, preloadedSrc: string) => void;
  t: (key: string, params?: Record<string, unknown>) => string;
  locale: AppLocale;
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
                title={formatDateTimeTooltip(announcement.createdAt, locale)}
              >
                {formatRelativeTime(announcement.createdAt, locale)}
              </time>
              <span aria-hidden="true">&bull;</span>
              <span>{announcement.creatorName}</span>
            </p>
          </div>
          <div className="announcement-item-status">
            {announcement.isPinned ? (
              <StatusBadge tone="info">{t('pinned')}</StatusBadge>
            ) : null}
            {announcement.isRead ? (
              <span className="announcement-read-check" title={t('read')}>
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
                {t('read')}
              </span>
            ) : (
              <StatusBadge tone="pending">{t('unread')}</StatusBadge>
            )}
          </div>
        </header>

        <p className="announcement-item-body">{announcement.body}</p>

        {announcement.attachments.length > 0 ? (
          <div className="att-section">
            {/* Inline images */}
            {announcement.attachments.some((a) => a.mimeType.startsWith("image/")) ? (
              <div className="att-gallery">
                {(() => {
                  const imageAtts = announcement.attachments.filter((a) => a.mimeType.startsWith("image/"));
                  return imageAtts.map((attachment, idx) => (
                    <AnnouncementImage
                      key={attachment.id}
                      announcementId={announcement.id}
                      attachmentId={attachment.id}
                      fileName={attachment.fileName}
                      onOpen={(preloadedSrc: string) => {
                        onOpenLightbox(
                          announcement.id,
                          imageAtts.map((a) => ({ attachmentId: a.id, fileName: a.fileName })),
                          idx,
                          preloadedSrc
                        );
                      }}
                    />
                  ));
                })()}
              </div>
            ) : null}

            {/* Non-image file attachments */}
            {announcement.attachments.some((a) => !a.mimeType.startsWith("image/")) ? (
              <div className="att-files">
                {announcement.attachments
                  .filter((a) => !a.mimeType.startsWith("image/"))
                  .map((attachment) => (
                    <AttachmentFileChip
                      key={attachment.id}
                      announcementId={announcement.id}
                      attachmentId={attachment.id}
                      fileName={attachment.fileName}
                      mimeType={attachment.mimeType}
                    />
                  ))}
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="announcement-row-actions">
          {!announcement.isRead ? (
            <button
              type="button"
              className="table-row-action"
              onClick={() => onMarkRead(announcement.id)}
              disabled={isMarkingRead}
            >
              {isMarkingRead ? t('markingRead') : t('markRead')}
            </button>
          ) : null}
          {announcement.isRead && !isArchiveView ? (
            <button
              type="button"
              className="table-row-action"
              onClick={() => onDismiss(announcement.id)}
              disabled={isDismissing}
            >
              {isDismissing ? t('dismissing') : t('dismiss')}
            </button>
          ) : null}
          {canManageAnnouncements && !isArchiveView ? (
            <button
              type="button"
              className="table-row-action"
              onClick={() => onEdit(announcement)}
            >
              {t('edit')}
            </button>
          ) : null}
          {isSuperAdmin ? (
            <button
              type="button"
              className="table-row-action table-row-action-danger"
              onClick={() => onDelete(announcement)}
            >
              {t('delete')}
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

/* ─── Lazy-loaded announcement image ─── */

function AnnouncementImage({
  announcementId,
  attachmentId,
  fileName,
  onOpen
}: {
  announcementId: string;
  attachmentId: string;
  fileName: string;
  onOpen?: (src: string) => void;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch(
          `/api/v1/announcements/${announcementId}/attachments/${attachmentId}`
        );
        if (!res.ok) { setError(true); return; }
        const json = await res.json();
        if (!cancelled && json.data?.url) {
          setSrc(json.data.url);
        } else {
          setError(true);
        }
      } catch {
        if (!cancelled) setError(true);
      }
    }

    void load();
    return () => { cancelled = true; };
  }, [announcementId, attachmentId]);

  if (error) {
    return (
      <div className="att-img-error">
        <ImageIcon size={20} aria-hidden="true" />
        <span>{fileName}</span>
      </div>
    );
  }

  if (!src) {
    return <div className="att-img-skeleton" />;
  }

  return (
    <button
      type="button"
      className="att-img-link"
      onClick={() => onOpen?.(src)}
      title={fileName}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={fileName} className="att-img" loading="lazy" />
      <span className="att-img-overlay">
        <Maximize2 size={16} aria-hidden="true" />
      </span>
    </button>
  );
}

/* ─── Attachment file chip ─── */

function AttachmentFileChip({
  announcementId,
  attachmentId,
  fileName,
  mimeType
}: {
  announcementId: string;
  attachmentId: string;
  fileName: string;
  mimeType: string;
}) {
  const [href, setHref] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch(
          `/api/v1/announcements/${announcementId}/attachments/${attachmentId}`
        );
        if (!res.ok) return;
        const json = await res.json();
        if (!cancelled && json.data?.url) {
          setHref(json.data.url);
        }
      } catch {
        // silent
      }
    }

    void load();
    return () => { cancelled = true; };
  }, [announcementId, attachmentId]);

  const isPdf = mimeType === "application/pdf";

  return (
    <a
      className="att-file-chip"
      href={href ?? "#"}
      target="_blank"
      rel="noopener noreferrer"
      aria-disabled={!href}
    >
      {isPdf ? <FileText size={14} aria-hidden="true" /> : <Paperclip size={14} aria-hidden="true" />}
      <span className="att-file-chip-name">{fileName}</span>
      <Download size={12} aria-hidden="true" className="att-file-chip-dl" />
    </a>
  );
}

/* ─── Image lightbox ─── */

type LightboxData = {
  announcementId: string;
  images: { attachmentId: string; fileName: string }[];
  activeIndex: number;
  initialSrc: string;
};

function ImageLightbox({
  data,
  onClose
}: {
  data: LightboxData;
  onClose: () => void;
}) {
  const [activeIndex, setActiveIndex] = useState(data.activeIndex);
  const [urls, setUrls] = useState<Map<string, string>>(() => {
    const initial = new Map<string, string>();
    const att = data.images[data.activeIndex];
    if (att) initial.set(att.attachmentId, data.initialSrc);
    return initial;
  });
  const [loading, setLoading] = useState(false);

  const activeImage = data.images[activeIndex];
  const activeUrl = activeImage ? urls.get(activeImage.attachmentId) : undefined;

  useEffect(() => {
    if (!activeImage || urls.has(activeImage.attachmentId)) return;
    setLoading(true);
    let cancelled = false;

    fetch(`/api/v1/announcements/${data.announcementId}/attachments/${activeImage.attachmentId}`)
      .then((r) => r.json())
      .then((json) => {
        if (!cancelled && json.data?.url) {
          setUrls((prev) => {
            const next = new Map(prev);
            next.set(activeImage.attachmentId, json.data.url as string);
            return next;
          });
        }
      })
      .catch(() => { /* silent */ })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeImage?.attachmentId, data.announcementId]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onClose(); return; }
      if (e.key === "ArrowLeft" && activeIndex > 0) { setActiveIndex((i) => i - 1); return; }
      if (e.key === "ArrowRight" && activeIndex < data.images.length - 1) { setActiveIndex((i) => i + 1); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [activeIndex, data.images.length, onClose]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  return (
    <div className="lightbox-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-label={activeImage?.fileName ?? "Image"}>
      <div className="lightbox-inner" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="lightbox-close" onClick={onClose} aria-label="Close">
          <X size={20} />
        </button>

        <div className="lightbox-stage">
          {loading || !activeUrl ? (
            <div className="lightbox-spinner">
              <div className="lightbox-spinner-ring" />
            </div>
          ) : (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={activeUrl} alt={activeImage?.fileName ?? ""} className="lightbox-img" />
          )}
        </div>

        {data.images.length > 1 ? (
          <>
            <button
              type="button"
              className="lightbox-nav lightbox-nav-prev"
              onClick={() => setActiveIndex((i) => i - 1)}
              disabled={activeIndex === 0}
              aria-label="Previous image"
            >
              <ChevronLeft size={28} />
            </button>
            <button
              type="button"
              className="lightbox-nav lightbox-nav-next"
              onClick={() => setActiveIndex((i) => i + 1)}
              disabled={activeIndex === data.images.length - 1}
              aria-label="Next image"
            >
              <ChevronRight size={28} />
            </button>
            <div className="lightbox-counter">
              {activeIndex + 1} / {data.images.length}
            </div>
          </>
        ) : null}

        <div className="lightbox-filename">{activeImage?.fileName}</div>
      </div>
    </div>
  );
}

export function AnnouncementsClient({
  canManageAnnouncements,
  isSuperAdmin,
  currentUserName
}: AnnouncementsClientProps) {
  const t = useTranslations('announcements');
  const tCommon = useTranslations('common');
  const locale = useLocale() as AppLocale;
  const td = t as (key: string, params?: Record<string, unknown>) => string;

  const announcementFormSchema = useMemo(() => z.object({
    title: z.string().trim().min(1, t('validationTitleRequired')).max(200, t('validationTitleTooLong')),
    body: z.string().trim().min(1, t('validationBodyRequired')).max(5000, t('validationBodyTooLong')),
    isPinned: z.boolean()
  }), [t]);

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

  function getNotificationTypeLabel(type: string): string {
    const key = NOTIFICATION_TYPE_KEYS[type];
    return key ? td(key) : td('notificationDefault');
  }

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
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [confirmDeleteAnnouncement, setConfirmDeleteAnnouncement] = useState<Announcement | null>(null);
  const [isDeletingAnnouncement, setIsDeletingAnnouncement] = useState(false);
  useUnsavedGuard(announcementFormDirty);
  const [lightbox, setLightbox] = useState<LightboxData | null>(null);

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
    setSelectedFiles([]);
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
    setSelectedFiles([]);
    setIsPanelOpen(true);
  };

  const closePanel = () => {
    setIsPanelOpen(false);
    setEditingAnnouncementId(null);
    setFormValues(INITIAL_FORM_VALUES);
    setFormTouched(INITIAL_FORM_TOUCHED);
    setFormErrors({});
    setSubmitError(null);
    setSelectedFiles([]);
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

  const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;
  const ACCEPTED_FILE_TYPES = ".pdf,.docx,.png,.jpg,.jpeg,.gif,.webp";

  const handleFilesSelected = (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.currentTarget.files;
    if (!files || files.length === 0) return;

    const validFiles: File[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (file.size > MAX_FILE_SIZE_BYTES) {
        showToast("error", `${file.name}: file exceeds 25 MB limit.`);
        continue;
      }
      validFiles.push(file);
    }

    if (validFiles.length > 0) {
      setSelectedFiles((current) => [...current, ...validFiles]);
      setAnnouncementFormDirty(true);
    }

    // Reset the input so selecting the same file again triggers onChange
    event.currentTarget.value = "";
  };

  const handleRemoveFile = (index: number) => {
    setSelectedFiles((current) => current.filter((_, i) => i !== index));
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
        showToast("error", payload.error?.message ?? t('toastMarkReadError'));
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
      showToast("info", t('toastMarkedRead'));
    } catch (error) {
      showToast(
        "error",
        error instanceof Error ? error.message : t('toastMarkReadError')
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
        showToast("error", payload.error?.message ?? t('toastDismissError'));
        return;
      }

      setAnnouncements((currentAnnouncements) =>
        currentAnnouncements.filter((a) => a.id !== announcementId)
      );

      window.dispatchEvent(new CustomEvent("crew-hub:badge-refresh"));
      showToast("info", t('toastDismissed'));
    } catch (error) {
      showToast(
        "error",
        error instanceof Error ? error.message : t('toastDismissError')
      );
    } finally {
      setIsDismissingById((currentState) => {
        const nextState = { ...currentState };
        delete nextState[announcementId];
        return nextState;
      });
    }
  };

  const handleDeleteAnnouncement = async (announcement: Announcement) => {
    setIsDeletingAnnouncement(true);

    try {
      const response = await fetch(`/api/v1/announcements/${announcement.id}`, {
        method: "DELETE"
      });

      const payload = (await response.json()) as { data: { announcementId: string } | null; error?: { message: string } };

      if (!response.ok || !payload.data) {
        showToast("error", payload.error?.message ?? t('toastDeleteError'));
        return;
      }

      setAnnouncements((current) => current.filter((a) => a.id !== announcement.id));
      window.dispatchEvent(new CustomEvent("crew-hub:badge-refresh"));
      showToast("success", t('toastDeleted'));
    } catch (error) {
      showToast(
        "error",
        error instanceof Error ? error.message : t('toastDeleteError')
      );
    } finally {
      setIsDeletingAnnouncement(false);
      setConfirmDeleteAnnouncement(null);
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
        const message = result.error?.message ?? t('toastSaveError');
        setSubmitError(message);
        showToast("error", message);
        return;
      }

      const savedAnnouncementId = result.data.announcement.id;

      // Upload attachments sequentially after successful create/edit
      if (selectedFiles.length > 0) {
        for (const file of selectedFiles) {
          try {
            const formData = new FormData();
            formData.append("file", file);

            const uploadResponse = await fetch(
              `/api/v1/announcements/${savedAnnouncementId}/attachments`,
              { method: "POST", body: formData }
            );

            if (!uploadResponse.ok) {
              showToast("error", t('uploadFailed'));
            }
          } catch {
            showToast("error", t('uploadFailed'));
          }
        }
      }

      showToast(
        "success",
        editingAnnouncementId ? t('toastUpdated') : t('toastPublished')
      );
      closePanel();
      refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : t('toastSaveError');
      setSubmitError(message);
      showToast("error", message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          <div className="page-header-actions">
            <Link className="button" href="/announcements/archive">
              <Archive size={14} />
              {t('archive')}
            </Link>
            {canManageAnnouncements ? (
              <button type="button" className="button button-accent" onClick={openCreatePanel}>
                {t('newAnnouncement')}
              </button>
            ) : null}
          </div>
        }
      />

      {isLoading ? <AnnouncementsSkeleton /> : null}

      {!isLoading && errorMessage ? (
        <EmptyState
          title={t('unavailable')}
          description={errorMessage}
          ctaLabel={t('retry')}
          ctaHref="/announcements"
        />
      ) : null}

      {!isLoading && !errorMessage && unifiedFeed.length === 0 ? (
        <>
          <EmptyState
            icon={<Megaphone size={32} />}
            title={t('noNotificationsTitle')}
            description={t('noNotificationsDescription')}
          />
          {canManageAnnouncements ? (
            <button type="button" className="button button-accent" onClick={openCreatePanel}>
              {t('publishFirst')}
            </button>
          ) : null}
        </>
      ) : null}

      {!isLoading && !errorMessage && unifiedFeed.length > 0 ? (
        <div className="announcements-grid">
          <section className="settings-card" aria-label={t('sectionTitle')}>
            <header className="announcements-section-header">
              <div>
                <h2 className="section-title">{t('sectionTitle')}</h2>
                <p className="settings-card-description">
                  {t('sectionDescription')}
                </p>
              </div>
              {totalUnreadCount > 0 ? (
                <StatusBadge tone="pending">{t('unreadCount', { count: totalUnreadCount })}</StatusBadge>
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
                      onDelete={setConfirmDeleteAnnouncement}
                      onOpenLightbox={(aId, imgs, idx, src) => setLightbox({ announcementId: aId, images: imgs, activeIndex: idx, initialSrc: src })}
                      t={td}
                      locale={locale}
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
                              title={formatDateTimeTooltip(notification.createdAt, locale)}
                            >
                              {formatRelativeTime(notification.createdAt, locale)}
                            </time>
                          </p>
                        </div>
                        <div className="announcement-item-status">
                          {notification.isRead ? (
                            <span className="announcement-read-check" title={t('read')}>
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
                              {t('read')}
                            </span>
                          ) : (
                            <StatusBadge tone="pending">{t('unread')}</StatusBadge>
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
                            {t('markRead')}
                          </button>
                        ) : null}
                        {notification.link ? (
                          <Link href={notification.link} className="table-row-action">
                            {t('view')}
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
        title={editingAnnouncementId ? t('editPanelTitle') : t('createPanelTitle')}
        description={t('panelDescription', { name: currentUserName })}
      >
        <div className="slide-panel-form-wrapper">
          <form className="settings-form" noValidate onSubmit={handleSubmit}>
            <label className="form-field" htmlFor="announcement-title">
              <span className="form-label">{t('titleLabel')}</span>
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
              <span className="form-label">{t('bodyLabel')}</span>
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
              <span>{t('pinLabel')}</span>
            </label>

            <div className="form-field">
              <label className="form-label" htmlFor="announcement-attachments">
                {t('attachmentsLabel')}
              </label>
              <input
                id="announcement-attachments"
                type="file"
                className="form-input"
                accept={ACCEPTED_FILE_TYPES}
                multiple
                onChange={handleFilesSelected}
                disabled={isSaving}
              />
              <p className="form-hint">{t('attachmentsHint')}</p>
              {selectedFiles.length > 0 ? (
                <ul className="attachment-list">
                  {selectedFiles.map((file, index) => (
                    <li key={`${file.name}-${index}`} className="attachment-list-item">
                      <Paperclip size={14} aria-hidden="true" />
                      <span className="attachment-file-name">{file.name}</span>
                      <button
                        type="button"
                        className="button button-ghost attachment-remove-button"
                        onClick={() => handleRemoveFile(index)}
                        disabled={isSaving}
                        aria-label={`${t('removeAttachment')}: ${file.name}`}
                      >
                        <X size={14} />
                        {t('removeAttachment')}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>

            {submitError ? (
              <p className="form-submit-error" role="alert">
                {submitError}
              </p>
            ) : null}

            <div className="slide-panel-actions">
              <button type="button" className="button" onClick={closePanel} disabled={isSaving}>
                {tCommon('cancel')}
              </button>
              <button type="submit" className="button button-accent" disabled={isSaving}>
                {isSaving
                  ? t('saving')
                  : editingAnnouncementId
                    ? t('saveChanges')
                    : t('publishAnnouncement')}
              </button>
            </div>
          </form>
        </div>
      </SlidePanel>

      <ConfirmDialog
        isOpen={confirmDeleteAnnouncement !== null}
        title={t('deleteConfirmTitle')}
        description={t('deleteConfirmDescription', { title: confirmDeleteAnnouncement?.title ?? "" })}
        confirmLabel={t('deleteConfirmLabel')}
        tone="danger"
        isConfirming={isDeletingAnnouncement}
        onConfirm={() => {
          if (confirmDeleteAnnouncement) {
            void handleDeleteAnnouncement(confirmDeleteAnnouncement);
          }
        }}
        onCancel={() => setConfirmDeleteAnnouncement(null)}
      />

      {lightbox ? (
        <ImageLightbox
          key={`${lightbox.announcementId}-${lightbox.images[lightbox.activeIndex]?.attachmentId}`}
          data={lightbox}
          onClose={() => setLightbox(null)}
        />
      ) : null}

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
                aria-label={t('dismissAriaLabel')}
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
