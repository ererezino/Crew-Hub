"use client";

import { useEffect, useMemo, useState } from "react";

import {
  removeSubmission,
  replayQueue,
  retrySubmission,
  setQueueIdentity,
  subscribeToQueue,
  type QueueIdentity,
  type QueuedSubmission,
  type QueuedSubmissionKind
} from "../lib/offline/submission-queue";

/**
 * Live view of the offline submission queue for the current authenticated
 * identity, optionally filtered by kind. Registering the identity binds the
 * queue to this account (OFFLINE-02): items created by a different signed-in
 * user are quarantined (hidden + never transmitted) rather than leaked.
 *
 * Subscribing also arms the queue's auto-replay (online event + interval).
 */
export function useOfflineQueue(
  identity: QueueIdentity | null,
  kind?: QueuedSubmissionKind
): {
  items: QueuedSubmission[];
  retryNow: () => Promise<number>;
  retryItem: (id: string) => Promise<void>;
  removeItem: (id: string) => Promise<void>;
} {
  const [items, setItems] = useState<QueuedSubmission[]>([]);

  /* Keep identity stable across renders so changing it actually signals an
   * account switch (and not just a new object reference each render). */
  const userId = identity?.userId ?? null;
  const orgId = identity?.orgId ?? null;
  const boundIdentity = useMemo<QueueIdentity | null>(
    () => (userId && orgId ? { userId, orgId } : null),
    [userId, orgId]
  );

  useEffect(() => {
    setQueueIdentity(boundIdentity);
  }, [boundIdentity]);

  useEffect(() => {
    return subscribeToQueue((all) => {
      setItems(kind ? all.filter((item) => item.kind === kind) : all);
    });
  }, [kind]);

  return {
    items,
    retryNow: replayQueue,
    retryItem: retrySubmission,
    removeItem: removeSubmission
  };
}
