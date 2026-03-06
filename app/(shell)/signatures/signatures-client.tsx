"use client";

import {
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
  type TouchEvent as ReactTouchEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";

import { EmptyState } from "../../../components/shared/empty-state";
import { PageHeader } from "../../../components/shared/page-header";
import { SlidePanel } from "../../../components/shared/slide-panel";
import { StatusBadge } from "../../../components/shared/status-badge";
import { useDocuments } from "../../../hooks/use-documents";
import { useSignatures } from "../../../hooks/use-signatures";
import { formatDateTimeTooltip, formatRelativeTime } from "../../../lib/datetime";
import { toSentenceCase } from "../../../lib/format-labels";
import type {
  CreateSignatureRequestResponse,
  SignSignatureResponse,
  SignatureRequestRecord
} from "../../../types/esignatures";
import type { DocumentSignedUrlResponse } from "../../../types/documents";
import type { PeopleListResponse } from "../../../types/people";
import { PenSquare } from "lucide-react";
import { humanizeError } from "@/lib/errors";

type SignaturesClientProps = {
  currentUserId: string;
  canManageSignatures: boolean;
};

type SignatureTab = "pending_action" | "sent_by_me" | "completed";
type SortDirection = "asc" | "desc";
type ToastVariant = "success" | "error" | "info";

type SignerOption = {
  id: string;
  fullName: string;
  department: string | null;
  title: string | null;
};

type CreateFormValues = {
  documentId: string;
  title: string;
  message: string;
  signerUserIds: string[];
};

type CreateFormErrors = {
  documentId?: string;
  title?: string;
  signerUserIds?: string;
};

type ToastMessage = {
  id: string;
  variant: ToastVariant;
  message: string;
};

const tabs: Array<{ id: SignatureTab; label: string }> = [
  { id: "pending_action", label: "Needs my signature" },
  { id: "sent_by_me", label: "Sent by me" },
  { id: "completed", label: "Completed" }
];

const INITIAL_FORM_VALUES: CreateFormValues = {
  documentId: "",
  title: "",
  message: "",
  signerUserIds: []
};

function resolveCssColor(variableName: string, fallback: string): string {
  if (typeof window === "undefined") {
    return fallback;
  }

  const value = window
    .getComputedStyle(document.documentElement)
    .getPropertyValue(variableName)
    .trim();

  return value || fallback;
}

function createToastId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function SignaturesTableSkeleton() {
  return (
    <div className="table-skeleton" aria-hidden="true">
      <div className="table-skeleton-header" />
      {Array.from({ length: 6 }, (_, index) => (
        <div key={`signatures-row-skeleton-${index}`} className="table-skeleton-row" />
      ))}
    </div>
  );
}

function statusTone(
  status: SignatureRequestRecord["status"]
): "success" | "warning" | "error" | "info" | "pending" | "draft" | "processing" {
  if (status === "completed") {
    return "success";
  }

  if (status === "pending") {
    return "pending";
  }

  if (status === "partially_signed") {
    return "processing";
  }

  if (status === "expired") {
    return "warning";
  }

  return "error";
}

function statusLabel(status: SignatureRequestRecord["status"]): string {
  if (status === "partially_signed") {
    return "Partially signed";
  }

  return status.replaceAll("_", " ");
}

function validateCreateForm(values: CreateFormValues): CreateFormErrors {
  const errors: CreateFormErrors = {};

  if (!values.documentId.trim()) {
    errors.documentId = "Select a document.";
  }

  if (!values.title.trim()) {
    errors.title = "Title is required.";
  } else if (values.title.trim().length > 200) {
    errors.title = "Title must be 200 characters or fewer.";
  }

  if (values.signerUserIds.length === 0) {
    errors.signerUserIds = "Select at least one signer.";
  }

  return errors;
}

function hasCreateFormErrors(errors: CreateFormErrors): boolean {
  return Boolean(errors.documentId || errors.title || errors.signerUserIds);
}

export function SignaturesClient({
  currentUserId,
  canManageSignatures
}: SignaturesClientProps) {
  const signatures = useSignatures({
    scope: canManageSignatures ? "all" : "mine"
  });
  const documents = useDocuments({
    scope: "all"
  });

  const [activeTab, setActiveTab] = useState<SignatureTab>("pending_action");
  const [createdSortDirection, setCreatedSortDirection] = useState<SortDirection>("desc");
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [createValues, setCreateValues] = useState<CreateFormValues>(INITIAL_FORM_VALUES);
  const [createErrors, setCreateErrors] = useState<CreateFormErrors>({});
  const [isSubmittingCreate, setIsSubmittingCreate] = useState(false);
  const [signerOptions, setSignerOptions] = useState<SignerOption[]>([]);
  const [isSignerOptionsLoading, setIsSignerOptionsLoading] = useState(false);
  const [signerOptionsError, setSignerOptionsError] = useState<string | null>(null);
  const [isOpeningByRequestId, setIsOpeningByRequestId] = useState<Record<string, boolean>>({});
  const [isSigningByRequestId, setIsSigningByRequestId] = useState<Record<string, boolean>>({});
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  // Signing panel state
  const [signingRequest, setSigningRequest] = useState<SignatureRequestRecord | null>(null);
  const [signatureMode, setSignatureMode] = useState<"draw" | "type">("draw");
  const [typedSignature, setTypedSignature] = useState("");
  const [signatureConfirmed, setSignatureConfirmed] = useState(false);
  const [hasCanvasStrokes, setHasCanvasStrokes] = useState(false);
  const [isSubmittingSignature, setIsSubmittingSignature] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawingRef = useRef(false);

  useEffect(() => {
    if (!canManageSignatures) {
      return;
    }

    const abortController = new AbortController();

    const fetchSignerOptions = async () => {
      setIsSignerOptionsLoading(true);
      setSignerOptionsError(null);

      try {
        const response = await fetch("/api/v1/people?scope=all&limit=250", {
          method: "GET",
          signal: abortController.signal
        });

        const payload = (await response.json()) as PeopleListResponse;

        if (!response.ok || !payload.data) {
          setSignerOptions([]);
          setSignerOptionsError(payload.error?.message ?? "Unable to load signer options.");
          return;
        }

        const options = payload.data.people
          .filter((person) => person.id !== currentUserId && person.status === "active")
          .sort((leftPerson, rightPerson) => leftPerson.fullName.localeCompare(rightPerson.fullName))
          .map((person) => ({
            id: person.id,
            fullName: person.fullName,
            department: person.department,
            title: person.title
          }));

        setSignerOptions(options);
      } catch (error) {
        if (abortController.signal.aborted) {
          return;
        }

        setSignerOptions([]);
        setSignerOptionsError(
          error instanceof Error ? error.message : "Unable to load signer options."
        );
      } finally {
        if (!abortController.signal.aborted) {
          setIsSignerOptionsLoading(false);
        }
      }
    };

    void fetchSignerOptions();

    return () => {
      abortController.abort();
    };
  }, [canManageSignatures, currentUserId]);

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

  const visibleRequests = useMemo(() => {
    const filteredRequests = signatures.requests.filter((request) => {
      if (activeTab === "sent_by_me") {
        return request.createdBy === currentUserId;
      }

      if (activeTab === "completed") {
        return request.status === "completed";
      }

      // pending_action — requests needing my signature
      return (
        request.isCurrentUserSigner &&
        (request.currentUserSignerStatus === "pending" ||
          request.currentUserSignerStatus === "viewed") &&
        request.status !== "completed" &&
        request.status !== "voided" &&
        request.status !== "expired"
      );
    });

    return [...filteredRequests].sort((leftRequest, rightRequest) => {
      const leftValue = new Date(leftRequest.createdAt).getTime();
      const rightValue = new Date(rightRequest.createdAt).getTime();

      if (createdSortDirection === "asc") {
        return leftValue - rightValue;
      }

      return rightValue - leftValue;
    });
  }, [activeTab, createdSortDirection, signatures.requests]);

  const resetCreateForm = () => {
    setCreateValues(INITIAL_FORM_VALUES);
    setCreateErrors({});
    setIsSubmittingCreate(false);
  };

  const closeCreatePanel = () => {
    setIsPanelOpen(false);
    resetCreateForm();
  };

  const handleToggleSigner = (signerUserId: string) => {
    setCreateValues((currentValues) => {
      const hasSigner = currentValues.signerUserIds.includes(signerUserId);

      return {
        ...currentValues,
        signerUserIds: hasSigner
          ? currentValues.signerUserIds.filter((value) => value !== signerUserId)
          : [...currentValues.signerUserIds, signerUserId]
      };
    });
  };

  const handleOpenDocument = async (requestRow: SignatureRequestRecord) => {
    setIsOpeningByRequestId((currentState) => ({
      ...currentState,
      [requestRow.id]: true
    }));

    try {
      const response = await fetch(`/api/v1/documents/${requestRow.documentId}/download`, {
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
      setIsOpeningByRequestId((currentState) => {
        const nextState = { ...currentState };
        delete nextState[requestRow.id];
        return nextState;
      });
    }
  };

  const openSigningPanel = (request: SignatureRequestRecord) => {
    setSigningRequest(request);
    setSignatureMode("draw");
    setTypedSignature("");
    setSignatureConfirmed(false);
    setHasCanvasStrokes(false);
    setIsSubmittingSignature(false);
  };

  const closeSigningPanel = () => {
    setSigningRequest(null);
  };

  // Canvas drawing functions
  const getCanvasCoords = useCallback(
    (event: ReactMouseEvent<HTMLCanvasElement> | ReactTouchEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      if ("touches" in event) {
        const touch = event.touches[0] ?? event.changedTouches[0];
        return {
          x: (touch.clientX - rect.left) * (canvas.width / rect.width),
          y: (touch.clientY - rect.top) * (canvas.height / rect.height)
        };
      }
      return {
        x: (event.clientX - rect.left) * (canvas.width / rect.width),
        y: (event.clientY - rect.top) * (canvas.height / rect.height)
      };
    },
    []
  );

  const startDrawing = useCallback(
    (event: ReactMouseEvent<HTMLCanvasElement> | ReactTouchEvent<HTMLCanvasElement>) => {
      event.preventDefault();
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!ctx) return;
      isDrawingRef.current = true;
      const { x, y } = getCanvasCoords(event);
      ctx.beginPath();
      ctx.moveTo(x, y);
    },
    [getCanvasCoords]
  );

  const draw = useCallback(
    (event: ReactMouseEvent<HTMLCanvasElement> | ReactTouchEvent<HTMLCanvasElement>) => {
      event.preventDefault();
      if (!isDrawingRef.current) return;
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!ctx) return;
      const { x, y } = getCanvasCoords(event);
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      ctx.strokeStyle = resolveCssColor("--text-primary", "rgb(15 23 42)");
      ctx.lineTo(x, y);
      ctx.stroke();
      setHasCanvasStrokes(true);
    },
    [getCanvasCoords]
  );

  const stopDrawing = useCallback(() => {
    isDrawingRef.current = false;
  }, []);

  const clearCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!ctx || !canvas) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasCanvasStrokes(false);
  }, []);

  // Initialize canvas when signing panel opens in draw mode
  useEffect(() => {
    if (signingRequest && signatureMode === "draw") {
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext("2d");
        if (ctx) {
          canvas.width = 400;
          canvas.height = 150;
          ctx.fillStyle = resolveCssColor("--bg-canvas", "rgb(255 255 255)");
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
      }
    }
  }, [signingRequest, signatureMode]);

  const canSubmitSignature =
    signatureConfirmed &&
    (signatureMode === "draw" ? hasCanvasStrokes : typedSignature.trim().length > 0);

  const handleSubmitSignature = async () => {
    if (!signingRequest || !canSubmitSignature) return;

    setIsSubmittingSignature(true);

    let signatureText: string;

    if (signatureMode === "type") {
      signatureText = typedSignature.trim();
    } else {
      const canvas = canvasRef.current;
      signatureText = canvas ? canvas.toDataURL("image/png") : "";
    }

    try {
      const response = await fetch(`/api/v1/signatures/${signingRequest.id}/sign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signatureText })
      });

      const payload = (await response.json()) as SignSignatureResponse;

      if (!response.ok || !payload.data) {
        showToast("error", payload.error?.message ?? "Unable to submit signature.");
        return;
      }

      showToast("success", "Signature recorded.");
      closeSigningPanel();
      signatures.refresh();
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : "Unable to submit signature.");
    } finally {
      setIsSubmittingSignature(false);
    }
  };

  const handleCreateSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const validationErrors = validateCreateForm(createValues);
    setCreateErrors(validationErrors);

    if (hasCreateFormErrors(validationErrors)) {
      return;
    }

    setIsSubmittingCreate(true);

    try {
      const response = await fetch("/api/v1/signatures", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          documentId: createValues.documentId,
          title: createValues.title.trim(),
          message: createValues.message.trim(),
          signerUserIds: createValues.signerUserIds
        })
      });

      const payload = (await response.json()) as CreateSignatureRequestResponse;

      if (!response.ok || !payload.data) {
        showToast("error", payload.error?.message ?? "Unable to create signature request.");
        return;
      }

      showToast("success", "Signature request sent.");
      closeCreatePanel();
      signatures.refresh();
    } catch (error) {
      showToast(
        "error",
        error instanceof Error ? error.message : "Unable to create signature request."
      );
    } finally {
      setIsSubmittingCreate(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Signatures"
        description="Request, sign, and track documents securely with a clear signer timeline."
        actions={
          canManageSignatures ? (
            <button
              type="button"
              className="button button-accent"
              onClick={() => setIsPanelOpen(true)}
            >
              New signature request
            </button>
          ) : null
        }
      />

      <section className="page-tabs" aria-label="Signature request filters">
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

      {signatures.isLoading ? <SignaturesTableSkeleton /> : null}

      {!signatures.isLoading && signatures.errorMessage ? (
        <EmptyState
          title="Signatures are unavailable"
          description={signatures.errorMessage}
          ctaLabel="Retry"
          ctaHref="/signatures"
        />
      ) : null}

      {!signatures.isLoading && !signatures.errorMessage && visibleRequests.length === 0 ? (
        <section className="error-state">
          <EmptyState
            icon={<PenSquare size={32} />}
            title="No signatures pending"
            description={
              canManageSignatures
                ? "Create your first signature request to collect acknowledgements digitally."
                : "You do not have pending signature requests right now."
            }
            ctaLabel="Go to dashboard"
            ctaHref="/dashboard"
          />
          {canManageSignatures ? (
            <button
              type="button"
              className="button button-accent"
              onClick={() => setIsPanelOpen(true)}
            >
              New signature request
            </button>
          ) : null}
        </section>
      ) : null}

      {!signatures.isLoading && !signatures.errorMessage && visibleRequests.length > 0 ? (
        <div className="data-table-container">
          <table className="data-table" aria-label="Signature requests table">
            <thead>
              <tr>
                <th>Request</th>
                <th>Document</th>
                <th>Signers</th>
                <th>Status</th>
                <th>
                  <button
                    type="button"
                    className="table-sort-trigger"
                    onClick={() =>
                      setCreatedSortDirection((currentDirection) =>
                        currentDirection === "asc" ? "desc" : "asc"
                      )
                    }
                  >
                    Created {createdSortDirection === "asc" ? "↑" : "↓"}
                  </button>
                </th>
                <th>Updated</th>
                <th className="table-action-column">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visibleRequests.map((requestRow) => {
                const canSign =
                  requestRow.isCurrentUserSigner &&
                  (requestRow.currentUserSignerStatus === "pending" ||
                    requestRow.currentUserSignerStatus === "viewed") &&
                  requestRow.status !== "completed" &&
                  requestRow.status !== "voided" &&
                  requestRow.status !== "expired";

                return (
                  <tr key={requestRow.id} className="data-table-row">
                    <td>
                      <div className="documents-cell-copy">
                        <p className="documents-cell-title">{requestRow.title}</p>
                        <p className="documents-cell-description">
                          {requestRow.message || `Requested by ${requestRow.createdByName}`}
                        </p>
                      </div>
                    </td>
                    <td>{requestRow.documentTitle}</td>
                    <td>
                      <div className="signature-signers-cell">
                        <p className="documents-cell-description">
                          {requestRow.signers
                            .slice(0, 2)
                            .map((signer) => signer.signerName)
                            .join(", ")}
                          {requestRow.signers.length > 2
                            ? ` +${requestRow.signers.length - 2} more`
                            : ""}
                        </p>
                        <p className="signature-signers-meta numeric">
                          {requestRow.pendingSignerCount} pending
                        </p>
                      </div>
                    </td>
                    <td>
                      <StatusBadge tone={statusTone(requestRow.status)}>
                        {statusLabel(requestRow.status)}
                      </StatusBadge>
                    </td>
                    <td>
                      <time
                        dateTime={requestRow.createdAt}
                        title={formatDateTimeTooltip(requestRow.createdAt)}
                      >
                        {formatRelativeTime(requestRow.createdAt)}
                      </time>
                    </td>
                    <td>
                      <time
                        dateTime={requestRow.updatedAt}
                        title={formatDateTimeTooltip(requestRow.updatedAt)}
                      >
                        {formatRelativeTime(requestRow.updatedAt)}
                      </time>
                    </td>
                    <td className="table-row-action-cell">
                      <div className="documents-row-actions">
                        <button
                          type="button"
                          className="table-row-action"
                          onClick={() => void handleOpenDocument(requestRow)}
                          disabled={Boolean(isOpeningByRequestId[requestRow.id])}
                        >
                          {isOpeningByRequestId[requestRow.id] ? "Opening..." : "Open doc"}
                        </button>
                        {canSign ? (
                          <button
                            type="button"
                            className="table-row-action"
                            onClick={() => openSigningPanel(requestRow)}
                          >
                            Sign
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

      {canManageSignatures ? (
        <SlidePanel
          isOpen={isPanelOpen}
          title="New Signature Request"
          description="Choose a document and assign signers. They will receive in-app and email notifications."
          onClose={closeCreatePanel}
        >
          <form className="slide-panel-form-wrapper" onSubmit={handleCreateSubmit} noValidate>
            <label className="form-field" htmlFor="signature-document-id">
              <span className="form-label">Document</span>
              <select
                id="signature-document-id"
                className={createErrors.documentId ? "form-input form-input-error" : "form-input"}
                value={createValues.documentId}
                onChange={(event) => {
                  const nextDocumentId = event.currentTarget.value;
                  const selectedDocument = documents.documents.find(
                    (document) => document.id === nextDocumentId
                  );

                  setCreateValues((currentValues) => ({
                    ...currentValues,
                    documentId: nextDocumentId,
                    title:
                      currentValues.title.trim().length === 0
                        ? selectedDocument?.title ?? ""
                        : currentValues.title
                  }));
                }}
                disabled={documents.isLoading || isSubmittingCreate}
              >
                <option value="">Select a document</option>
                {documents.documents.map((document) => (
                  <option key={document.id} value={document.id}>
                    {document.title}
                  </option>
                ))}
              </select>
              {createErrors.documentId ? (
                <p className="form-field-error">{createErrors.documentId}</p>
              ) : null}
            </label>

            <label className="form-field" htmlFor="signature-request-title">
              <span className="form-label">Request title</span>
              <input
                id="signature-request-title"
                className={createErrors.title ? "form-input form-input-error" : "form-input"}
                value={createValues.title}
                onChange={(event) =>
                  setCreateValues((currentValues) => ({
                    ...currentValues,
                    title: event.currentTarget.value
                  }))
                }
                disabled={isSubmittingCreate}
              />
              {createErrors.title ? <p className="form-field-error">{createErrors.title}</p> : null}
            </label>

            <label className="form-field" htmlFor="signature-request-message">
              <span className="form-label">Message (optional)</span>
              <textarea
                id="signature-request-message"
                className="form-input"
                rows={4}
                value={createValues.message}
                onChange={(event) =>
                  setCreateValues((currentValues) => ({
                    ...currentValues,
                    message: event.currentTarget.value
                  }))
                }
                disabled={isSubmittingCreate}
              />
            </label>

            <fieldset className="signature-signer-picker">
              <legend className="form-label">Signers</legend>
              {isSignerOptionsLoading ? (
                <p className="settings-card-description">Loading signer options...</p>
              ) : null}
              {!isSignerOptionsLoading && signerOptionsError ? (
                <p className="form-field-error">{signerOptionsError}</p>
              ) : null}
              {!isSignerOptionsLoading && !signerOptionsError && signerOptions.length === 0 ? (
                <p className="settings-card-description">No active signers are available.</p>
              ) : null}
              {!isSignerOptionsLoading && !signerOptionsError && signerOptions.length > 0 ? (
                <div className="signature-signer-options">
                  {signerOptions.map((signerOption) => (
                    <label key={signerOption.id} className="settings-checkbox">
                      <input
                        type="checkbox"
                        checked={createValues.signerUserIds.includes(signerOption.id)}
                        onChange={() => handleToggleSigner(signerOption.id)}
                        disabled={isSubmittingCreate}
                      />
                      <span>
                        {signerOption.fullName}
                        <span className="signature-signer-option-meta">
                          {signerOption.title || "Team member"}
                          {signerOption.department ? ` - ${signerOption.department}` : ""}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              ) : null}
              {createErrors.signerUserIds ? (
                <p className="form-field-error">{createErrors.signerUserIds}</p>
              ) : null}
            </fieldset>

            <div className="slide-panel-actions">
              <button
                type="button"
                className="button button-ghost"
                onClick={closeCreatePanel}
                disabled={isSubmittingCreate}
              >
                Cancel
              </button>
              <button type="submit" className="button button-accent" disabled={isSubmittingCreate}>
                {isSubmittingCreate ? "Sending..." : "Send request"}
              </button>
            </div>
          </form>
        </SlidePanel>
      ) : null}

      {/* Signing Panel */}
      {signingRequest ? (
        <SlidePanel
          isOpen={Boolean(signingRequest)}
          title={`Sign: ${signingRequest.title}`}
          description={signingRequest.message || `Requested by ${signingRequest.createdByName}`}
          onClose={closeSigningPanel}
        >
          <div className="slide-panel-form-wrapper">
            {/* Document info */}
            <div className="form-field">
              <span className="form-label">Document</span>
              <p className="settings-card-description">{signingRequest.documentTitle}</p>
              <button
                type="button"
                className="button button-secondary button-sm"
                style={{ marginTop: "var(--space-2)" }}
                onClick={() => void handleOpenDocument(signingRequest)}
                disabled={Boolean(isOpeningByRequestId[signingRequest.id])}
              >
                {isOpeningByRequestId[signingRequest.id] ? "Opening..." : "View document"}
              </button>
            </div>

            {/* Signer status */}
            <div className="form-field">
              <span className="form-label">Signers</span>
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
                {signingRequest.signers.map((signer) => (
                  <div
                    key={signer.id}
                    style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}
                  >
                    <span className="settings-card-description">{signer.signerName}</span>
                    <StatusBadge
                      tone={signer.status === "signed" ? "success" : "pending"}
                    >
                      {toSentenceCase(signer.status)}
                    </StatusBadge>
                  </div>
                ))}
              </div>
            </div>

            {/* Signature mode toggle */}
            <div className="signature-toggle">
              <button
                type="button"
                className={
                  signatureMode === "draw"
                    ? "signature-toggle-button signature-toggle-button-active"
                    : "signature-toggle-button"
                }
                onClick={() => setSignatureMode("draw")}
              >
                Draw signature
              </button>
              <button
                type="button"
                className={
                  signatureMode === "type"
                    ? "signature-toggle-button signature-toggle-button-active"
                    : "signature-toggle-button"
                }
                onClick={() => setSignatureMode("type")}
              >
                Type signature
              </button>
            </div>

            {/* Draw mode */}
            {signatureMode === "draw" ? (
              <>
                <p className="form-label">Draw your signature</p>
                <div className="signature-canvas-container">
                  <canvas
                    ref={canvasRef}
                    className="signature-canvas"
                    onMouseDown={startDrawing}
                    onMouseMove={draw}
                    onMouseUp={stopDrawing}
                    onMouseLeave={stopDrawing}
                    onTouchStart={startDrawing}
                    onTouchMove={draw}
                    onTouchEnd={stopDrawing}
                  />
                </div>
                <button
                  type="button"
                  className="button button-ghost button-sm"
                  onClick={clearCanvas}
                >
                  Clear
                </button>
              </>
            ) : (
              <>
                <label className="form-field" htmlFor="typed-signature-input">
                  <span className="form-label">Type your full name as your signature</span>
                  <input
                    id="typed-signature-input"
                    className="form-input"
                    value={typedSignature}
                    onChange={(e) => setTypedSignature(e.currentTarget.value)}
                    placeholder="Your full name"
                    disabled={isSubmittingSignature}
                  />
                </label>
                {typedSignature.trim().length > 0 ? (
                  <div className="signature-typed-preview">
                    {typedSignature}
                  </div>
                ) : null}
              </>
            )}

            {/* Confirmation */}
            <div className="signature-confirmation">
              <input
                type="checkbox"
                id="signature-confirm-checkbox"
                checked={signatureConfirmed}
                onChange={(e) => setSignatureConfirmed(e.currentTarget.checked)}
                disabled={isSubmittingSignature}
              />
              <label htmlFor="signature-confirm-checkbox">
                I confirm this is my electronic signature and I agree to the contents of this document.
              </label>
            </div>

            {/* Submit */}
            <div className="slide-panel-actions">
              <button
                type="button"
                className="button button-ghost"
                onClick={closeSigningPanel}
                disabled={isSubmittingSignature}
              >
                Cancel
              </button>
              <button
                type="button"
                className="button button-accent"
                onClick={() => void handleSubmitSignature()}
                disabled={!canSubmitSignature || isSubmittingSignature}
              >
                {isSubmittingSignature ? "Submitting..." : "Submit signature"}
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
