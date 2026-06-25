/**
 * Regression tests for the "flood of stale notifications on login" bug.
 *
 * The notification center bootstraps its "already alerted" set once the feed
 * data has loaded; shouldBrowserAlert is the per-item gate that, together with
 * a hard age cap, guarantees a stale backlog can never be surfaced as system
 * notifications.
 */
import { describe, expect, it } from "vitest";

import { MAX_BROWSER_ALERT_AGE_MS, shouldBrowserAlert } from "../lib/notifications/browser-alerts";

const NOW = 1_700_000_000_000;
const iso = (ms: number) => new Date(ms).toISOString();

describe("shouldBrowserAlert", () => {
  it("alerts a fresh, unread, not-yet-alerted item", () => {
    expect(
      shouldBrowserAlert(
        { isRead: false, createdAt: iso(NOW - 30_000) }, // 30s old
        { alreadyAlerted: false, now: NOW }
      )
    ).toBe(true);
  });

  it("does NOT alert a read item", () => {
    expect(
      shouldBrowserAlert({ isRead: true, createdAt: iso(NOW - 30_000) }, { alreadyAlerted: false, now: NOW })
    ).toBe(false);
  });

  it("does NOT alert an item already alerted this session", () => {
    expect(
      shouldBrowserAlert({ isRead: false, createdAt: iso(NOW - 30_000) }, { alreadyAlerted: true, now: NOW })
    ).toBe(false);
  });

  it("does NOT alert a STALE item even if unread and not yet alerted (the login-flood case)", () => {
    // A 'Democracy Day' / old-leave announcement created weeks ago.
    const weeksAgo = NOW - 18 * 24 * 60 * 60 * 1000;
    expect(
      shouldBrowserAlert({ isRead: false, createdAt: iso(weeksAgo) }, { alreadyAlerted: false, now: NOW })
    ).toBe(false);
  });

  it("treats the age cap boundary correctly", () => {
    expect(
      shouldBrowserAlert(
        { isRead: false, createdAt: iso(NOW - MAX_BROWSER_ALERT_AGE_MS) },
        { alreadyAlerted: false, now: NOW }
      )
    ).toBe(true); // exactly at the cap → allowed
    expect(
      shouldBrowserAlert(
        { isRead: false, createdAt: iso(NOW - MAX_BROWSER_ALERT_AGE_MS - 1) },
        { alreadyAlerted: false, now: NOW }
      )
    ).toBe(false); // 1ms past the cap → blocked
  });

  it("fails safe on an unparseable timestamp", () => {
    expect(
      shouldBrowserAlert({ isRead: false, createdAt: "not-a-date" }, { alreadyAlerted: false, now: NOW })
    ).toBe(false);
  });

  it("simulated login backlog: a batch of weeks-old unread items yields ZERO alerts", () => {
    const backlog = [
      { isRead: false, createdAt: iso(NOW - 12 * 86_400_000) }, // Democracy Day
      { isRead: false, createdAt: iso(NOW - 9 * 86_400_000) }, // old leave
      { isRead: false, createdAt: iso(NOW - 2 * 86_400_000) }, // birthday
      { isRead: false, createdAt: iso(NOW - 60_000) } // one genuinely fresh item
    ];
    const alertable = backlog.filter((item) =>
      shouldBrowserAlert(item, { alreadyAlerted: false, now: NOW })
    );
    // Only the fresh item (60s old) is alertable — the weeks-old backlog is suppressed.
    expect(alertable).toHaveLength(1);
  });
});
