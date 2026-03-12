"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";

const DISMISS_KEY = "crewhub-browser-notification-prompt-dismissed";
const BROWSER_PUSH_PREF_KEY = "crewhub-browser-push-enabled";

/**
 * Non-intrusive banner shown at the top of the page content area when the user
 * has not yet enabled browser notifications. Shown once per browser — can be
 * dismissed permanently via localStorage.
 *
 * Conditions for display:
 *  1. Browser supports the Notification API
 *  2. Permission is "default" (never asked) — not "granted" or "denied"
 *  3. User hasn't dismissed this prompt before
 *  4. Browser push preference is NOT already enabled in localStorage
 */
export function BrowserNotificationPrompt() {
  const t = useTranslations("appShell.notificationPrompt");
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("Notification" in window)) return;
    if (Notification.permission !== "default") return;
    if (window.localStorage.getItem(DISMISS_KEY) === "true") return;
    if (window.localStorage.getItem(BROWSER_PUSH_PREF_KEY) === "true") return;

    setVisible(true);
  }, []);

  const handleEnable = useCallback(async () => {
    try {
      const permission = await Notification.requestPermission();

      if (permission === "granted") {
        window.localStorage.setItem(BROWSER_PUSH_PREF_KEY, "true");
        window.dispatchEvent(new CustomEvent("crewhub:browser-push-pref-updated"));

        /* Persist to server — send all four fields (API requires them all).
           Use defaults that match the server-side normalizeNotificationPreferences:
           email/in-app default ON, browserPush now explicitly ON. */
        try {
          await fetch("/api/v1/settings/notifications", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              emailAnnouncements: true,
              emailApprovals: true,
              inAppReminders: true,
              browserPush: true
            })
          });
        } catch {
          /* Non-critical — localStorage is the primary store for browser push */
        }
      }
    } catch {
      /* Notification API error */
    }

    /* Dismiss regardless of outcome */
    window.localStorage.setItem(DISMISS_KEY, "true");
    setVisible(false);
  }, []);

  const handleDismiss = useCallback(() => {
    window.localStorage.setItem(DISMISS_KEY, "true");
    setVisible(false);
  }, []);

  if (!visible) return null;

  return (
    <div className="browser-notification-prompt" role="status">
      <div className="browser-notification-prompt-icon">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
      </div>
      <div className="browser-notification-prompt-content">
        <p className="browser-notification-prompt-title">{t("title")}</p>
        <p className="browser-notification-prompt-body">{t("body")}</p>
      </div>
      <div className="browser-notification-prompt-actions">
        <button
          type="button"
          className="browser-notification-prompt-enable"
          onClick={handleEnable}
        >
          {t("enable")}
        </button>
        <button
          type="button"
          className="browser-notification-prompt-dismiss"
          onClick={handleDismiss}
          aria-label={t("dismiss")}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    </div>
  );
}
