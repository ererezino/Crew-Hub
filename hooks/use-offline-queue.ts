"use client";

import { useEffect, useState } from "react";

import {
  replayQueue,
  subscribeToQueue,
  type QueuedSubmission,
  type QueuedSubmissionKind
} from "../lib/offline/submission-queue";

/**
 * Live view of the offline submission queue, optionally filtered by kind.
 * Subscribing also arms the queue's auto-replay (online event + interval).
 */
export function useOfflineQueue(kind?: QueuedSubmissionKind): {
  items: QueuedSubmission[];
  retryNow: () => Promise<number>;
} {
  const [items, setItems] = useState<QueuedSubmission[]>([]);

  useEffect(() => {
    return subscribeToQueue((all) => {
      setItems(kind ? all.filter((item) => item.kind === kind) : all);
    });
  }, [kind]);

  return { items, retryNow: replayQueue };
}
