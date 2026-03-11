"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { confirmUnsavedLeave } from "../../hooks/use-unsaved-guard";

/**
 * Global dialog rendered once in the app shell. Listens for the
 * `crew-hub:unsaved-leave` custom event dispatched by useUnsavedGuard
 * and shows a styled confirmation dialog.
 */
export function UnsavedLeaveDialog() {
  const t = useTranslations("common.unsavedDialog");
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const handler = () => setIsOpen(true);
    window.addEventListener("crew-hub:unsaved-leave", handler);
    return () => window.removeEventListener("crew-hub:unsaved-leave", handler);
  }, []);

  const handleLeave = useCallback(() => {
    setIsOpen(false);
    confirmUnsavedLeave();
  }, []);

  const handleStay = useCallback(() => {
    setIsOpen(false);
  }, []);

  if (!isOpen) return null;

  return (
    <div className="unsaved-dialog-overlay" role="dialog" aria-modal="true" aria-label={t("title")}>
      <div className="unsaved-dialog">
        <h3 className="unsaved-dialog-title">{t("title")}</h3>
        <p className="unsaved-dialog-body">
          {t("body")}
        </p>
        <div className="unsaved-dialog-actions">
          <button
            type="button"
            className="unsaved-dialog-btn unsaved-dialog-stay"
            onClick={handleStay}
            autoFocus
          >
            {t("stay")}
          </button>
          <button
            type="button"
            className="unsaved-dialog-btn unsaved-dialog-leave"
            onClick={handleLeave}
          >
            {t("leave")}
          </button>
        </div>
      </div>
    </div>
  );
}
