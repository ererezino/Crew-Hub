"use client";

import { type FormEvent, useMemo, useState, useEffect } from "react";

import { DocumentUploadPanel } from "../../../components/shared/document-upload-panel";
import { EmptyState } from "../../../components/shared/empty-state";
import { PageHeader } from "../../../components/shared/page-header";
import { SlidePanel } from "../../../components/shared/slide-panel";
import { StatusBadge } from "../../../components/shared/status-badge";
import { useDocuments } from "../../../hooks/use-documents";
import { countryFlagFromCode, countryNameFromCode } from "../../../lib/countries";
import { formatDateTimeTooltip, formatRelativeTime } from "../../../lib/datetime";
import {
  daysUntilExpiry,
  formatFileSize,
  getDocumentCategoryLabel
} from "../../../lib/documents";
import {
  DOCUMENT_CATEGORIES,
  SELF_SERVICE_DOCUMENT_CATEGORIES,
  type DocumentRecord,
  type DocumentSignedUrlResponse
} from "../../../types/documents";
import type { CreateSignatureRequestResponse } from "../../../types/esignatures";
import type { PeopleListResponse } from "../../../types/people";

type DocumentsClientProps = {
  currentUserId: string;
  canManageDocuments: boolean;
};

type DocumentsTab =
  | "all"
  | "policy"
  | "id_document"
  | "tax_form"
  | "expiring_soon";

type SortDirection = "asc" | "desc";
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

