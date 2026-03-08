import { useEffect } from "react";

/**
 * Protects against accidental navigation away from dirty forms.
 *
 * - Tab close / browser refresh: native "Leave site?" prompt
 * - Browser back / forward: dispatches a `crew-hub:unsaved-leave` event
 *   so the global UnsavedLeaveDialog (in app-shell) can show a styled modal.
 *
 * Pass `isDirty = true` when the form has unsaved changes.
 */

/* Module-level flag — set temporarily when the user confirms "Leave" to
   prevent the popstate handler from re-triggering the dialog. */
let bypassGuard = false;

export function confirmUnsavedLeave() {
  bypassGuard = true;
  window.history.back();
  setTimeout(() => {
    bypassGuard = false;
  }, 200);
}

export function useUnsavedGuard(isDirty: boolean) {
  // Browser tab close / refresh protection
  useEffect(() => {
    if (!isDirty) return;

    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };

    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  // Browser back / forward protection — dispatches a custom event for
  // the global dialog instead of using window.confirm()
  useEffect(() => {
    if (!isDirty) return;

    const handlePopState = () => {
      if (bypassGuard) return;

      // Push state back immediately to prevent navigation
      window.history.pushState(null, "", window.location.href);
      // Dispatch event for the global dialog
      window.dispatchEvent(new CustomEvent("crew-hub:unsaved-leave"));
    };

    window.history.pushState(null, "", window.location.href);
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [isDirty]);
}
