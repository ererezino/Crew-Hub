"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

const CHORD_TIMEOUT_MS = 500;

type ChordRoute = {
  second: string;
  path: string;
};

const CHORD_ROUTES: ChordRoute[] = [
  { second: "h", path: "/dashboard" },
  { second: "a", path: "/approvals" },
  { second: "p", path: "/people" },
  { second: "s", path: "/scheduling" },
  { second: "t", path: "/team-hub" }
];

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tagName = target.tagName.toLowerCase();

  if (tagName === "input" || tagName === "textarea" || tagName === "select") {
    return true;
  }

  if (target.isContentEditable) {
    return true;
  }

  return false;
}

/**
 * Registers global keyboard shortcuts for Crew Hub navigation and actions.
 *
 * Navigation chords (press g, then second key within 500ms):
 *   g h = /dashboard
 *   g a = /approvals
 *   g p = /people
 *   g s = /scheduling
 *   g t = /team-hub
 *
 * Single-key shortcuts:
 *   n   = dispatch 'crew-hub:new-action' custom event
 *   ?   = dispatch 'crew-hub:shortcuts-help' custom event
 */
export function useKeyboardShortcuts() {
  const router = useRouter();
  const pendingChordRef = useRef<string | null>(null);
  const chordTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const clearChord = () => {
      pendingChordRef.current = null;

      if (chordTimerRef.current !== null) {
        clearTimeout(chordTimerRef.current);
        chordTimerRef.current = null;
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }

      if (isEditableTarget(event.target)) {
        return;
      }

      const key = event.key.toLowerCase();

      // Check if we are in the middle of a "g" chord
      if (pendingChordRef.current === "g") {
        clearChord();

        const match = CHORD_ROUTES.find((route) => route.second === key);

        if (match) {
          event.preventDefault();
          router.push(match.path);
        }

        return;
      }

      // Start a new chord with "g"
      if (key === "g") {
        clearChord();
        pendingChordRef.current = "g";
        chordTimerRef.current = setTimeout(clearChord, CHORD_TIMEOUT_MS);
        return;
      }

      // Single-key shortcuts
      if (key === "n") {
        event.preventDefault();
        window.dispatchEvent(new CustomEvent("crew-hub:new-action"));
        return;
      }

      if (event.key === "?") {
        event.preventDefault();
        window.dispatchEvent(new CustomEvent("crew-hub:shortcuts-help"));
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      clearChord();
    };
  }, [router]);
}
