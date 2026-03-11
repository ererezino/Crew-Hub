"use client";

import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";

import { setLocaleCookie } from "../../app/actions/locale";
import { LOCALE_META, SUPPORTED_LOCALES, type AppLocale } from "../../i18n/locales";
import { updateLocale } from "../../lib/i18n/update-locale";

type LocaleToggleProps = {
  /** The user's DB-stored locale preference (synced on login). */
  profileLocale?: string | null;
};

/**
 * Language dropdown in the topbar.
 * Shows a globe icon + short label (EN / FR) that opens a disclosure panel
 * listing available languages. Uses the shared updateLocale() mutation.
 */
export function LocaleToggle({ profileLocale }: LocaleToggleProps) {
  const locale = useLocale() as AppLocale;
  const router = useRouter();
  const t = useTranslations("locale");
  const [isPending, startTransition] = useTransition();
  const [isOpen, setIsOpen] = useState(false);
  const hasSynced = useRef(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const itemRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  /* ── Login sync ──────────────────────────────────────────────────
     On first render after login, if the user's DB preference differs
     from the cookie, sync the cookie to match the DB. This ensures DB
     is canonical for authenticated users.

     Why it still exists: Without it, the first render after login would
     use the stale cookie locale, not the user's saved preference.

     How it avoids overwriting a new selection: hasSynced.current = true
     after the first sync. Subsequent renders where the user changed
     locale via the dropdown will have profileLocale === locale, so
     the effect no-ops.

     Uses setLocaleCookie directly (not updateLocale) because this is
     a one-way DB→cookie sync, not a user-initiated change.
  ──────────────────────────────────────────────────────────────────── */
  useEffect(() => {
    if (
      hasSynced.current ||
      !profileLocale ||
      profileLocale === locale ||
      (profileLocale !== "en" && profileLocale !== "fr")
    ) {
      return;
    }

    hasSynced.current = true;

    startTransition(async () => {
      await setLocaleCookie(profileLocale);
      router.refresh();
    });
  }, [profileLocale, locale, router]);

  /* ── Outside click to close ─────────────────────────────────────── */
  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [isOpen]);

  /* ── Keyboard handling ──────────────────────────────────────────── */
  const handleTriggerKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setIsOpen(true);
        // Focus will be set by the open effect
      }
    },
    []
  );

  const handlePanelKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const items = SUPPORTED_LOCALES;
      const focusedIndex = items.findIndex(
        (loc) => itemRefs.current.get(loc) === document.activeElement
      );

      if (e.key === "Escape") {
        e.preventDefault();
        setIsOpen(false);
        triggerRef.current?.focus();
        return;
      }

      if (e.key === "Tab") {
        setIsOpen(false);
        return;
      }

      if (e.key === "ArrowDown") {
        e.preventDefault();
        const next = (focusedIndex + 1) % items.length;
        itemRefs.current.get(items[next])?.focus();
        return;
      }

      if (e.key === "ArrowUp") {
        e.preventDefault();
        const prev = (focusedIndex - 1 + items.length) % items.length;
        itemRefs.current.get(items[prev])?.focus();
        return;
      }
    },
    []
  );

  /* ── Focus active item on open ──────────────────────────────────── */
  useEffect(() => {
    if (isOpen) {
      // Small delay to let the DOM render
      requestAnimationFrame(() => {
        itemRefs.current.get(locale)?.focus();
      });
    }
  }, [isOpen, locale]);

  /* ── Select locale ──────────────────────────────────────────────── */
  function handleSelect(targetLocale: AppLocale) {
    setIsOpen(false);

    if (targetLocale === locale) return;

    startTransition(async () => {
      const result = await updateLocale(targetLocale);

      if (result.ok) {
        router.refresh();
      } else if (result.cookieSet) {
        router.refresh();
        // TODO: show toast warning via t("changeFailedPartial")
      } else {
        // TODO: show toast error via t("changeFailed")
      }
    });
  }

  const meta = LOCALE_META[locale];

  return (
    <div className="locale-toggle" ref={containerRef}>
      <button
        ref={triggerRef}
        className="icon-button locale-trigger"
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        onKeyDown={handleTriggerKeyDown}
        disabled={isPending}
        aria-expanded={isOpen}
        aria-haspopup="true"
        aria-label={t("ariaLabel")}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle
            cx="12"
            cy="12"
            r="9.5"
            stroke="currentColor"
            strokeWidth="1.5"
            fill="none"
          />
          <ellipse
            cx="12"
            cy="12"
            rx="4"
            ry="9.5"
            stroke="currentColor"
            strokeWidth="1.5"
            fill="none"
          />
          <path
            d="M3.5 9h17M3.5 15h17"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
        <span className="locale-trigger-label">{meta.shortLabel}</span>
      </button>

      {isOpen ? (
        <div
          className="locale-dropdown"
          role="group"
          aria-label={t("ariaLabel")}
          onKeyDown={handlePanelKeyDown}
        >
          {SUPPORTED_LOCALES.map((loc) => {
            const isActive = loc === locale;
            return (
              <button
                key={loc}
                ref={(el) => {
                  if (el) itemRefs.current.set(loc, el);
                }}
                type="button"
                className={`locale-dropdown-item${isActive ? " locale-dropdown-item-active" : ""}`}
                aria-pressed={isActive}
                onClick={() => handleSelect(loc)}
              >
                <span>{LOCALE_META[loc].nativeName}</span>
                {isActive ? (
                  <svg
                    className="locale-dropdown-check"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path
                      d="M5 13l4 4L19 7"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      fill="none"
                    />
                  </svg>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
