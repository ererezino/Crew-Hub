"use client";

import { useEffect, useId, type ReactNode } from "react";

type SlidePanelProps = {
  isOpen: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
};

export function SlidePanel({
  isOpen,
  title,
  description,
  onClose,
  children
}: SlidePanelProps) {
  const headingId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="slide-panel-root" role="presentation">
      <button
        type="button"
        className="slide-panel-backdrop"
        onClick={onClose}
        aria-label="Close panel"
      />
      <section
        className="slide-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        aria-describedby={description ? descriptionId : undefined}
      >
        <header className="slide-panel-header">
          <div>
            <h2 className="section-title" id={headingId}>
              {title}
            </h2>
            {description ? (
              <p className="settings-card-description" id={descriptionId}>
                {description}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="Close panel"
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
        </header>

        <div className="slide-panel-content">{children}</div>
      </section>
    </div>
  );
}
