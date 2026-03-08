"use client";

import { useCallback, useEffect, useState } from "react";

import { confirmUnsavedLeave } from "../../hooks/use-unsaved-guard";

/**
 * Global dialog rendered once in the app shell. Listens for the
 * `crew-hub:unsaved-leave` custom event dispatched by useUnsavedGuard
 * and shows a styled confirmation dialog.
 */
export function UnsavedLeaveDialog() {
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
    <div className="unsaved-dialog-overlay" role="dialog" aria-modal="true" aria-label="Unsaved changes">
      <div className="unsaved-dialog">
        <h3 className="unsaved-dialog-title">Unsaved changes</h3>
        <p className="unsaved-dialog-body">
          You have unsaved changes that will be lost if you leave this page.
        </p>
        <div className="unsaved-dialog-actions">
          <button
            type="button"
            className="unsaved-dialog-btn unsaved-dialog-stay"
            onClick={handleStay}
            autoFocus
          >
            Stay on page
          </button>
          <button
            type="button"
            className="unsaved-dialog-btn unsaved-dialog-leave"
            onClick={handleLeave}
          >
            Leave page
          </button>
        </div>
      </div>
    </div>
  );
}
