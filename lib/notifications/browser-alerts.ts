/**
 * Pure decision logic for which feed items may trigger a *browser* (system)
 * notification. Kept separate from the React component so it can be unit-tested.
 *
 * Two guards prevent the "flood of stale notifications on every login" bug:
 *   1. The notification center bootstraps its "already alerted" set ONCE the
 *      data has actually loaded (see NotificationCenter) — so the backlog
 *      present at login is never alerted, only genuinely new arrivals are.
 *   2. As defence in depth, an item that is older than MAX_BROWSER_ALERT_AGE_MS
 *      is never surfaced as a system notification regardless of bootstrap — so
 *      even a bootstrap miss cannot push weeks-old holiday/leave/birthday items.
 */

/** Items older than this are never raised as browser notifications. */
export const MAX_BROWSER_ALERT_AGE_MS = 10 * 60 * 1000; // 10 minutes

export function shouldBrowserAlert(
  item: { isRead: boolean; createdAt: string },
  opts: { alreadyAlerted: boolean; now: number; maxAgeMs?: number }
): boolean {
  if (item.isRead || opts.alreadyAlerted) {
    return false;
  }
  const createdMs = new Date(item.createdAt).getTime();
  if (!Number.isFinite(createdMs)) {
    // Unparseable timestamp — fail safe and do not alert.
    return false;
  }
  const maxAgeMs = opts.maxAgeMs ?? MAX_BROWSER_ALERT_AGE_MS;
  return opts.now - createdMs <= maxAgeMs;
}
