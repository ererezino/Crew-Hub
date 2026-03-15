"use client";

import { useCallback, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { DocumentUploadPanel } from "../../../../components/shared/document-upload-panel";
import { EmptyState } from "../../../../components/shared/empty-state";
import { ErrorState } from "../../../../components/shared/error-state";
import { PageHeader } from "../../../../components/shared/page-header";
import { SlidePanel } from "../../../../components/shared/slide-panel";
import { StatusBadge } from "../../../../components/shared/status-badge";
import { useDocuments } from "../../../../hooks/use-documents";
import { useLetterheadEntities } from "../../../../hooks/use-letterhead-entities";
import { usePendingTravelRequests } from "../../../../hooks/use-pending-travel-requests";
import { useTravelSupport } from "../../../../hooks/use-travel-support";
import { countryFlagFromCode, countryNameFromCode } from "../../../../lib/countries";
import { formatDateShort, formatDateTimeTooltip, formatRelativeTime } from "../../../../lib/datetime";
import {
  daysUntilExpiry,
  formatFileSize,
  getDocumentCategoryLabel
} from "../../../../lib/documents";
import {
  SELF_SERVICE_DOCUMENT_CATEGORIES,
  type DocumentRecord,
  type DocumentSignedUrlResponse
} from "../../../../types/documents";
import { FileText } from "lucide-react";
import type {
  TravelSupportCreatePayload,
  TravelSupportCreateResponse,
  TravelSupportDownloadResponse,
  TravelSupportRequest,
  TravelSupportUpdateResponse
} from "../../../../types/travel-support";
import { humanizeError } from "@/lib/errors";

type AppLocale = "en" | "fr";

type MyDocumentsClientProps = {
  currentUserId: string;
  isSuperAdmin: boolean;
};

type MyDocumentsTab = "all" | "id_document" | "tax_form" | "travel_letters";
type ToastVariant = "success" | "error" | "info";
type StatusTone =
  | "success"
  | "warning"
  | "error"
  | "info"
  | "pending"
  | "draft"
  | "processing";

type ToastMessage = {
  id: string;
  variant: ToastVariant;
  message: string;
};

type TravelRequestFormValues = {
  destinationCountry: string;
  embassyName: string;
  embassyAddress: string;
  travelStartDate: string;
  travelEndDate: string;
  purpose: string;
  additionalNotes: string;
};

const INITIAL_TRAVEL_FORM: TravelRequestFormValues = {
  destinationCountry: "",
  embassyName: "",
  embassyAddress: "",
  travelStartDate: "",
  travelEndDate: "",
  purpose: "",
  additionalNotes: ""
};

const TAB_IDS: MyDocumentsTab[] = ["all", "id_document", "tax_form", "travel_letters"];
const TAB_KEYS: Record<MyDocumentsTab, string> = {
  all: "tabs.all",
  id_document: "tabs.idDocuments",
  tax_form: "tabs.taxForms",
  travel_letters: "tabs.travelLetters"
};
const ENTITY_COUNTRIES = ["USA", "Nigeria", "Canada", "Ghana", "South Africa"];

function createToastId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getExpiryStatus(expiryDate: string | null): { tone: StatusTone; labelKey: string } {
  const remainingDays = daysUntilExpiry(expiryDate);

  if (remainingDays === null) {
    return {
      tone: "draft",
      labelKey: "expiryStatus.noExpiry"
    };
  }

  if (remainingDays < 0) {
    return {
      tone: "error",
      labelKey: "expiryStatus.expired"
    };
  }

  if (remainingDays < 30) {
    return {
      tone: "warning",
      labelKey: "expiryStatus.expiringSoon"
    };
  }

  return {
    tone: "success",
    labelKey: "expiryStatus.active"
  };
}

function getTravelStatusTone(status: TravelSupportRequest["status"]): StatusTone {
  switch (status) {
    case "approved":
      return "success";
    case "rejected":
      return "error";
    case "pending":
    default:
      return "pending";
  }
}

function formatTravelDate(dateString: string, locale?: AppLocale): string {
  return formatDateShort(dateString, locale);
}

function MyDocumentsSkeleton() {
  return (
    <div className="table-skeleton" aria-hidden="true">
      <div className="table-skeleton-header" />
      {Array.from({ length: 5 }, (_, index) => (
        <div key={`my-documents-skeleton-${index}`} className="table-skeleton-row" />
      ))}
    </div>
  );
}

export function MyDocumentsClient({ currentUserId, isSuperAdmin }: MyDocumentsClientProps) {
  const t = useTranslations('myDocuments');
  const tCommon = useTranslations('common');
  const locale = useLocale() as AppLocale;
  const td = t as (key: string, params?: Record<string, unknown>) => string;
  const tdCommon = tCommon as (key: string, params?: Record<string, unknown>) => string;

  const {
    documents,
    isLoading,
    errorMessage,
    refresh,
    setDocuments
  } = useDocuments({
    scope: "mine"
  });

  const {
    requests: travelRequests,
    isLoading: isTravelLoading,
    errorMessage: travelError,
    refresh: refreshTravel
  } = useTravelSupport();

  // Admin: pending requests + entities
  const {
    requests: pendingRequests,
    isLoading: isPendingLoading,
    refresh: refreshPending
  } = usePendingTravelRequests();

  const {
    entities: letterheadEntities,
    refresh: refreshEntities
  } = useLetterheadEntities();

  const [activeTab, setActiveTab] = useState<MyDocumentsTab>("all");
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [versionTarget, setVersionTarget] = useState<DocumentRecord | null>(null);
  const [isOpeningFileById, setIsOpeningFileById] = useState<Record<string, boolean>>({});
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  // Travel support form state
  const [isTravelPanelOpen, setIsTravelPanelOpen] = useState(false);
  const [travelForm, setTravelForm] = useState<TravelRequestFormValues>(INITIAL_TRAVEL_FORM);
  const [isSubmittingTravel, setIsSubmittingTravel] = useState(false);
  const [travelFormError, setTravelFormError] = useState<string | null>(null);
  const [isDownloadingById, setIsDownloadingById] = useState<Record<string, boolean>>({});

  // Admin approval state
  const [approvalTarget, setApprovalTarget] = useState<TravelSupportRequest | null>(null);
  const [approvalCountry, setApprovalCountry] = useState("");
  const [approvalAddress, setApprovalAddress] = useState("");
  const [isApproving, setIsApproving] = useState(false);
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const [rejectionTarget, setRejectionTarget] = useState<TravelSupportRequest | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [isRejecting, setIsRejecting] = useState(false);
  const [rejectionError, setRejectionError] = useState<string | null>(null);

  const visibleDocuments = useMemo(() => {
    if (activeTab === "travel_letters") return [];

    const filtered = documents.filter((document) =>
      activeTab === "all" ? true : document.category === activeTab
    );

    return [...filtered].sort(
      (leftDocument, rightDocument) =>
        new Date(rightDocument.updatedAt).getTime() -
        new Date(leftDocument.updatedAt).getTime()
    );
  }, [activeTab, documents]);

  const dismissToast = useCallback((toastId: string) => {
    setToasts((currentToasts) => currentToasts.filter((toast) => toast.id !== toastId));
  }, []);

  const showToast = useCallback((variant: ToastVariant, rawMessage: string) => {
    const message = variant === "error" ? humanizeError(rawMessage) : rawMessage;
    const toastId = createToastId();

    setToasts((currentToasts) => [...currentToasts, { id: toastId, variant, message }]);

    window.setTimeout(() => {
      dismissToast(toastId);
    }, 4000);
  }, [dismissToast]);

  const closeUploadPanel = () => {
    setVersionTarget(null);
    setIsPanelOpen(false);
  };

  const handleUploaded = (uploadedDocument: DocumentRecord) => {
    setDocuments((currentDocuments) => {
      const existingIndex = currentDocuments.findIndex(
        (document) => document.id === uploadedDocument.id
      );

      if (existingIndex === -1) {
        return [uploadedDocument, ...currentDocuments];
      }

      const nextDocuments = [...currentDocuments];
      nextDocuments[existingIndex] = uploadedDocument;
      return nextDocuments;
    });

    showToast(
      "success",
      versionTarget ? t('toast.documentVersionUploaded') : t('toast.documentUploaded')
    );
    refresh();
  };

  const handleOpenFile = async (documentId: string) => {
    setIsOpeningFileById((currentState) => ({
      ...currentState,
      [documentId]: true
    }));

    try {
      const response = await fetch(`/api/v1/documents/${documentId}/download`, {
        method: "GET"
      });

      const payload = (await response.json()) as DocumentSignedUrlResponse;

      if (!response.ok || !payload.data?.url) {
        showToast("error", payload.error?.message ?? t('toast.unableToOpenDocument'));
        return;
      }

      window.open(payload.data.url, "_blank", "noopener,noreferrer");
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : t('toast.unableToOpenDocument'));
    } finally {
      setIsOpeningFileById((currentState) => {
        const nextState = { ...currentState };
        delete nextState[documentId];
        return nextState;
      });
    }
  };

  // Travel support handlers
  const openTravelPanel = useCallback(() => {
    setTravelForm(INITIAL_TRAVEL_FORM);
    setTravelFormError(null);
    setIsTravelPanelOpen(true);
  }, []);

  const closeTravelPanel = useCallback(() => {
    setIsTravelPanelOpen(false);
  }, []);

  const handleTravelFormChange = useCallback(
    (field: keyof TravelRequestFormValues, value: string) => {
      setTravelForm((prev) => ({ ...prev, [field]: value }));
    },
    []
  );

  const handleTravelSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      setIsSubmittingTravel(true);
      setTravelFormError(null);

      const payload: TravelSupportCreatePayload = {
        destinationCountry: travelForm.destinationCountry.trim(),
        embassyName: travelForm.embassyName.trim(),
        embassyAddress: travelForm.embassyAddress.trim() || undefined,
        travelStartDate: travelForm.travelStartDate,
        travelEndDate: travelForm.travelEndDate,
        purpose: travelForm.purpose.trim(),
        additionalNotes: travelForm.additionalNotes.trim() || undefined
      };

      try {
        const response = await fetch("/api/v1/travel-support", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });

        const result = (await response.json()) as TravelSupportCreateResponse;

        if (!response.ok || !result.data) {
          setTravelFormError(result.error?.message ?? t('toast.unableToSubmitTravel'));
          return;
        }

        setIsTravelPanelOpen(false);
        showToast("success", t('toast.travelRequestSubmitted'));
        refreshTravel();
      } catch (error) {
        setTravelFormError(
          error instanceof Error ? error.message : t('toast.unableToSubmitTravel')
        );
      } finally {
        setIsSubmittingTravel(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- t is a stable ref from useTranslations
    [travelForm, refreshTravel, showToast]
  );

  const handleDownloadTravelLetter = useCallback(
    async (requestId: string) => {
      setIsDownloadingById((prev) => ({ ...prev, [requestId]: true }));

      try {
        const response = await fetch(
          `/api/v1/travel-support/${requestId}/download?usage=download`,
          { method: "GET" }
        );

        const payload = (await response.json()) as TravelSupportDownloadResponse;

        if (!response.ok || !payload.data?.url) {
          showToast("error", payload.error?.message ?? t('toast.unableToDownloadLetter'));
          return;
        }

        window.open(payload.data.url, "_blank", "noopener,noreferrer");
      } catch (error) {
        showToast(
          "error",
          error instanceof Error ? error.message : t('toast.unableToDownloadLetter')
        );
      } finally {
        setIsDownloadingById((prev) => {
          const next = { ...prev };
          delete next[requestId];
          return next;
        });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- t is a stable ref from useTranslations
    [showToast]
  );

  // Admin: open approve panel
  const openApprovePanel = useCallback(
    (req: TravelSupportRequest) => {
      setApprovalTarget(req);
      setApprovalError(null);

      // Pre-fill with first saved entity or empty
      const firstEntity = letterheadEntities[0];
      setApprovalCountry(firstEntity?.country ?? "");
      setApprovalAddress(firstEntity?.address ?? "");
    },
    [letterheadEntities]
  );

  const handleCountryChange = useCallback(
    (country: string) => {
      setApprovalCountry(country);

      const match = letterheadEntities.find((e) => e.country === country);
      setApprovalAddress(match?.address ?? "");
    },
    [letterheadEntities]
  );

  const handleApprove = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();

      if (!approvalTarget) return;

      setIsApproving(true);
      setApprovalError(null);

      try {
        const response = await fetch(`/api/v1/travel-support/${approvalTarget.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "approve",
            entityCountry: approvalCountry.trim(),
            entityAddress: approvalAddress.trim()
          })
        });

        const result = (await response.json()) as TravelSupportUpdateResponse;

        if (!response.ok || !result.data) {
          setApprovalError(result.error?.message ?? t('toast.unableToApprove'));
          return;
        }

        setApprovalTarget(null);
        showToast("success", t('toast.travelApproved'));
        refreshPending();
        refreshTravel();
        refreshEntities();
      } catch (error) {
        setApprovalError(
          error instanceof Error ? error.message : t('toast.unableToApprove')
        );
      } finally {
        setIsApproving(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- t is a stable ref from useTranslations
    [approvalTarget, approvalCountry, approvalAddress, refreshPending, refreshTravel, refreshEntities, showToast]
  );

  // Admin: reject
  const openRejectPanel = useCallback((req: TravelSupportRequest) => {
    setRejectionTarget(req);
    setRejectionReason("");
    setRejectionError(null);
  }, []);

  const handleReject = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();

      if (!rejectionTarget) return;

      setIsRejecting(true);
      setRejectionError(null);

      try {
        const response = await fetch(`/api/v1/travel-support/${rejectionTarget.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "reject",
            rejectionReason: rejectionReason.trim()
          })
        });

        const result = (await response.json()) as TravelSupportUpdateResponse;

        if (!response.ok || !result.data) {
          setRejectionError(result.error?.message ?? t('toast.unableToReject'));
          return;
        }

        setRejectionTarget(null);
        showToast("info", t('toast.travelRejected'));
        refreshPending();
        refreshTravel();
      } catch (error) {
        setRejectionError(
          error instanceof Error ? error.message : t('toast.unableToReject')
        );
      } finally {
        setIsRejecting(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- t is a stable ref from useTranslations
    [rejectionTarget, rejectionReason, refreshPending, refreshTravel, showToast]
  );

  const countryOptions = useMemo(() => {
    const saved = new Set(letterheadEntities.map((e) => e.country));
    const all = new Set([...ENTITY_COUNTRIES, ...saved]);
    return [...all].sort();
  }, [letterheadEntities]);

  const showDocumentsView = activeTab !== "travel_letters";
  const showTravelView = activeTab === "travel_letters";

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          <>
            {showTravelView ? (
              <button
                type="button"
                className="button button-accent"
                onClick={openTravelPanel}
              >
                {t('actions.requestTravelLetter')}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="button"
                  onClick={openTravelPanel}
                >
                  {t('actions.requestTravelLetter')}
                </button>
                <button
                  type="button"
                  className="button button-accent"
                  onClick={() => setIsPanelOpen(true)}
                >
                  {t('actions.uploadDocument')}
                </button>
              </>
            )}
          </>
        }
      />

      <section className="page-tabs" aria-label={t('title')}>
        {TAB_IDS.map((tabId) => (
          <button
            key={tabId}
            type="button"
            className={activeTab === tabId ? "page-tab page-tab-active" : "page-tab"}
            onClick={() => setActiveTab(tabId)}
          >
            {td(TAB_KEYS[tabId])}
          </button>
        ))}
      </section>

      {/* ── Documents View ── */}
      {showDocumentsView ? (
        <>
          {isLoading ? <MyDocumentsSkeleton /> : null}

          {!isLoading && errorMessage ? (
            <ErrorState
              title={t('errorTitle')}
              message={errorMessage}
              onRetry={refresh}
            />
          ) : null}

          {!isLoading && !errorMessage && visibleDocuments.length === 0 ? (
            <EmptyState
              icon={<FileText size={32} />}
              title={t('emptyState.documentsTitle')}
              description={t('emptyState.documentsDescription')}
            />
          ) : null}

          {!isLoading && !errorMessage && visibleDocuments.length > 0 ? (
            <>
              <div className="my-documents-mobile-list">
                {visibleDocuments.map((document) => {
                  const expiryStatus = getExpiryStatus(document.expiryDate);

                  return (
                    <article key={`${document.id}-mobile`} className="my-document-card">
                      <header className="my-document-card-header">
                        <h2 className="section-title">{document.title}</h2>
                        <StatusBadge tone={expiryStatus.tone}>{td(expiryStatus.labelKey)}</StatusBadge>
                      </header>
                      <p className="settings-card-description">
                        {getDocumentCategoryLabel(document.category)}
                      </p>
                      <p className="settings-card-description">
                        {countryFlagFromCode(document.countryCode)} {countryNameFromCode(document.countryCode, locale)}
                      </p>
                      <p className="settings-card-description numeric">
                        {formatFileSize(document.sizeBytes)}
                      </p>
                      <div className="my-document-card-actions">
                        <button
                          type="button"
                          className="table-row-action"
                          onClick={() => handleOpenFile(document.id)}
                          disabled={Boolean(isOpeningFileById[document.id])}
                        >
                          {isOpeningFileById[document.id] ? t('actions.opening') : t('actions.open')}
                        </button>
                        <button
                          type="button"
                          className="table-row-action"
                          onClick={() => {
                            setVersionTarget(document);
                            setIsPanelOpen(true);
                          }}
                        >
                          {t('actions.newVersion')}
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>

              <div className="data-table-container my-documents-desktop-table">
                <table className="data-table" aria-label={t('title')}>
                  <thead>
                    <tr>
                      <th>{t('table.document')}</th>
                      <th>{t('table.category')}</th>
                      <th>{t('table.country')}</th>
                      <th>{t('table.expiry')}</th>
                      <th>{t('table.status')}</th>
                      <th>{t('table.size')}</th>
                      <th>{t('table.updated')}</th>
                      <th className="table-action-column">{t('table.actionsColumn')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleDocuments.map((document) => {
                      const expiryStatus = getExpiryStatus(document.expiryDate);

                      return (
                        <tr key={document.id} className="data-table-row">
                          <td>
                            <div className="documents-cell-copy">
                              <p className="documents-cell-title">{document.title}</p>
                              <p className="documents-cell-description">
                                {document.description || t('noDescription')}
                              </p>
                            </div>
                          </td>
                          <td>{getDocumentCategoryLabel(document.category)}</td>
                          <td>
                            <span className="country-chip">
                              <span>{countryFlagFromCode(document.countryCode)}</span>
                              <span>{countryNameFromCode(document.countryCode, locale)}</span>
                            </span>
                          </td>
                          <td>
                            {document.expiryDate ? (
                              <time
                                dateTime={document.expiryDate}
                                title={formatDateTimeTooltip(document.expiryDate, locale)}
                              >
                                {formatRelativeTime(document.expiryDate, locale)}
                              </time>
                            ) : (
                              "--"
                            )}
                          </td>
                          <td>
                            <StatusBadge tone={expiryStatus.tone}>{td(expiryStatus.labelKey)}</StatusBadge>
                          </td>
                          <td className="numeric">{formatFileSize(document.sizeBytes)}</td>
                          <td>
                            <time
                              dateTime={document.updatedAt}
                              title={formatDateTimeTooltip(document.updatedAt, locale)}
                            >
                              {formatRelativeTime(document.updatedAt, locale)}
                            </time>
                          </td>
                          <td className="table-row-action-cell">
                            <div className="documents-row-actions">
                              <button
                                type="button"
                                className="table-row-action"
                                onClick={() => handleOpenFile(document.id)}
                                disabled={Boolean(isOpeningFileById[document.id])}
                              >
                                {isOpeningFileById[document.id] ? t('actions.opening') : t('actions.open')}
                              </button>
                              <button
                                type="button"
                                className="table-row-action"
                                onClick={() => {
                                  setVersionTarget(document);
                                  setIsPanelOpen(true);
                                }}
                              >
                                {t('actions.newVersion')}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}
        </>
      ) : null}

      {/* ── Travel Letters View ── */}
      {showTravelView ? (
        <>
          {isTravelLoading ? <MyDocumentsSkeleton /> : null}

          {!isTravelLoading && travelError ? (
            <ErrorState
              title={t('travelLetters.errorTitle')}
              message={travelError}
              onRetry={refreshTravel}
            />
          ) : null}

          {!isTravelLoading && !travelError && travelRequests.length === 0 ? (
            <EmptyState
              title={t('travelLetters.emptyTitle')}
              description={t('travelLetters.emptyDescription')}
            />
          ) : null}

          {!isTravelLoading && !travelError && travelRequests.length > 0 ? (
            <div className="travel-letter-list">
              {travelRequests.map((req) => (
                <article key={req.id} className="travel-letter-card">
                  <header className="travel-letter-card-header">
                    <div className="travel-letter-card-title-row">
                      <h3 className="travel-letter-card-title">
                        {req.destinationCountry}
                      </h3>
                      <StatusBadge tone={getTravelStatusTone(req.status)}>
                        {tdCommon(`status.${req.status}`)}
                      </StatusBadge>
                    </div>
                    <p className="travel-letter-card-subtitle">
                      {req.embassyName}
                    </p>
                  </header>

                  <div className="travel-letter-card-details">
                    <div className="travel-letter-card-detail">
                      <span className="travel-letter-detail-label">{t('travelLetters.travelDates')}</span>
                      <span>
                        {formatTravelDate(req.travelStartDate, locale)} &ndash;{" "}
                        {formatTravelDate(req.travelEndDate, locale)}
                      </span>
                    </div>
                    <div className="travel-letter-card-detail">
                      <span className="travel-letter-detail-label">{t('travelLetters.purpose')}</span>
                      <span>{req.purpose}</span>
                    </div>
                    <div className="travel-letter-card-detail">
                      <span className="travel-letter-detail-label">{t('travelLetters.requested')}</span>
                      <span>{formatTravelDate(req.createdAt.split("T")[0] ?? req.createdAt, locale)}</span>
                    </div>
                    {req.approverName ? (
                      <div className="travel-letter-card-detail">
                        <span className="travel-letter-detail-label">
                          {req.status === "approved" ? t('travelLetters.approvedBy') : t('travelLetters.reviewedBy')}
                        </span>
                        <span>{req.approverName}</span>
                      </div>
                    ) : null}
                    {req.status === "rejected" && req.rejectionReason ? (
                      <div className="travel-letter-card-detail travel-letter-rejection">
                        <span className="travel-letter-detail-label">{t('travelLetters.reason')}</span>
                        <span>{req.rejectionReason}</span>
                      </div>
                    ) : null}
                  </div>

                  {req.status === "approved" && req.documentPath ? (
                    <div className="travel-letter-card-actions">
                      <button
                        type="button"
                        className="button button-secondary"
                        onClick={() => handleDownloadTravelLetter(req.id)}
                        disabled={Boolean(isDownloadingById[req.id])}
                      >
                        {isDownloadingById[req.id] ? t('actions.downloading') : t('actions.downloadLetter')}
                      </button>
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          ) : null}
        </>
      ) : null}

      {/* ── Admin: Pending Approvals ── */}
      {isSuperAdmin && showTravelView && !isPendingLoading && pendingRequests.length > 0 ? (
        <section className="admin-approvals-section" aria-label={t('adminApprovals.title')}>
          <h2 className="admin-approvals-heading">{t('adminApprovals.title')}</h2>
          <p className="admin-approvals-description">
            {t('adminApprovals.description')}
          </p>
          <div className="travel-letter-list">
            {pendingRequests.map((req) => (
              <article key={`pending-${req.id}`} className="travel-letter-card travel-letter-card-pending">
                <header className="travel-letter-card-header">
                  <div className="travel-letter-card-title-row">
                    <h3 className="travel-letter-card-title">
                      {req.employeeName ?? "Employee"} &rarr; {req.destinationCountry}
                    </h3>
                    <StatusBadge tone="pending">{tCommon('status.pending')}</StatusBadge>
                  </div>
                  <p className="travel-letter-card-subtitle">{req.embassyName}</p>
                </header>

                <div className="travel-letter-card-details">
                  <div className="travel-letter-card-detail">
                    <span className="travel-letter-detail-label">{t('travelLetters.travelDates')}</span>
                    <span>
                      {formatTravelDate(req.travelStartDate, locale)} &ndash;{" "}
                      {formatTravelDate(req.travelEndDate, locale)}
                    </span>
                  </div>
                  <div className="travel-letter-card-detail">
                    <span className="travel-letter-detail-label">{t('travelLetters.purpose')}</span>
                    <span>{req.purpose}</span>
                  </div>
                  <div className="travel-letter-card-detail">
                    <span className="travel-letter-detail-label">{t('travelLetters.requested')}</span>
                    <span>
                      {formatTravelDate(req.createdAt.split("T")[0] ?? req.createdAt, locale)}
                    </span>
                  </div>
                </div>

                <div className="travel-letter-card-actions">
                  <button
                    type="button"
                    className="button button-success-outline"
                    onClick={() => openApprovePanel(req)}
                  >
                    {tCommon('status.approved')}
                  </button>
                  <button
                    type="button"
                    className="button button-danger-outline"
                    onClick={() => openRejectPanel(req)}
                  >
                    {tCommon('status.rejected')}
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {/* ── Admin: Approve Panel ── */}
      <SlidePanel
        isOpen={approvalTarget !== null}
        title={t('approvePanel.title')}
        description={
          approvalTarget
            ? t('approvePanel.description', { employeeName: approvalTarget.employeeName ?? "Employee", country: approvalTarget.destinationCountry })
            : ""
        }
        onClose={() => setApprovalTarget(null)}
      >
        <form className="slide-panel-form-wrapper" onSubmit={handleApprove} noValidate>
          {approvalError ? (
            <div className="form-error-banner">{approvalError}</div>
          ) : null}

          <label className="form-field" htmlFor="entity-country">
            <span className="form-label">{t('approvePanel.issuingEntityCountry')}</span>
            <select
              id="entity-country"
              className="form-input"
              required
              value={approvalCountry}
              onChange={(e) => handleCountryChange(e.currentTarget.value)}
            >
              <option value="">{t('approvePanel.selectCountry')}</option>
              {countryOptions.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </label>

          <label className="form-field" htmlFor="entity-address">
            <span className="form-label">{t('approvePanel.entityAddress')}</span>
            <textarea
              id="entity-address"
              className="form-input"
              rows={3}
              required
              maxLength={1000}
              placeholder={t('approvePanel.entityAddressPlaceholder')}
              value={approvalAddress}
              onChange={(e) => setApprovalAddress(e.currentTarget.value)}
            />
            <span className="form-hint">
              {t('approvePanel.entityAddressHint')}
            </span>
          </label>

          <div className="slide-panel-actions">
            <button
              type="button"
              className="button button-ghost"
              onClick={() => setApprovalTarget(null)}
            >
              {tCommon('cancel')}
            </button>
            <button
              type="submit"
              className="button button-success"
              disabled={isApproving || !approvalCountry.trim() || !approvalAddress.trim()}
            >
              {isApproving ? t('approvePanel.approving') : t('approvePanel.approveAndGenerate')}
            </button>
          </div>
        </form>
      </SlidePanel>

      {/* ── Admin: Reject Panel ── */}
      <SlidePanel
        isOpen={rejectionTarget !== null}
        title={t('rejectPanel.title')}
        description={
          rejectionTarget
            ? t('rejectPanel.description', { employeeName: rejectionTarget.employeeName ?? "Employee", country: rejectionTarget.destinationCountry })
            : ""
        }
        onClose={() => setRejectionTarget(null)}
      >
        <form className="slide-panel-form-wrapper" onSubmit={handleReject} noValidate>
          {rejectionError ? (
            <div className="form-error-banner">{rejectionError}</div>
          ) : null}

          <label className="form-field" htmlFor="rejection-reason">
            <span className="form-label">{t('rejectPanel.reasonLabel')}</span>
            <textarea
              id="rejection-reason"
              className="form-input"
              rows={4}
              required
              maxLength={2000}
              placeholder={t('rejectPanel.reasonPlaceholder')}
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.currentTarget.value)}
            />
          </label>

          <div className="slide-panel-actions">
            <button
              type="button"
              className="button button-ghost"
              onClick={() => setRejectionTarget(null)}
            >
              {tCommon('cancel')}
            </button>
            <button
              type="submit"
              className="button button-danger"
              disabled={isRejecting || !rejectionReason.trim()}
            >
              {isRejecting ? t('rejectPanel.rejecting') : t('rejectPanel.rejectRequest')}
            </button>
          </div>
        </form>
      </SlidePanel>

      {/* ── Upload Panel ── */}
      {isPanelOpen ? (
        <DocumentUploadPanel
          isOpen={isPanelOpen}
          onClose={closeUploadPanel}
          onUploaded={handleUploaded}
          currentUserId={currentUserId}
          allowedCategories={
            versionTarget ? [versionTarget.category] : SELF_SERVICE_DOCUMENT_CATEGORIES
          }
          allowPolicyDocuments={false}
          existingDocument={versionTarget}
        />
      ) : null}

      {/* ── Travel Letter Request Panel ── */}
      <SlidePanel
        isOpen={isTravelPanelOpen}
        title={t('requestPanel.title')}
        description={t('requestPanel.description')}
        onClose={closeTravelPanel}
      >
        <form className="slide-panel-form-wrapper" onSubmit={handleTravelSubmit} noValidate>
          {travelFormError ? (
            <div className="form-error-banner">{travelFormError}</div>
          ) : null}

          <label className="form-field" htmlFor="travel-destination">
            <span className="form-label">{t('requestPanel.destinationCountry')}</span>
            <input
              id="travel-destination"
              className="form-input"
              type="text"
              required
              maxLength={200}
              placeholder={t('requestPanel.destinationPlaceholder')}
              value={travelForm.destinationCountry}
              onChange={(e) => handleTravelFormChange("destinationCountry", e.currentTarget.value)}
            />
          </label>

          <label className="form-field" htmlFor="travel-embassy">
            <span className="form-label">{t('requestPanel.embassyName')}</span>
            <input
              id="travel-embassy"
              className="form-input"
              type="text"
              required
              maxLength={500}
              placeholder={t('requestPanel.embassyNamePlaceholder')}
              value={travelForm.embassyName}
              onChange={(e) => handleTravelFormChange("embassyName", e.currentTarget.value)}
            />
          </label>

          <label className="form-field" htmlFor="travel-embassy-address">
            <span className="form-label">
              {t('requestPanel.embassyAddress')}{" "}
              <span className="form-label-optional">{t('requestPanel.embassyAddressOptional')}</span>
            </span>
            <textarea
              id="travel-embassy-address"
              className="form-input"
              rows={2}
              maxLength={1000}
              placeholder={t('requestPanel.embassyAddressPlaceholder')}
              value={travelForm.embassyAddress}
              onChange={(e) => handleTravelFormChange("embassyAddress", e.currentTarget.value)}
            />
          </label>

          <div className="form-field-row">
            <label className="form-field" htmlFor="travel-start-date">
              <span className="form-label">{t('requestPanel.travelStartDate')}</span>
              <input
                id="travel-start-date"
                className="form-input"
                type="date"
                required
                value={travelForm.travelStartDate}
                onChange={(e) => handleTravelFormChange("travelStartDate", e.currentTarget.value)}
              />
            </label>

            <label className="form-field" htmlFor="travel-end-date">
              <span className="form-label">{t('requestPanel.travelEndDate')}</span>
              <input
                id="travel-end-date"
                className="form-input"
                type="date"
                required
                min={travelForm.travelStartDate || undefined}
                value={travelForm.travelEndDate}
                onChange={(e) => handleTravelFormChange("travelEndDate", e.currentTarget.value)}
              />
            </label>
          </div>

          <label className="form-field" htmlFor="travel-purpose">
            <span className="form-label">{t('requestPanel.purposeOfTravel')}</span>
            <textarea
              id="travel-purpose"
              className="form-input"
              rows={3}
              required
              maxLength={2000}
              placeholder={t('requestPanel.purposePlaceholder')}
              value={travelForm.purpose}
              onChange={(e) => handleTravelFormChange("purpose", e.currentTarget.value)}
            />
          </label>

          <label className="form-field" htmlFor="travel-notes">
            <span className="form-label">
              {t('requestPanel.additionalNotes')}{" "}
              <span className="form-label-optional">{t('requestPanel.additionalNotesOptional')}</span>
            </span>
            <textarea
              id="travel-notes"
              className="form-input"
              rows={2}
              maxLength={2000}
              placeholder={t('requestPanel.additionalNotesPlaceholder')}
              value={travelForm.additionalNotes}
              onChange={(e) => handleTravelFormChange("additionalNotes", e.currentTarget.value)}
            />
          </label>

          <div className="slide-panel-actions">
            <button type="button" className="button button-ghost" onClick={closeTravelPanel}>
              {tCommon('cancel')}
            </button>
            <button
              type="submit"
              className="button button-accent"
              disabled={isSubmittingTravel}
            >
              {isSubmittingTravel ? t('requestPanel.submitting') : t('requestPanel.submitRequest')}
            </button>
          </div>
        </form>
      </SlidePanel>

      {/* ── Toasts ── */}
      {toasts.length > 0 ? (
        <div className="toast-region" aria-live="polite" aria-atomic="true">
          {toasts.map((toast) => (
            <div key={toast.id} className={`toast-message toast-message-${toast.variant}`} role="status">
              <span>{toast.message}</span>
              <button
                type="button"
                className="toast-dismiss"
                onClick={() => dismissToast(toast.id)}
                aria-label={t('dismissNotification')}
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
