"use client";

import { useTheme } from "./theme-provider";

export function ThemeToggle() {
  const { isReady, theme, toggleTheme } = useTheme();

  return (
    <button
      className="icon-button"
      type="button"
      onClick={toggleTheme}
      aria-label="Toggle color mode"
      title="Toggle color mode"
    >
      {isReady && theme === "dark" ? (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8Z"
            fill="currentColor"
          />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="4" fill="currentColor" />
          <path
            d="M12 2v2.5M12 19.5V22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M2 12h2.5M19.5 12H22M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
      )}
    </button>
  );
}
