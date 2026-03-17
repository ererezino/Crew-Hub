"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

type DocumentViewerProps = {
  isOpen: boolean;
  title: string;
  /** Signed URL to the document (PDF or image) */
  documentUrl: string | null;
  /** Optional filename for download */
  fileName?: string;
  /** MIME type — helps decide render strategy */
  mimeType?: string;
  /** Callback when the viewer is closed */
  onClose: () => void;
  /** Optional callback to refresh the signed URL if it expires */
  onRefreshUrl?: () => Promise<string | null>;
};

function isPdfMime(mimeType: string | undefined): boolean {
  if (!mimeType) return false;
  return mimeType === "application/pdf";
}

function isImageMime(mimeType: string | undefined): boolean {
  if (!mimeType) return false;
  return mimeType.startsWith("image/");
}

function guessTypeFromUrl(url: string): "pdf" | "image" | "unknown" {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    if (pathname.endsWith(".pdf")) return "pdf";
    if (/\.(png|jpe?g|gif|webp|svg|bmp|ico)$/.test(pathname)) return "image";
  } catch {
    // URL parsing failed — fall through
  }
  return "unknown";
}

export function DocumentViewer({
  isOpen,
  title,
  documentUrl,
  fileName,
  mimeType,
  onClose,
  onRefreshUrl
}: DocumentViewerProps) {
  const t = useTranslations("documentViewer");
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [loadError, setLoadError] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Determine render type
  const renderType: "pdf" | "image" | "unsupported" | "loading" = (() => {
    if (!documentUrl) return "loading";
    if (isPdfMime(mimeType)) return "pdf";
    if (isImageMime(mimeType)) return "image";
    // Fallback: guess from URL
    const guessed = guessTypeFromUrl(documentUrl);
    if (guessed === "pdf") return "pdf";
    if (guessed === "image") return "image";
    // If no mimeType was provided, default to PDF (most common use case)
    if (!mimeType) return "pdf";
    return "unsupported";
  })();

  // Escape key closes the viewer
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  // Prevent body scroll when open
  useEffect(() => {
    if (!isOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  // Reset error state when URL changes
  useEffect(() => {
    setLoadError(false);
  }, [documentUrl]);

  const handleRefreshUrl = useCallback(async () => {
    if (!onRefreshUrl || isRefreshing) return;

    setIsRefreshing(true);
    try {
      const newUrl = await onRefreshUrl();
      if (newUrl) {
        setLoadError(false);
      }
    } finally {
      setIsRefreshing(false);
    }
  }, [onRefreshUrl, isRefreshing]);

  const handleIframeError = useCallback(() => {
    setLoadError(true);
    if (onRefreshUrl) {
      void handleRefreshUrl();
    }
  }, [onRefreshUrl, handleRefreshUrl]);

  const handleDownload = useCallback(() => {
    if (!documentUrl) return;

    const anchor = document.createElement("a");
    anchor.href = documentUrl;
    anchor.download = fileName || title || "document";
    anchor.rel = "noopener noreferrer";
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
  }, [documentUrl, fileName, title]);

  const handlePrint = useCallback(() => {
    if (!iframeRef.current) return;

    try {
      iframeRef.current.contentWindow?.print();
    } catch {
      // Cross-origin restriction — open in new tab for printing
      if (documentUrl) {
        window.open(documentUrl, "_blank", "noopener,noreferrer");
      }
    }
  }, [documentUrl]);

  const handleOpenNewTab = useCallback(() => {
    if (!documentUrl) return;
    window.open(documentUrl, "_blank", "noopener,noreferrer");
  }, [documentUrl]);

  if (!isOpen) return null;

  return (
    <div
      className="document-viewer-overlay"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className="document-viewer-header"
        onClick={(event) => event.stopPropagation()}
      >
        <span className="document-viewer-title">{title}</span>
        <div className="document-viewer-actions">
          {documentUrl ? (
            <>
              {/* Open in new tab */}
              <button
                type="button"
                className="document-viewer-action"
                onClick={handleOpenNewTab}
                title={t("openNewTab")}
                aria-label={t("openNewTab")}
              >
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>

              {/* Download */}
              <button
                type="button"
                className="document-viewer-action"
                onClick={handleDownload}
                title={t("download")}
                aria-label={t("download")}
              >
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>

              {/* Print (only for PDFs) */}
              {renderType === "pdf" ? (
                <button
                  type="button"
                  className="document-viewer-action"
                  onClick={handlePrint}
                  title={t("print")}
                  aria-label={t("print")}
                >
                  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path
                      d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <rect
                      x="6"
                      y="14"
                      width="12"
                      height="8"
                      rx="1"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              ) : null}
            </>
          ) : null}

          {/* Close */}
          <button
            type="button"
            className="document-viewer-action"
            onClick={onClose}
            title={t("close")}
            aria-label={t("close")}
          >
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M6 6l12 12M18 6L6 18"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
      </div>

      <div
        className="document-viewer-body"
        onClick={(event) => event.stopPropagation()}
      >
        {renderType === "loading" ? (
          <div className="document-viewer-loading">
            <p>{t("loading")}</p>
          </div>
        ) : null}

        {renderType === "pdf" && documentUrl && !loadError ? (
          <iframe
            ref={iframeRef}
            src={documentUrl + "#toolbar=1&navpanes=0"}
            className="document-viewer-iframe"
            title={title}
            onError={handleIframeError}
          />
        ) : null}

        {renderType === "image" && documentUrl && !loadError ? (
          /* eslint-disable-next-line @next/next/no-img-element -- external signed URL, not a static asset */
          <img
            src={documentUrl}
            alt={title}
            className="document-viewer-image"
            onError={handleIframeError}
          />
        ) : null}

        {renderType === "unsupported" && !loadError ? (
          <div className="document-viewer-fallback">
            <p>{t("unsupportedType")}</p>
            <p>{t("downloadInstead")}</p>
            <button
              type="button"
              className="button button-accent"
              onClick={handleDownload}
            >
              {t("download")}
            </button>
          </div>
        ) : null}

        {loadError ? (
          <div className="document-viewer-fallback">
            <p>{t("loadError")}</p>
            {onRefreshUrl ? (
              <button
                type="button"
                className="button"
                onClick={handleRefreshUrl}
                disabled={isRefreshing}
                style={{ marginBottom: "8px" }}
              >
                {isRefreshing ? "..." : t("loading").replace("...", "")}
              </button>
            ) : null}
            <button
              type="button"
              className="button button-accent"
              onClick={handleDownload}
            >
              {t("download")}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
