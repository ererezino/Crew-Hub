"use client";

import { useTranslations } from "next-intl";

import { useOfflineQueue } from "../../hooks/use-offline-queue";
import type { QueueIdentity, QueuedSubmissionKind } from "../../lib/offline/submission-queue";

/**
 * Visible pending-sync state for offline-queued submissions. Rendered on the
 * pages whose submissions can queue (expenses, time-off) so users always see
 * what is waiting on their device — nothing retries silently.
 *
 * Items the server rejected (4xx → `failed`) or that have waited too long
 * (`stale`) are surfaced as a distinct "needs attention" block with explicit
 * Retry / Remove controls — they are never silently dropped (OFFLINE-02).
 *
 * The current authenticated identity is required so the queue can be bound to
 * this account: items created by a different signed-in user are quarantined
 * (hidden + never transmitted).
 */
export function OfflineQueueBanner({
  identity,
  kind
}: {
  identity: QueueIdentity | null;
  kind?: QueuedSubmissionKind;
}) {
  const t = useTranslations("common");
  const { items, retryNow, retryItem, removeItem } = useOfflineQueue(identity, kind);

  const pending = items.filter((item) => item.status === "pending");
  const attention = items.filter((item) => item.status === "failed" || item.status === "stale");

  if (items.length === 0) {
    return null;
  }

  return (
    <div className="offline-queue-banner-stack">
      {pending.length > 0 ? (
        <div className="offline-queue-banner" role="status">
          <div className="offline-queue-banner-text">
            <strong>{t("offlineQueue.pending", { count: pending.length })}</strong>
            <span>{t("offlineQueue.description")}</span>
          </div>
          <button type="button" className="button button-subtle" onClick={() => void retryNow()}>
            {t("offlineQueue.retryNow")}
          </button>
        </div>
      ) : null}

      {attention.length > 0 ? (
        <div className="offline-queue-banner offline-queue-banner-attention" role="alert">
          <div className="offline-queue-banner-text">
            <strong>{t("offlineQueue.needsAttention", { count: attention.length })}</strong>
          </div>
          <ul className="offline-queue-attention-list">
            {attention.map((item) => (
              <li key={item.id} className="offline-queue-attention-item">
                <div className="offline-queue-banner-text">
                  <span>
                    {item.status === "failed"
                      ? t("offlineQueue.failedDescription")
                      : t("offlineQueue.staleDescription")}
                  </span>
                  {item.lastError ? (
                    <span className="offline-queue-attention-error">
                      {t("offlineQueue.errorLabel", { message: item.lastError })}
                    </span>
                  ) : null}
                </div>
                <div className="offline-queue-attention-actions">
                  <button
                    type="button"
                    className="button button-subtle"
                    onClick={() => void retryItem(item.id)}
                  >
                    {t("offlineQueue.retry")}
                  </button>
                  <button
                    type="button"
                    className="button button-subtle"
                    onClick={() => void removeItem(item.id)}
                  >
                    {t("offlineQueue.remove")}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
