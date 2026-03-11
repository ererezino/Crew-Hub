"use client";

import { useTranslations } from "next-intl";
import { useEffect } from "react";

type ConfirmDialogTone = "default" | "danger";

type ConfirmDialogProps = {
  isOpen: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: ConfirmDialogTone;
  isConfirming?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmDialog({
  isOpen,
  title,
  description,
  confirmLabel,
  cancelLabel,
  tone = "default",
  isConfirming = false,
  onConfirm,
  onCancel
}: ConfirmDialogProps) {
  const t = useTranslations("common");

  const resolvedConfirmLabel = confirmLabel ?? t("confirm");
  const resolvedCancelLabel = cancelLabel ?? t("cancel");
  const workingLabel = t("working");

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isConfirming) {
        onCancel();
      }
    };

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [isConfirming, isOpen, onCancel]);

  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="modal-overlay"
      onClick={() => {
        if (!isConfirming) {
          onCancel();
        }
      }}
    >
      <section
        className={
          tone === "danger"
            ? "confirm-dialog modal-dialog modal-dialog-danger"
            : "confirm-dialog modal-dialog"
        }
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="modal-title">{title}</h2>
        {description ? <p className="settings-card-description">{description}</p> : null}
        <div className="modal-actions">
          <button type="button" className="button button-subtle" onClick={onCancel} disabled={isConfirming}>
            {resolvedCancelLabel}
          </button>
          <button
            type="button"
            className={tone === "danger" ? "button button-danger" : "button button-accent"}
            onClick={onConfirm}
            disabled={isConfirming}
          >
            {isConfirming ? workingLabel : resolvedConfirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
