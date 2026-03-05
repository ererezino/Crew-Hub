import { useEffect } from "react";

/**
 * Protects against accidental navigation away from dirty forms.
 *
 * - Tab close / browser refresh: native "Leave site?" prompt
 * - Browser back / forward: window.confirm() dialog
 *
 * Pass `isDirty = true` when the form has unsaved changes.
 */
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

  // Browser back / forward protection
  useEffect(() => {
    if (!isDirty) return;

    const handlePopState = () => {
      const leave = window.confirm(
        "You have unsaved changes. Leave this page?"
      );

      if (!leave) {
        window.history.pushState(null, "", window.location.href);
      }
    };

    window.history.pushState(null, "", window.location.href);
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [isDirty]);
}
