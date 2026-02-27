"use client";

import { useMemo, useState } from "react";

import { DocumentUploadPanel } from "../../../components/shared/document-upload-panel";
import { EmptyState } from "../../../components/shared/empty-state";
import { PageHeader } from "../../../components/shared/page-header";
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
    <div className="documents-table-skeleton" aria-hidden="true">
      <div className="documents-table-skeleton-header" />
      {Array.from({ length: 7 }, (_, index) => (
        <div key={`documents-row-skeleton-${index}`} className="documents-table-skeleton-row" />
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

      <section className="documents-tabs" aria-label="Document filters">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={activeTab === tab.id ? "documents-tab documents-tab-active" : "documents-tab"}
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
        <section className="documents-empty-state">
          <EmptyState
            title="No documents match this filter"
            description="Upload a document or select a different tab to view more records."
            ctaLabel="Go to dashboard"
            ctaHref="/dashboard"
          />
          {canManageDocuments ? (
            <button type="button" className="button button-accent" onClick={openCreatePanel}>
              Upload document
            </button>
          ) : null}
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
