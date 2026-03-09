"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
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

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>("light");
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    let resolvedTheme: Theme = "light";

    try {
      const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
      if (storedTheme === "dark" || storedTheme === "light") {
        resolvedTheme = storedTheme;
      } else if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
        resolvedTheme = "dark";
      }
    } catch {
      resolvedTheme = "light";
    }

    setTheme(resolvedTheme);
    setIsReady(true);
  }, []);

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
        setTheme((currentTheme) =>
          currentTheme === "light" ? "dark" : "light"
        );
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