const tabs: Array<{ id: DocumentsTab; label: string }> = [
  { id: "all", label: "All Documents" },
  { id: "policy", label: "Policies" },
  { id: "id_document", label: "ID Documents" },
  { id: "tax_form", label: "Tax Forms" },
  { id: "expiring_soon", label: "Expiring Soon" }
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

function sortByExpiry(
  documents: readonly DocumentRecord[],
  direction: SortDirection
): DocumentRecord[] {
  return [...documents].sort((leftDocument, rightDocument) => {
    const leftDate = leftDocument.expiryDate
      ? Date.parse(`${leftDocument.expiryDate}T00:00:00.000Z`)
      : null;
    const rightDate = rightDocument.expiryDate
      ? Date.parse(`${rightDocument.expiryDate}T00:00:00.000Z`)
      : null;

    if (leftDate === null && rightDate === null) {
      return 0;
    }

    if (leftDate === null) {
      return 1;
    }

    if (rightDate === null) {
      return -1;
    }

    return direction === "asc" ? leftDate - rightDate : rightDate - leftDate;
  });
}

function DocumentsTableSkeleton() {
  return (
    <div className="table-skeleton" aria-hidden="true">
      <div className="table-skeleton-header" />
      {Array.from({ length: 7 }, (_, index) => (
        <div key={`documents-row-skeleton-${index}`} className="table-skeleton-row" />
      ))}
    </div>
  );
}

export function DocumentsClient({ currentUserId, canManageDocuments }: DocumentsClientProps) {
  const {
    documents,
    isLoading,
    errorMessage,
    refresh,
    setDocuments
  } = useDocuments({
    scope: "all"
  });

  const [activeTab, setActiveTab] = useState<DocumentsTab>("all");
  const [expirySortDirection, setExpirySortDirection] = useState<SortDirection>("asc");
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [versionTarget, setVersionTarget] = useState<DocumentRecord | null>(null);
  const [isOpeningFileById, setIsOpeningFileById] = useState<Record<string, boolean>>({});
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  // Signature request panel state
  const [sigReqTarget, setSigReqTarget] = useState<DocumentRecord | null>(null);
  const [sigReqTitle, setSigReqTitle] = useState("");
  const [sigReqMessage, setSigReqMessage] = useState("");
  const [sigReqSignerIds, setSigReqSignerIds] = useState<string[]>([]);
  const [isSubmittingSigReq, setIsSubmittingSigReq] = useState(false);
  const [sigReqError, setSigReqError] = useState<string | null>(null);

  type SignerOption = { id: string; fullName: string; department: string | null; title: string | null };
  const [signerOptions, setSignerOptions] = useState<SignerOption[]>([]);
  const [isSignerOptionsLoading, setIsSignerOptionsLoading] = useState(false);

  // Load signer options when request panel opens
  useEffect(() => {
    if (!sigReqTarget || !canManageDocuments) return;
    const ac = new AbortController();
    setIsSignerOptionsLoading(true);

    void (async () => {
      try {
        const res = await fetch("/api/v1/people?scope=all&limit=250", { signal: ac.signal });
        const payload = (await res.json()) as PeopleListResponse;
        if (res.ok && payload.data) {
          setSignerOptions(
            payload.data.people
              .filter((p) => p.id !== currentUserId && p.status === "active")
              .sort((a, b) => a.fullName.localeCompare(b.fullName))
              .map((p) => ({ id: p.id, fullName: p.fullName, department: p.department, title: p.title }))
          );
        }
      } catch { /* ignore abort */ }
      finally { if (!ac.signal.aborted) setIsSignerOptionsLoading(false); }
    })();

    return () => { ac.abort(); };
  }, [sigReqTarget, canManageDocuments, currentUserId]);

  const filteredDocuments = useMemo(() => {
    const nextDocuments = documents.filter((document) => {
      if (activeTab === "all") {
        return true;
      }

      if (activeTab === "expiring_soon") {
        const remainingDays = daysUntilExpiry(document.expiryDate);
        return remainingDays !== null && remainingDays >= 0 && remainingDays < 30;
      }

      return document.category === activeTab;
    });

    return sortByExpiry(nextDocuments, expirySortDirection);
  }, [activeTab, documents, expirySortDirection]);

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

  const openCreatePanel = () => {
    setVersionTarget(null);
    setIsPanelOpen(true);
  };

  const openVersionPanel = (document: DocumentRecord) => {
    setVersionTarget(document);
    setIsPanelOpen(true);
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

  const toggleSortDirection = () => {
    setExpirySortDirection((currentDirection) =>
      currentDirection === "asc" ? "desc" : "asc"
    );
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

  return (
    <>
      <PageHeader
        title="Documents"
        description="Org-wide document repository with category filters, expiry alerts, and version tracking."
        actions={
          canManageDocuments ? (
            <button type="button" className="button button-accent" onClick={openCreatePanel}>
              Upload document
            </button>
          ) : null
        }
      />

      <section className="page-tabs" aria-label="Document filters">
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

      {isLoading ? <DocumentsTableSkeleton /> : null}

      {!isLoading && errorMessage ? (
        <EmptyState
          title="Documents are unavailable"
          description={errorMessage}
          ctaLabel="Retry"
          ctaHref="/documents"
        />
      ) : null}

      {!isLoading && !errorMessage && filteredDocuments.length === 0 ? (
        <section className="error-state">
          <EmptyState
            title="No documents match this filter"
            description="Upload a document or select a different tab to view more records."
            ctaLabel={canManageDocuments ? "Upload document" : "Go to dashboard"}
            {...(canManageDocuments
              ? { onCtaClick: openCreatePanel }
              : { ctaHref: "/dashboard" })}
          />
        </section>
      ) : null}

      {!isLoading && !errorMessage && filteredDocuments.length > 0 ? (
        <div className="data-table-container">
          <table className="data-table" aria-label="Documents table">
            <thead>
              <tr>
                <th>Document</th>
                <th>Category</th>
                <th>Owner</th>
                <th>Country</th>
                <th>
                  <button type="button" className="table-sort-trigger" onClick={toggleSortDirection}>
                    Expiry {expirySortDirection === "asc" ? "↑" : "↓"}
                  </button>
                </th>
                <th>Status</th>
                <th>Size</th>
                <th>Updated</th>
                <th className="table-action-column">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredDocuments.map((document) => {
                const expiryStatus = getExpiryStatus(document.expiryDate);
                const canUploadVersion =
                  canManageDocuments || document.ownerUserId === currentUserId;

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
                    <td>{document.ownerName}</td>
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
                        {canUploadVersion ? (
                          <button
                            type="button"
                            className="table-row-action"
                            onClick={() => openVersionPanel(document)}
                          >
                            New version
                          </button>
                        ) : null}
                        {canManageDocuments ? (
                          <button
                            type="button"
                            className="table-row-action"
                            onClick={() => {
                              setSigReqTarget(document);
                              setSigReqTitle(document.title);
                              setSigReqMessage("");
                              setSigReqSignerIds([]);
                              setSigReqError(null);
                            }}
                          >
                            Request signature
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {isPanelOpen ? (
        <DocumentUploadPanel
          isOpen={isPanelOpen}
          onClose={closeUploadPanel}
          onUploaded={handleUploaded}
          currentUserId={currentUserId}
          allowedCategories={
            versionTarget
              ? [versionTarget.category]
              : canManageDocuments
                ? DOCUMENT_CATEGORIES
                : SELF_SERVICE_DOCUMENT_CATEGORIES
          }
          allowPolicyDocuments={canManageDocuments}
          existingDocument={versionTarget}
        />
      ) : null}

      {/* Request Signature Panel */}
      {sigReqTarget && canManageDocuments ? (
        <SlidePanel
          isOpen={Boolean(sigReqTarget)}
          title="Request Signature"
          description="Choose signers for this document. They will receive in-app and email notifications."
          onClose={() => setSigReqTarget(null)}
        >
          <form
            className="slide-panel-form-wrapper"
            onSubmit={async (event: FormEvent<HTMLFormElement>) => {
              event.preventDefault();
              if (!sigReqTarget) return;
              if (!sigReqTitle.trim()) { setSigReqError("Title is required."); return; }
              if (sigReqSignerIds.length === 0) { setSigReqError("Select at least one signer."); return; }

              setIsSubmittingSigReq(true);
              setSigReqError(null);

              try {
                const res = await fetch("/api/v1/signatures", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    documentId: sigReqTarget.id,
                    title: sigReqTitle.trim(),
                    message: sigReqMessage.trim(),
                    signerUserIds: sigReqSignerIds
                  })
                });

                const payload = (await res.json()) as CreateSignatureRequestResponse;

                if (!res.ok || !payload.data) {
                  setSigReqError(payload.error?.message ?? "Unable to create signature request.");
                  return;
                }

                showToast("success", "Signature request sent.");
                setSigReqTarget(null);
              } catch (error) {
                setSigReqError(error instanceof Error ? error.message : "Unable to create signature request.");
              } finally {
                setIsSubmittingSigReq(false);
              }
            }}
            noValidate
          >
            {sigReqError ? (
              <div className="form-error-banner">{sigReqError}</div>
            ) : null}

            <label className="form-field" htmlFor="sig-req-title">
              <span className="form-label">Request title</span>
              <input
                id="sig-req-title"
                className="form-input"
                value={sigReqTitle}
                onChange={(e) => setSigReqTitle(e.currentTarget.value)}
                disabled={isSubmittingSigReq}
              />
            </label>

            <label className="form-field" htmlFor="sig-req-message">
              <span className="form-label">Message (optional)</span>
              <textarea
                id="sig-req-message"
                className="form-input"
                rows={3}
                value={sigReqMessage}
                onChange={(e) => setSigReqMessage(e.currentTarget.value)}
                disabled={isSubmittingSigReq}
              />
            </label>

            <fieldset className="signature-signer-picker">
              <legend className="form-label">Signers</legend>
              {isSignerOptionsLoading ? (
                <p className="settings-card-description">Loading signer options...</p>
              ) : signerOptions.length === 0 ? (
                <p className="settings-card-description">No active signers available.</p>
              ) : (
                <div className="signature-signer-options">
                  {signerOptions.map((option) => (
                    <label key={option.id} className="settings-checkbox">
                      <input
                        type="checkbox"
                        checked={sigReqSignerIds.includes(option.id)}
                        onChange={() => {
                          setSigReqSignerIds((prev) =>
                            prev.includes(option.id)
                              ? prev.filter((id) => id !== option.id)
                              : [...prev, option.id]
                          );
                        }}
                        disabled={isSubmittingSigReq}
                      />
                      <span>
                        {option.fullName}
                        <span className="signature-signer-option-meta">
                          {option.title || "Team member"}
                          {option.department ? ` - ${option.department}` : ""}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </fieldset>

            <div className="slide-panel-actions">
              <button
                type="button"
                className="button button-ghost"
                onClick={() => setSigReqTarget(null)}
                disabled={isSubmittingSigReq}
              >
                Cancel
              </button>
              <button type="submit" className="button button-accent" disabled={isSubmittingSigReq}>
                {isSubmittingSigReq ? "Sending..." : "Send request"}
              </button>
            </div>
          </form>
        </SlidePanel>
      ) : null}

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
