"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * Registers a `beforeunload` listener while `isDirty` is true.
 * This warns users before they accidentally close the tab or navigate
 * away from a form with unsaved changes.
 */
export function useUnsavedChanges(isDirty: boolean) {
  const dirtyRef = useRef(isDirty);

  useEffect(() => {
    dirtyRef.current = isDirty;
  }, [isDirty]);

  const handleBeforeUnload = useCallback((event: BeforeUnloadEvent) => {
    if (!dirtyRef.current) return;

    event.preventDefault();
  }, []);

  useEffect(() => {
    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [handleBeforeUnload]);
}
