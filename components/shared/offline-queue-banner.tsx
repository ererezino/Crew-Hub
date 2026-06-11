"use client";

import { useTranslations } from "next-intl";

import { useOfflineQueue } from "../../hooks/use-offline-queue";
import type { QueuedSubmissionKind } from "../../lib/offline/submission-queue";

/**
 * Visible pending-sync state for offline-queued submissions. Rendered on the
 * pages whose submissions can queue (expenses, time-off) so users always see
 * what is waiting on their device — nothing retries silently.
 */
export function OfflineQueueBanner({ kind }: { kind?: QueuedSubmissionKind }) {
  const t = useTranslations("common");
  const { items, retryNow } = useOfflineQueue(kind);

  if (items.length === 0) {
    return null;
  }

  return (
    <div className="offline-queue-banner" role="status">
      <div className="offline-queue-banner-text">
        <strong>{t("offlineQueue.pending", { count: items.length })}</strong>
        <span>{t("offlineQueue.description")}</span>
      </div>
      <button type="button" className="button button-subtle" onClick={() => void retryNow()}>
        {t("offlineQueue.retryNow")}
      </button>
    </div>
  );
}
