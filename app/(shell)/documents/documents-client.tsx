"use client";

import { type FormEvent, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { DocumentUploadPanel } from "../../../components/shared/document-upload-panel";
import { EmptyState } from "../../../components/shared/empty-state";
import { PageHeader } from "../../../components/shared/page-header";
import { SlidePanel } from "../../../components/shared/slide-panel";
import { StatusBadge } from "../../../components/shared/status-badge";
import { useDocuments } from "../../../hooks/use-documents";
import { usePeople } from "../../../hooks/use-people";
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
import { FileText } from "lucide-react";
import { humanizeError } from "@/lib/errors";

type AppLocale = "en" | "fr";

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

type PolicyAcknowledgeResponse = {
  data: {
    acknowledged: boolean;
    acknowledgedAt: string | null;
  } | null;
  error?: {
    message?: string;
  } | null;
};

const DOCUMENT_TAB_IDS: DocumentsTab[] = ["all", "policy", "id_document", "tax_form", "expiring_soon"];

const TAB_LABEL_KEYS: Record<DocumentsTab, string> = {
  all: "tabAll",
  policy: "tabPolicies",
  id_document: "tabIdDocuments",
  tax_form: "tabTaxForms",
  expiring_soon: "tabExpiringSoon"
};

function createToastId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getExpiryStatusKey(expiryDate: string | null): { tone: StatusTone; labelKey: string } {
  const remainingDays = daysUntilExpiry(expiryDate);

  if (remainingDays === null) {
    return {
      tone: "draft",
      labelKey: "expiryNoExpiry"
    };
  }

  if (remainingDays < 0) {
    return {
      tone: "error",
      labelKey: "expiryExpired"
    };
  }

  if (remainingDays < 30) {
    return {
      tone: "warning",
      labelKey: "expiryExpiringSoon"
    };
  }

  return {
    tone: "success",
    labelKey: "expiryActive"
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
  const t = useTranslations('documents');
  const tCommon = useTranslations('common');
  const locale = useLocale() as AppLocale;
  const td = t as (key: string, params?: Record<string, unknown>) => string;

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

  // Policy detail panel state
  const [policyDetail, setPolicyDetail] = useState<DocumentRecord | null>(null);
  const [acknowledgingPolicyId, setAcknowledgingPolicyId] = useState<string | null>(null);

  // Signature request panel state
  const [sigReqTarget, setSigReqTarget] = useState<DocumentRecord | null>(null);
  const [sigReqTitle, setSigReqTitle] = useState("");
  const [sigReqMessage, setSigReqMessage] = useState("");
  const [sigReqSignerIds, setSigReqSignerIds] = useState<string[]>([]);
  const [isSubmittingSigReq, setIsSubmittingSigReq] = useState(false);
  const [sigReqError, setSigReqError] = useState<string | null>(null);

  type SignerOption = { id: string; fullName: string; department: string | null; title: string | null };
  const signerPeople = usePeople({
    scope: "all",
    enabled: Boolean(sigReqTarget && canManageDocuments)
  });
  const signerOptions = useMemo(
    () =>
      signerPeople.people
        .filter((person) => person.id !== currentUserId && person.status === "active")
        .sort((leftPerson, rightPerson) => leftPerson.fullName.localeCompare(rightPerson.fullName))
        .map(
          (person): SignerOption => ({
            id: person.id,
            fullName: person.fullName,
            department: person.department,
            title: person.title
          })
        ),
    [currentUserId, signerPeople.people]
  );
  const isSignerOptionsLoading = signerPeople.isLoading;

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

  const showToast = (variant: ToastVariant, rawMessage: string) => {
    const message = variant === "error" ? humanizeError(rawMessage, locale) : rawMessage;
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
      versionTarget ? td('toastVersionUploaded') : td('toastDocumentUploaded')
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
        showToast("error", payload.error?.message ?? td('toastOpenError'));
        return;
      }

      window.open(payload.data.url, "_blank", "noopener,noreferrer");
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : td('toastOpenError'));
    } finally {
      setIsOpeningFileById((currentState) => {
        const nextState = { ...currentState };
        delete nextState[documentId];
        return nextState;
      });
    }
  };

  const handleAcknowledgePolicy = async (document: DocumentRecord) => {
    if (!document.isPolicy || !document.requiresAcknowledgment) {
      return;
    }

    setAcknowledgingPolicyId(document.id);

    try {
      const response = await fetch(
        `/api/v1/compliance/acknowledgments/${document.id}/acknowledge`,
        {
          method: "POST"
        }
      );

      const payload = (await response.json()) as PolicyAcknowledgeResponse;

      if (!response.ok || !payload.data?.acknowledged) {
        showToast("error", payload.error?.message ?? td('toastAckError'));
        return;
      }

      const acknowledgedAt = payload.data.acknowledgedAt ?? new Date().toISOString();

      setDocuments((currentDocuments) =>
        currentDocuments.map((currentDocument) =>
          currentDocument.id === document.id
            ? {
                ...currentDocument,
                acknowledgedAt
              }
            : currentDocument
        )
      );

      setPolicyDetail((currentPolicy) =>
        currentPolicy && currentPolicy.id === document.id
          ? {
              ...currentPolicy,
              acknowledgedAt
            }
          : currentPolicy
      );

      showToast("success", td('toastAcknowledged'));
    } catch (error) {
      showToast(
        "error",
        error instanceof Error ? error.message : td('toastAckError')
      );
    } finally {
      setAcknowledgingPolicyId(null);
    }
  };

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          canManageDocuments ? (
            <button type="button" className="button button-accent" onClick={openCreatePanel}>
              {t('uploadDocument')}
            </button>
          ) : null
        }
      />

      <section className="page-tabs" aria-label={td('filterAriaLabel')}>
        {DOCUMENT_TAB_IDS.map((tab) => (
          <button
            key={tab}
            type="button"
            className={activeTab === tab ? "page-tab page-tab-active" : "page-tab"}
            onClick={() => setActiveTab(tab)}
          >
            {td(TAB_LABEL_KEYS[tab])}
          </button>
        ))}
      </section>

      {isLoading ? <DocumentsTableSkeleton /> : null}

      {!isLoading && errorMessage ? (
        <EmptyState
          title={td('unavailable')}
          description={errorMessage}
          ctaLabel={td('retry')}
          ctaHref="/documents"
        />
      ) : null}

      {!isLoading && !errorMessage && filteredDocuments.length === 0 ? (
        <>
          <EmptyState
            icon={<FileText size={32} />}
            title={td('noDocuments')}
            description={td('noDocumentsDescription')}
            {...(canManageDocuments
              ? { ctaLabel: td('uploadDocument'), onCtaClick: openCreatePanel }
              : {})}
          />
        </>
      ) : null}

      {!isLoading && !errorMessage && filteredDocuments.length > 0 ? (
        <div className="data-table-container">
          <table className="data-table" aria-label={td('tableAriaLabel')}>
            <thead>
              <tr>
                <th>{t('thDocument')}</th>
                <th>{t('thCategory')}</th>
                <th>{t('thOwner')}</th>
                <th>{t('thCountry')}</th>
                <th>
                  <button type="button" className="table-sort-trigger" onClick={toggleSortDirection}>
                    {t('thExpiry')} {expirySortDirection === "asc" ? "\u2191" : "\u2193"}
                  </button>
                </th>
                <th>{t('thStatus')}</th>
                <th>{t('thSize')}</th>
                <th>{t('thUpdated')}</th>
                <th className="table-action-column">{t('thActions')}</th>
              </tr>
            </thead>
            <tbody>
              {filteredDocuments.map((document) => {
                const expiryStatus = getExpiryStatusKey(document.expiryDate);
                const canUploadVersion =
                  canManageDocuments || document.ownerUserId === currentUserId;

                return (
                  <tr key={document.id} className="data-table-row">
                    <td>
                      <div className="documents-cell-copy">
                        <p className="documents-cell-title">{document.title}</p>
                        <p className="documents-cell-description">
                          {document.description || td('noDescription')}
                        </p>
                      </div>
                    </td>
                    <td>{getDocumentCategoryLabel(document.category)}</td>
                    <td>{document.ownerName}</td>
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
                        {document.category === "policy" ? (
                          <button
                            type="button"
                            className="table-row-action"
                            onClick={() => setPolicyDetail(document)}
                          >
                            {t('view')}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="table-row-action"
                          onClick={() => handleOpenFile(document.id)}
                          disabled={Boolean(isOpeningFileById[document.id])}
                        >
                          {isOpeningFileById[document.id] ? t('opening') : t('open')}
                        </button>
                        {canUploadVersion ? (
                          <button
                            type="button"
                            className="table-row-action"
                            onClick={() => openVersionPanel(document)}
                          >
                            {t('newVersion')}
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
                            {t('requestSignature')}
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
          title={td('sigReqTitle')}
          description={td('sigReqDescription')}
          onClose={() => setSigReqTarget(null)}
        >
          <form
            className="slide-panel-form-wrapper"
            onSubmit={async (event: FormEvent<HTMLFormElement>) => {
              event.preventDefault();
              if (!sigReqTarget) return;
              if (!sigReqTitle.trim()) { setSigReqError(td('sigReqErrorTitle')); return; }
              if (sigReqSignerIds.length === 0) { setSigReqError(td('sigReqErrorSigners')); return; }

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
                  setSigReqError(payload.error?.message ?? td('sigReqErrorCreate'));
                  return;
                }

                showToast("success", td('toastSigReqSent'));
                setSigReqTarget(null);
              } catch (error) {
                setSigReqError(error instanceof Error ? error.message : td('sigReqErrorCreate'));
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
              <span className="form-label">{t('sigReqTitleLabel')}</span>
              <input
                id="sig-req-title"
                className="form-input"
                value={sigReqTitle}
                onChange={(e) => setSigReqTitle(e.currentTarget.value)}
                disabled={isSubmittingSigReq}
              />
            </label>

            <label className="form-field" htmlFor="sig-req-message">
              <span className="form-label">{t('sigReqMessageLabel')}</span>
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
              <legend className="form-label">{t('signersLabel')}</legend>
              {isSignerOptionsLoading ? (
                <p className="settings-card-description">{t('loadingSigners')}</p>
              ) : signerOptions.length === 0 ? (
                <p className="settings-card-description">{t('noSigners')}</p>
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
                          {option.title || td('signerTeamMember')}
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
                {tCommon('cancel')}
              </button>
              <button type="submit" className="button button-accent" disabled={isSubmittingSigReq}>
                {isSubmittingSigReq ? t('sending') : t('sendRequest')}
              </button>
            </div>
          </form>
        </SlidePanel>
      ) : null}

      {/* Policy Detail Panel */}
      {policyDetail ? (
        <SlidePanel
          isOpen={Boolean(policyDetail)}
          title={policyDetail.title}
          description={td('policyDetailDescription')}
          onClose={() => setPolicyDetail(null)}
        >
          <div className="slide-panel-form-wrapper">
            <dl className="policy-detail-grid">
              <dt>{t('policyCategory')}</dt>
              <dd>{getDocumentCategoryLabel(policyDetail.category)}</dd>
              {policyDetail.countryCode ? (
                <>
                  <dt>{t('policyCountry')}</dt>
                  <dd>{countryFlagFromCode(policyDetail.countryCode)} {countryNameFromCode(policyDetail.countryCode, locale)}</dd>
                </>
              ) : null}
              <dt>{t('policyUploadedBy')}</dt>
              <dd>{policyDetail.createdByName}</dd>
              <dt>{t('policyLastUpdated')}</dt>
              <dd>{formatRelativeTime(policyDetail.updatedAt, locale)}</dd>
              {policyDetail.expiryDate ? (
                <>
                  <dt>{t('policyExpires')}</dt>
                  <dd>{formatRelativeTime(policyDetail.expiryDate, locale)}</dd>
                </>
              ) : null}
            </dl>
            {policyDetail.description ? (
              <section className="policy-detail-body">
                <h3 className="section-title">{t('policyDescriptionLabel')}</h3>
                <p className="policy-detail-text">{policyDetail.description}</p>
              </section>
            ) : null}
            {policyDetail.isPolicy && policyDetail.requiresAcknowledgment ? (
              <section className="settings-card" aria-label={td('requiresAcknowledgment')}>
                <div className="documents-row-actions" style={{ justifyContent: "space-between" }}>
                  <StatusBadge tone={policyDetail.acknowledgedAt ? "success" : "pending"}>
                    {policyDetail.acknowledgedAt
                      ? t('acknowledged')
                      : t('acknowledgmentRequired')}
                  </StatusBadge>
                  {!policyDetail.acknowledgedAt ? (
                    <button
                      type="button"
                      className="button button-accent"
                      onClick={() => {
                        void handleAcknowledgePolicy(policyDetail);
                      }}
                      disabled={acknowledgingPolicyId === policyDetail.id}
                    >
                      {acknowledgingPolicyId === policyDetail.id
                        ? t('acknowledging')
                        : t('acknowledgeButton')}
                    </button>
                  ) : null}
                </div>
                <p className="settings-card-description">
                  {policyDetail.acknowledgedAt ? (
                    <>
                      {td('acknowledgedOn', { date: formatRelativeTime(policyDetail.acknowledgedAt, locale) })}{" "}
                      <time
                        dateTime={policyDetail.acknowledgedAt}
                        title={formatDateTimeTooltip(policyDetail.acknowledgedAt, locale)}
                      >
                      </time>
                    </>
                  ) : (
                    t('requiresAcknowledgment')
                  )}
                </p>
              </section>
            ) : null}
            <div className="slide-panel-actions">
              <button
                type="button"
                className="button"
                onClick={() => setPolicyDetail(null)}
              >
                {tCommon('close')}
              </button>
              <button
                type="button"
                className="button button-accent"
                onClick={() => handleOpenFile(policyDetail.id)}
                disabled={Boolean(isOpeningFileById[policyDetail.id])}
              >
                {isOpeningFileById[policyDetail.id] ? t('opening') : t('openFile')}
              </button>
            </div>
          </div>
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
                aria-label={td('dismissAriaLabel')}
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
