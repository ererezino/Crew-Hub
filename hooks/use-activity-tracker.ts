"use client";

import { useCallback, useEffect, useRef } from "react";

const ACTIVITY_EVENTS = [
  "mousemove",
  "keydown",
  "mousedown",
  "scroll",
  "touchstart",
  "pointerdown",
] as const;

/**
 * Tracks whether the user has generated any input activity since the last check.
 * Uses a simple boolean flag — zero overhead per event (no timestamps, no timers).
 *
 * Usage:
 *   const { getAndResetActivityFlag } = useActivityTracker();
 *   // Every heartbeat: const isActive = getAndResetActivityFlag();
 */
export function useActivityTracker() {
  const hadActivityRef = useRef(true); // true on mount — page load counts as activity
  const lastInactiveAtRef = useRef<number | null>(null); // timestamp when hadActivity last became false

  useEffect(() => {
    const onActivity = () => {
      hadActivityRef.current = true;
      lastInactiveAtRef.current = null; // user is active again
    };

    for (const event of ACTIVITY_EVENTS) {
      document.addEventListener(event, onActivity, { capture: true, passive: true });
    }

    return () => {
      for (const event of ACTIVITY_EVENTS) {
        document.removeEventListener(event, onActivity, { capture: true });
      }
    };
  }, []);

  /**
   * Returns true if any activity event fired since the last call, then resets the flag.
   * Also tracks when the user went inactive (for idle-recovery optimization).
   */
  const getAndResetActivityFlag = useCallback((): boolean => {
    const had = hadActivityRef.current;
    hadActivityRef.current = false;
    if (!had && lastInactiveAtRef.current === null) {
      lastInactiveAtRef.current = Date.now();
    }
    return had;
  }, []);

  /**
   * Returns how long (ms) the user has been continuously inactive,
   * or 0 if they are currently active.
   * Used for the idle-recovery immediate heartbeat optimization.
   */
  const getInactiveDurationMs = useCallback((): number => {
    if (hadActivityRef.current) return 0;
    if (lastInactiveAtRef.current === null) return 0;
    return Date.now() - lastInactiveAtRef.current;
  }, []);

  return { getAndResetActivityFlag, getInactiveDurationMs };
}
