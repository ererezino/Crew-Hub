"use client";

import { useCallback, useEffect, useRef } from "react";

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "default" | "destructive";
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "default",
  loading = false,
  onConfirm,
  onCancel
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === "Escape" && !loading) {
        onCancel();
      }
    },
    [loading, onCancel]
  );

  useEffect(() => {
    if (!open) return;

    document.addEventListener("keydown", handleKeyDown);
    cancelRef.current?.focus();

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, handleKeyDown]);

  if (!open) return null;

  return (
    <section className="confirm-dialog-overlay" aria-label={title}>
      <button
        type="button"
        className="confirm-dialog-backdrop"
        aria-label="Close dialog"
        disabled={loading}
        onClick={onCancel}
      />
      <article className="confirm-dialog-panel">
        <h2 className="section-title">{title}</h2>
        <p className="settings-card-description">{description}</p>
        <div className="settings-actions">
          <button
            type="button"
            className={
              tone === "destructive"
                ? "button button-danger"
                : "button button-accent"
            }
            disabled={loading}
            onClick={onConfirm}
          >
            {loading ? "Processing..." : confirmLabel}
          </button>
          <button
            ref={cancelRef}
            type="button"
            className="button button-subtle"
            disabled={loading}
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
        </div>
      </article>
    </section>
  );
}
