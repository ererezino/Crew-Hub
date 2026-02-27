"use client";

import { useMemo, useState } from "react";

import { DocumentUploadPanel } from "../../../../components/shared/document-upload-panel";
import { EmptyState } from "../../../../components/shared/empty-state";
import { PageHeader } from "../../../../components/shared/page-header";
import { StatusBadge } from "../../../../components/shared/status-badge";
import { useDocuments } from "../../../../hooks/use-documents";
import { countryFlagFromCode, countryNameFromCode } from "../../../../lib/countries";
import { formatDateTimeTooltip, formatRelativeTime } from "../../../../lib/datetime";
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

type MyDocumentsClientProps = {
  currentUserId: string;
};

type MyDocumentsTab = "all" | "id_document" | "tax_form";
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

const tabs: Array<{ id: MyDocumentsTab; label: string }> = [
  { id: "all", label: "All" },
  { id: "id_document", label: "ID Documents" },
  { id: "tax_form", label: "Tax Forms" }
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

function MyDocumentsSkeleton() {
  return (
    <div className="documents-table-skeleton" aria-hidden="true">
      <div className="documents-table-skeleton-header" />
      {Array.from({ length: 5 }, (_, index) => (
        <div key={`my-documents-skeleton-${index}`} className="documents-table-skeleton-row" />
      ))}
    </div>
  );
}

export function MyDocumentsClient({ currentUserId }: MyDocumentsClientProps) {
  const {
    documents,
    isLoading,
    errorMessage,
    refresh,
    setDocuments
  } = useDocuments({
    scope: "mine"
  });

  const [activeTab, setActiveTab] = useState<MyDocumentsTab>("all");
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [versionTarget, setVersionTarget] = useState<DocumentRecord | null>(null);
  const [isOpeningFileById, setIsOpeningFileById] = useState<Record<string, boolean>>({});
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const visibleDocuments = useMemo(() => {
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

  return (
    <>
      <PageHeader
        title="My Documents"
        description="Upload and manage your own ID documents and tax forms in Crew Hub."
        actions={
          <button type="button" className="button button-accent" onClick={() => setIsPanelOpen(true)}>
            Upload document
          </button>
        }
      />

      <section className="documents-tabs" aria-label="My document filters">
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

      {isLoading ? <MyDocumentsSkeleton /> : null}

      {!isLoading && errorMessage ? (
        <EmptyState
          title="My documents are unavailable"
          description={errorMessage}
          ctaLabel="Retry"
          ctaHref="/me/documents"
        />
      ) : null}

      {!isLoading && !errorMessage && visibleDocuments.length === 0 ? (
        <section className="documents-empty-state">
          <EmptyState
            title="No personal documents yet"
            description="Upload your first ID document or tax form to start tracking updates."
            ctaLabel="Go to dashboard"
            ctaHref="/dashboard"
          />
          <button type="button" className="button button-accent" onClick={() => setIsPanelOpen(true)}>
            Upload document
          </button>
        </section>
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
