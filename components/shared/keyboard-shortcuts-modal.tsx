"use client";

import { useCallback, useEffect, useState } from "react";

type ShortcutEntry = {
  keys: string[];
  description: string;
};

type ShortcutGroup = {
  label: string;
  shortcuts: ShortcutEntry[];
};

const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    label: "Navigation",
    shortcuts: [
      { keys: ["g", "h"], description: "Go to Dashboard" },
      { keys: ["g", "a"], description: "Go to Approvals" },
      { keys: ["g", "p"], description: "Go to People" },
      { keys: ["g", "s"], description: "Go to Scheduling" },
      { keys: ["g", "t"], description: "Go to Team Hub" }
    ]
  },
  {
    label: "Actions",
    shortcuts: [{ keys: ["n"], description: "New (context-sensitive)" }]
  },
  {
    label: "Help",
    shortcuts: [{ keys: ["?"], description: "Show this dialog" }]
  }
];

export function KeyboardShortcutsModal() {
  const [isVisible, setIsVisible] = useState(false);

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
        aria-label="Keyboard shortcuts"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="keyboard-shortcuts-header">
          <h2 className="modal-title">Keyboard Shortcuts</h2>
          <button
            type="button"
            className="icon-button"
            onClick={close}
            aria-label="Close"
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
          {SHORTCUT_GROUPS.map((group) => (
            <div key={group.label} className="keyboard-shortcuts-group">
              <h3 className="keyboard-shortcuts-group-label">{group.label}</h3>
              <ul className="keyboard-shortcuts-list">
                {group.shortcuts.map((shortcut) => (
                  <li key={shortcut.description} className="keyboard-shortcuts-row">
                    <span className="keyboard-shortcuts-keys">
                      {shortcut.keys.map((key, index) => (
                        <span key={index}>
                          {index > 0 ? (
                            <span className="keyboard-shortcuts-separator">then</span>
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
