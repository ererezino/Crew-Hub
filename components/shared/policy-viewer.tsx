"use client";

import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";

import { formatDateTimeTooltip } from "../../lib/datetime";

type AppLocale = "en" | "fr";

type PolicyViewerProps = {
  /** Policy ID in the compliance_policies table */
  policyId: string;
  /** Policy name displayed as the heading */
  policyName: string;
  /** Optional category (e.g. "HR", "General") */
  category?: string;
  /** Signed-by block metadata */
  signedBy?: {
    name: string;
    title: string;
    date?: string;
  };
  /** If the employee has already acknowledged this version */
  acknowledgedAt?: string | null;
  /** Document ID for fetching the actual PDF/file */
  documentId?: string;
  /** Inline markdown content (if no document file) */
  content?: string;
  /** Callback when the user acknowledges the policy */
  onAcknowledge?: () => void;
  /** Whether the acknowledge action is in progress */
  isAcknowledging?: boolean;
  /** Whether the user can acknowledge (employee-track context) */
  canAcknowledge?: boolean;
};

export function PolicyViewer({
  policyId,
  policyName,
  category,
  signedBy,
  acknowledgedAt,
  documentId,
  content,
  onAcknowledge,
  isAcknowledging = false,
  canAcknowledge = true
}: PolicyViewerProps) {
  const t = useTranslations("policyViewer");
  const locale = useLocale() as AppLocale;
  const [documentUrl, setDocumentUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [iframeLoaded, setIframeLoaded] = useState(false);

  // Fetch signed download URL for the document
  useEffect(() => {
    if (!documentId) return;

    let cancelled = false;

    async function fetchUrl() {
      try {
        const response = await fetch(
          `/api/v1/documents/${documentId}/download?expiresIn=600`
        );

        if (!response.ok) {
          setLoadError(true);
          return;
        }

        const payload = await response.json();

        if (!cancelled && payload.data?.url) {
          setDocumentUrl(payload.data.url);
        }
      } catch {
        if (!cancelled) setLoadError(true);
      }
    }

    fetchUrl();
    return () => { cancelled = true; };
  }, [documentId]);

  const handleAcknowledge = useCallback(async () => {
    if (!canAcknowledge || isAcknowledging || acknowledgedAt) return;

    try {
      const response = await fetch(
        `/api/v1/compliance/acknowledgments/${policyId}/acknowledge`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" }
        }
      );

      if (response.ok) {
        onAcknowledge?.();
      }
    } catch {
      // Swallow — user can retry
    }
  }, [canAcknowledge, isAcknowledging, acknowledgedAt, policyId, onAcknowledge]);

  const isAcknowledged = Boolean(acknowledgedAt);

  return (
    <div className="policy-viewer">
      {/* Header */}
      <header className="policy-viewer-header">
        {category ? (
          <span className="pill">{category}</span>
        ) : null}
        <h3 className="policy-viewer-title">{policyName}</h3>
      </header>

      {/* Document body — iframe for PDF, markdown for inline content */}
      <div className="policy-viewer-body">
        {documentId && documentUrl && !loadError ? (
          <>
            {!iframeLoaded ? (
              <div className="policy-viewer-loading">
                <p>{t("loadingDocument")}</p>
              </div>
            ) : null}
            <iframe
              src={documentUrl}
              title={policyName}
              className="policy-viewer-iframe"
              onLoad={() => setIframeLoaded(true)}
              onError={() => setLoadError(true)}
              style={{ display: iframeLoaded ? "block" : "none" }}
            />
          </>
        ) : documentId && loadError ? (
          <div className="policy-viewer-fallback">
            <p>{t("unableToLoad")}</p>
            {documentUrl ? (
              <a
                href={documentUrl}
                target="_blank"
                rel="noreferrer"
                className="button button-sm"
              >
                {t("downloadDocument")}
              </a>
            ) : null}
          </div>
        ) : content ? (
          <div
            className="policy-viewer-content prose"
            dangerouslySetInnerHTML={{ __html: content }}
          />
        ) : (
          <div className="policy-viewer-fallback">
            <p>{t("noContent")}</p>
          </div>
        )}
      </div>

      {/* Signed-by block */}
      {signedBy ? (
        <footer className="policy-viewer-signoff">
          <div className="policy-viewer-signoff-line" />
          <p className="policy-viewer-signoff-text">
            {t("signedBy", { name: signedBy.name, title: signedBy.title })}
          </p>
          {signedBy.date ? (
            <p className="policy-viewer-signoff-date">
              <time
                dateTime={signedBy.date}
                title={formatDateTimeTooltip(signedBy.date, locale)}
              >
                {new Date(signedBy.date).toLocaleDateString(locale, {
                  year: "numeric",
                  month: "long",
                  day: "numeric"
                })}
              </time>
            </p>
          ) : null}
        </footer>
      ) : null}

      {/* Acknowledgment action */}
      {canAcknowledge ? (
        <div className="policy-viewer-acknowledge">
          {isAcknowledged ? (
            <div className="policy-viewer-acknowledged">
              {/* eslint-disable-next-line i18next/no-literal-string */}
              <span className="policy-viewer-acknowledged-icon">✓</span>
              <p>
                {t("acknowledged")}{" "}
                {acknowledgedAt ? (
                  <time
                    dateTime={acknowledgedAt}
                    title={formatDateTimeTooltip(acknowledgedAt, locale)}
                  >
                    {new Date(acknowledgedAt).toLocaleDateString(locale, {
                      year: "numeric",
                      month: "short",
                      day: "numeric"
                    })}
                  </time>
                ) : null}
              </p>
            </div>
          ) : (
            <button
              type="button"
              className="button button-accent"
              disabled={isAcknowledging}
              onClick={handleAcknowledge}
            >
              {isAcknowledging ? t("acknowledging") : t("acknowledgeButton")}
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
