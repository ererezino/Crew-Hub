"use client";

import { useCallback, useMemo, useState } from "react";

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

const tabs: Array<{ id: MyDocumentsTab; label: string }> = [
  { id: "all", label: "All" },
  { id: "id_document", label: "ID Documents" },
  { id: "tax_form", label: "Tax Forms" },
  { id: "travel_letters", label: "Travel Letters" }
];

function createToastId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getExpiryStatus(expiryDate: string | null): { tone: StatusTone; label: string } {
  const remainingDays = daysUntilExpiry(expiryDate);

  if (remainingDays === null) {
    return {
      tone: "draft",
      label: "No expiry"
    };
  }

  if (remainingDays < 0) {
    return {
      tone: "error",
      label: "Expired"
    };
  }

  if (remainingDays < 30) {
    return {
      tone: "warning",
      label: "Expiring < 30d"
    };
  }

  return {
    tone: "success",
    label: "Active"
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

function formatTravelDate(dateString: string): string {
  return formatDateShort(dateString);
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

  const dismissToast = (toastId: string) => {
    setToasts((currentToasts) => currentToasts.filter((toast) => toast.id !== toastId));
  };

  const showToast = (variant: ToastVariant, message: string) => {
    const toastId = createToastId();

    setToasts((currentToasts) => [...currentToasts, { id: toastId, variant, message }]);

    window.setTimeout(() => {
      dismissToast(toastId);
    }, 4000);
  };

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
      versionTarget ? "Document version uploaded." : "Document uploaded."
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
        showToast("error", payload.error?.message ?? "Unable to open document.");
        return;
      }

      window.open(payload.data.url, "_blank", "noopener,noreferrer");
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : "Unable to open document.");
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
          setTravelFormError(result.error?.message ?? "Unable to submit travel letter request.");
          return;
        }

        setIsTravelPanelOpen(false);
        showToast("success", "Travel support letter request submitted.");
        refreshTravel();
      } catch (error) {
        setTravelFormError(
          error instanceof Error ? error.message : "Unable to submit travel letter request."
        );
      } finally {
        setIsSubmittingTravel(false);
      }
    },
    [travelForm, refreshTravel]
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
          showToast("error", payload.error?.message ?? "Unable to download travel letter.");
          return;
        }

        window.open(payload.data.url, "_blank", "noopener,noreferrer");
      } catch (error) {
        showToast(
          "error",
          error instanceof Error ? error.message : "Unable to download travel letter."
        );
      } finally {
        setIsDownloadingById((prev) => {
          const next = { ...prev };
          delete next[requestId];
          return next;
        });
      }
    },
    []
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
          setApprovalError(result.error?.message ?? "Unable to approve request.");
          return;
        }

        setApprovalTarget(null);
        showToast("success", "Travel support letter approved and generated.");
        refreshPending();
        refreshTravel();
        refreshEntities();
      } catch (error) {
        setApprovalError(
          error instanceof Error ? error.message : "Unable to approve request."
        );
      } finally {
        setIsApproving(false);
      }
    },
    [approvalTarget, approvalCountry, approvalAddress, refreshPending, refreshTravel, refreshEntities]
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

      const confirmed = window.confirm(
        `Reject travel support request for ${rejectionTarget.employeeName ?? "this employee"}?`
      );

      if (!confirmed) {
        return;
      }

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
          setRejectionError(result.error?.message ?? "Unable to reject request.");
          return;
        }

        setRejectionTarget(null);
        showToast("info", "Travel support request rejected.");
        refreshPending();
        refreshTravel();
      } catch (error) {
        setRejectionError(
          error instanceof Error ? error.message : "Unable to reject request."
        );
      } finally {
        setIsRejecting(false);
      }
    },
    [rejectionTarget, rejectionReason, refreshPending, refreshTravel]
  );

  // Known entity countries for the select dropdown
  const ENTITY_COUNTRIES = ["USA", "Nigeria", "Canada", "Ghana", "South Africa"];
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
        title="My Documents"
        description="Access your personal documents, upload required records, and track expiry reminders."
        actions={
          <>
            {showTravelView ? (
              <button
                type="button"
                className="button button-accent"
                onClick={openTravelPanel}
              >
                Request Travel Letter
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="button"
                  onClick={openTravelPanel}
                >
                  Request Travel Letter
                </button>
                <button
                  type="button"
                  className="button button-accent"
                  onClick={() => setIsPanelOpen(true)}
                >
                  Upload document
                </button>
              </>
            )}
          </>
        }
      />

      <section className="page-tabs" aria-label="My document filters">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={activeTab === tab.id ? "page-tab page-tab-active" : "page-tab"}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </section>

      {/* ── Documents View ── */}
      {showDocumentsView ? (
        <>
          {isLoading ? <MyDocumentsSkeleton /> : null}

          {!isLoading && errorMessage ? (
            <ErrorState
              title="My documents are unavailable"
              message={errorMessage}
              onRetry={refresh}
            />
          ) : null}

          {!isLoading && !errorMessage && visibleDocuments.length === 0 ? (
            <EmptyState
              icon={<FileText size={32} />}
              title="No documents here"
              description="Try another filter or upload a document to populate this list."
              ctaLabel="Go to dashboard"
              ctaHref="/dashboard"
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
                        <StatusBadge tone={expiryStatus.tone}>{expiryStatus.label}</StatusBadge>
                      </header>
                      <p className="settings-card-description">
                        {getDocumentCategoryLabel(document.category)}
                      </p>
                      <p className="settings-card-description">
                        {countryFlagFromCode(document.countryCode)} {countryNameFromCode(document.countryCode)}
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
                          {isOpeningFileById[document.id] ? "Opening..." : "Open"}
                        </button>
                        <button
                          type="button"
                          className="table-row-action"
                          onClick={() => {
                            setVersionTarget(document);
                            setIsPanelOpen(true);
                          }}
                        >
                          New version
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>

              <div className="data-table-container my-documents-desktop-table">
                <table className="data-table" aria-label="My documents table">
                  <thead>
                    <tr>
                      <th>Document</th>
                      <th>Category</th>
                      <th>Country</th>
                      <th>Expiry</th>
                      <th>Status</th>
                      <th>Size</th>
                      <th>Updated</th>
                      <th className="table-action-column">Actions</th>
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
                                {document.description || "No description"}
                              </p>
                            </div>
                          </td>
                          <td>{getDocumentCategoryLabel(document.category)}</td>
                          <td>
                            <span className="country-chip">
                              <span>{countryFlagFromCode(document.countryCode)}</span>
                              <span>{countryNameFromCode(document.countryCode)}</span>
                            </span>
                          </td>
                          <td>
                            {document.expiryDate ? (
                              <time
                                dateTime={document.expiryDate}
                                title={formatDateTimeTooltip(document.expiryDate)}
                              >
                                {formatRelativeTime(document.expiryDate)}
                              </time>
                            ) : (
                              "--"
                            )}
                          </td>
                          <td>
                            <StatusBadge tone={expiryStatus.tone}>{expiryStatus.label}</StatusBadge>
                          </td>
                          <td className="numeric">{formatFileSize(document.sizeBytes)}</td>
                          <td>
                            <time
                              dateTime={document.updatedAt}
                              title={formatDateTimeTooltip(document.updatedAt)}
                            >
                              {formatRelativeTime(document.updatedAt)}
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
                                {isOpeningFileById[document.id] ? "Opening..." : "Open"}
                              </button>
                              <button
                                type="button"
                                className="table-row-action"
                                onClick={() => {
                                  setVersionTarget(document);
                                  setIsPanelOpen(true);
                                }}
                              >
                                New version
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
              title="Travel letters unavailable"
              message={travelError}
              onRetry={refreshTravel}
            />
          ) : null}

          {!isTravelLoading && !travelError && travelRequests.length === 0 ? (
            <EmptyState
              title="No travel letter requests"
              description="Request a travel support letter for your next trip. Letters are signed by a co-founder."
              ctaLabel="Go to dashboard"
              ctaHref="/dashboard"
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
                        {req.status.charAt(0).toUpperCase() + req.status.slice(1)}
                      </StatusBadge>
                    </div>
                    <p className="travel-letter-card-subtitle">
                      {req.embassyName}
                    </p>
                  </header>

                  <div className="travel-letter-card-details">
                    <div className="travel-letter-card-detail">
                      <span className="travel-letter-detail-label">Travel dates</span>
                      <span>
                        {formatTravelDate(req.travelStartDate)} &ndash;{" "}
                        {formatTravelDate(req.travelEndDate)}
                      </span>
                    </div>
                    <div className="travel-letter-card-detail">
                      <span className="travel-letter-detail-label">Purpose</span>
                      <span>{req.purpose}</span>
                    </div>
                    <div className="travel-letter-card-detail">
                      <span className="travel-letter-detail-label">Requested</span>
                      <span>{formatTravelDate(req.createdAt.split("T")[0] ?? req.createdAt)}</span>
                    </div>
                    {req.approverName ? (
                      <div className="travel-letter-card-detail">
                        <span className="travel-letter-detail-label">
                          {req.status === "approved" ? "Approved by" : "Reviewed by"}
                        </span>
                        <span>{req.approverName}</span>
                      </div>
                    ) : null}
                    {req.status === "rejected" && req.rejectionReason ? (
                      <div className="travel-letter-card-detail travel-letter-rejection">
                        <span className="travel-letter-detail-label">Reason</span>
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
                        {isDownloadingById[req.id] ? "Downloading..." : "Download Letter"}
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
        <section className="admin-approvals-section" aria-label="Pending approvals">
          <h2 className="admin-approvals-heading">Pending Approvals</h2>
          <p className="admin-approvals-description">
            Travel support requests awaiting your review.
          </p>
          <div className="travel-letter-list">
            {pendingRequests.map((req) => (
              <article key={`pending-${req.id}`} className="travel-letter-card travel-letter-card-pending">
                <header className="travel-letter-card-header">
                  <div className="travel-letter-card-title-row">
                    <h3 className="travel-letter-card-title">
                      {req.employeeName ?? "Employee"} &rarr; {req.destinationCountry}
                    </h3>
                    <StatusBadge tone="pending">Pending</StatusBadge>
                  </div>
                  <p className="travel-letter-card-subtitle">{req.embassyName}</p>
                </header>

                <div className="travel-letter-card-details">
                  <div className="travel-letter-card-detail">
                    <span className="travel-letter-detail-label">Travel dates</span>
                    <span>
                      {formatTravelDate(req.travelStartDate)} &ndash;{" "}
                      {formatTravelDate(req.travelEndDate)}
                    </span>
                  </div>
                  <div className="travel-letter-card-detail">
                    <span className="travel-letter-detail-label">Purpose</span>
                    <span>{req.purpose}</span>
                  </div>
                  <div className="travel-letter-card-detail">
                    <span className="travel-letter-detail-label">Requested</span>
                    <span>
                      {formatTravelDate(req.createdAt.split("T")[0] ?? req.createdAt)}
                    </span>
                  </div>
                </div>

                <div className="travel-letter-card-actions">
                  <button
                    type="button"
                    className="button button-success-outline"
                    onClick={() => openApprovePanel(req)}
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    className="button button-danger-outline"
                    onClick={() => openRejectPanel(req)}
                  >
                    Reject
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
        title="Approve Travel Letter"
        description={
          approvalTarget
            ? `Approve ${approvalTarget.employeeName ?? "this employee"}'s travel letter for ${approvalTarget.destinationCountry}. Select the issuing entity.`
            : ""
        }
        onClose={() => setApprovalTarget(null)}
      >
        <form className="slide-panel-form-wrapper" onSubmit={handleApprove} noValidate>
          {approvalError ? (
            <div className="form-error-banner">{approvalError}</div>
          ) : null}

          <label className="form-field" htmlFor="entity-country">
            <span className="form-label">Issuing Entity Country</span>
            <select
              id="entity-country"
              className="form-input"
              required
              value={approvalCountry}
              onChange={(e) => handleCountryChange(e.currentTarget.value)}
            >
              <option value="">Select a country...</option>
              {countryOptions.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </label>

          <label className="form-field" htmlFor="entity-address">
            <span className="form-label">Entity Address</span>
            <textarea
              id="entity-address"
              className="form-input"
              rows={3}
              required
              maxLength={1000}
              placeholder="Full address for the letterhead"
              value={approvalAddress}
              onChange={(e) => setApprovalAddress(e.currentTarget.value)}
            />
            <span className="form-hint">
              This address will appear on the letterhead and be saved for future use.
            </span>
          </label>

          <div className="slide-panel-actions">
            <button
              type="button"
              className="button button-ghost"
              onClick={() => setApprovalTarget(null)}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="button button-success"
              disabled={isApproving || !approvalCountry.trim() || !approvalAddress.trim()}
            >
              {isApproving ? "Approving..." : "Approve & Generate PDF"}
            </button>
          </div>
        </form>
      </SlidePanel>

      {/* ── Admin: Reject Panel ── */}
      <SlidePanel
        isOpen={rejectionTarget !== null}
        title="Reject Travel Letter"
        description={
          rejectionTarget
            ? `Reject ${rejectionTarget.employeeName ?? "this employee"}'s travel letter request for ${rejectionTarget.destinationCountry}.`
            : ""
        }
        onClose={() => setRejectionTarget(null)}
      >
        <form className="slide-panel-form-wrapper" onSubmit={handleReject} noValidate>
          {rejectionError ? (
            <div className="form-error-banner">{rejectionError}</div>
          ) : null}

          <label className="form-field" htmlFor="rejection-reason">
            <span className="form-label">Reason for Rejection</span>
            <textarea
              id="rejection-reason"
              className="form-input"
              rows={4}
              required
              maxLength={2000}
              placeholder="Explain why the request is being rejected"
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
              Cancel
            </button>
            <button
              type="submit"
              className="button button-danger"
              disabled={isRejecting || !rejectionReason.trim()}
            >
              {isRejecting ? "Rejecting..." : "Reject Request"}
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
        title="Request Travel Support Letter"
        description="Submit a request for a travel support letter. A co-founder will review and sign it."
        onClose={closeTravelPanel}
      >
        <form className="slide-panel-form-wrapper" onSubmit={handleTravelSubmit} noValidate>
          {travelFormError ? (
            <div className="form-error-banner">{travelFormError}</div>
          ) : null}

          <label className="form-field" htmlFor="travel-destination">
            <span className="form-label">Destination Country</span>
            <input
              id="travel-destination"
              className="form-input"
              type="text"
              required
              maxLength={200}
              placeholder="e.g. United Kingdom"
              value={travelForm.destinationCountry}
              onChange={(e) => handleTravelFormChange("destinationCountry", e.currentTarget.value)}
            />
          </label>

          <label className="form-field" htmlFor="travel-embassy">
            <span className="form-label">Embassy / Organization Name</span>
            <input
              id="travel-embassy"
              className="form-input"
              type="text"
              required
              maxLength={500}
              placeholder="e.g. British High Commission, Abuja"
              value={travelForm.embassyName}
              onChange={(e) => handleTravelFormChange("embassyName", e.currentTarget.value)}
            />
          </label>

          <label className="form-field" htmlFor="travel-embassy-address">
            <span className="form-label">
              Embassy / Organization Address{" "}
              <span className="form-label-optional">(optional)</span>
            </span>
            <textarea
              id="travel-embassy-address"
              className="form-input"
              rows={2}
              maxLength={1000}
              placeholder="Full address of the embassy or organization"
              value={travelForm.embassyAddress}
              onChange={(e) => handleTravelFormChange("embassyAddress", e.currentTarget.value)}
            />
          </label>

          <div className="form-field-row">
            <label className="form-field" htmlFor="travel-start-date">
              <span className="form-label">Travel Start Date</span>
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
              <span className="form-label">Travel End Date</span>
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
            <span className="form-label">Purpose of Travel</span>
            <textarea
              id="travel-purpose"
              className="form-input"
              rows={3}
              required
              maxLength={2000}
              placeholder="Describe the purpose of your trip"
              value={travelForm.purpose}
              onChange={(e) => handleTravelFormChange("purpose", e.currentTarget.value)}
            />
          </label>

          <label className="form-field" htmlFor="travel-notes">
            <span className="form-label">
              Additional Notes{" "}
              <span className="form-label-optional">(optional)</span>
            </span>
            <textarea
              id="travel-notes"
              className="form-input"
              rows={2}
              maxLength={2000}
              placeholder="Any extra information to include"
              value={travelForm.additionalNotes}
              onChange={(e) => handleTravelFormChange("additionalNotes", e.currentTarget.value)}
            />
          </label>

          <div className="slide-panel-actions">
            <button type="button" className="button button-ghost" onClick={closeTravelPanel}>
              Cancel
            </button>
            <button
              type="submit"
              className="button button-accent"
              disabled={isSubmittingTravel}
            >
              {isSubmittingTravel ? "Submitting..." : "Submit Request"}
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
