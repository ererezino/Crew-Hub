"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode
} from "react";

type Theme = "light" | "dark";

type ThemeContextValue = {
  theme: Theme;
  isReady: boolean;
  toggleTheme: () => void;
};

const THEME_STORAGE_KEY = "crew-hub-theme";

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function getInitialTheme(): Theme {
  if (typeof window === "undefined") {
    return "light";
  }

  try {
    const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (storedTheme === "dark" || storedTheme === "light") {
      return storedTheme;
    }

    if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
      return "dark";
    }
  } catch {
    // Fallback to light if storage or media query APIs are unavailable.
  }

  return "light";
}

/* The stored/preferred theme lives in localStorage + matchMedia, which the
 * server cannot read — resolving it during render made the server HTML
 * (light) disagree with a dark-mode client's first render, a hydration
 * failure on every page for those users. useSyncExternalStore serves the
 * server snapshot ("light", isReady=false) during SSR and hydration so both
 * trees agree, then re-renders with the stored theme. The snapshot is cached
 * because getSnapshot must return a stable value; toggles layer on top via
 * local state and persist through the effect below. */
const emptySubscribe = () => () => {};

let cachedClientTheme: Theme | null = null;

function getClientInitialTheme(): Theme {
  if (cachedClientTheme === null) {
    cachedClientTheme = getInitialTheme();
  }
  return cachedClientTheme;
}

function getServerInitialTheme(): Theme {
  return "light";
}

function getClientIsReady(): boolean {
  return true;
}

function getServerIsReady(): boolean {
  return false;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const initialTheme = useSyncExternalStore(
    emptySubscribe,
    getClientInitialTheme,
    getServerInitialTheme
  );
  const isReady = useSyncExternalStore(emptySubscribe, getClientIsReady, getServerIsReady);
  const [override, setOverride] = useState<Theme | null>(null);
  const theme = override ?? initialTheme;

  useEffect(() => {
    if (!isReady) {
      return;
    }

    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    root.dataset.theme = theme;

    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Keep rendering even if localStorage is unavailable.
    }
  }, [isReady, theme]);

  const value = useMemo(
    () => ({
      theme,
      isReady,
      toggleTheme: () => {
        setOverride(theme === "light" ? "dark" : "light");
      }
    }),
    [isReady, theme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);

  if (!context) {
    throw new Error("useTheme must be used inside ThemeProvider");
  }

  return context;
}
