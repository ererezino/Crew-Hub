"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

type ShortcutEntry = {
  keys: string[];
  description: string;
};

type ShortcutGroup = {
  label: string;
  shortcuts: ShortcutEntry[];
};

export function KeyboardShortcutsModal() {
  const t = useTranslations("shortcuts");
  const [isVisible, setIsVisible] = useState(false);

  const shortcutGroups = useMemo<ShortcutGroup[]>(() => [
    {
      label: t("group.navigation"),
      shortcuts: [
        { keys: ["g", "h"], description: t("action.goToDashboard") },
        { keys: ["g", "a"], description: t("action.goToApprovals") },
        { keys: ["g", "p"], description: t("action.goToPeople") },
        { keys: ["g", "s"], description: t("action.goToScheduling") },
        { keys: ["g", "t"], description: t("action.goToTeamHub") }
      ]
    },
    {
      label: t("group.actions"),
      shortcuts: [{ keys: ["n"], description: t("action.new") }]
    },
    {
      label: t("group.help"),
      shortcuts: [{ keys: ["?"], description: t("action.showHelp") }]
    }
  ], [t]);

  const close = useCallback(() => {
    setIsVisible(false);
  }, []);

  useEffect(() => {
    const handleToggle = () => {
      setIsVisible((current) => !current);
    };

    window.addEventListener("crew-hub:shortcuts-help", handleToggle);
    return () => window.removeEventListener("crew-hub:shortcuts-help", handleToggle);
  }, []);

  useEffect(() => {
    if (!isVisible) {
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close();
      }
    };

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [isVisible, close]);

  if (!isVisible) {
    return null;
  }

  return (
    <div className="modal-overlay" onClick={close}>
      <section
        className="keyboard-shortcuts-modal modal-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t("ariaLabel")}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="keyboard-shortcuts-header">
          <h2 className="modal-title">{t("title")}</h2>
          <button
            type="button"
            className="icon-button"
            onClick={close}
            aria-label={t("closeLabel")}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" style={{ width: 18, height: 18 }}>
              <path
                d="M18 6L6 18M6 6l12 12"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        <div className="keyboard-shortcuts-body">
          {shortcutGroups.map((group) => (
            <div key={group.label} className="keyboard-shortcuts-group">
              <h3 className="keyboard-shortcuts-group-label">{group.label}</h3>
              <ul className="keyboard-shortcuts-list">
                {group.shortcuts.map((shortcut) => (
                  <li key={shortcut.description} className="keyboard-shortcuts-row">
                    <span className="keyboard-shortcuts-keys">
                      {shortcut.keys.map((key, index) => (
                        <span key={index}>
                          {index > 0 ? (
                            <span className="keyboard-shortcuts-separator">{t("separator")}</span>
                          ) : null}
                          <kbd className="keyboard-shortcuts-kbd">{key}</kbd>
                        </span>
                      ))}
                    </span>
                    <span className="keyboard-shortcuts-desc">{shortcut.description}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
