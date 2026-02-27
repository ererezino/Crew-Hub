"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent
} from "react";

import type { NavItem } from "../../lib/navigation";

type CommandPaletteProps = {
  routes: NavItem[];
  recentRouteHrefs: string[];
  onClose: () => void;
  onSelect: (route: NavItem) => void;
};

type CommandSection = {
  label: string;
  items: NavItem[];
};

type IndexedSection = CommandSection & {
  startIndex: number;
};

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function toSearchText(route: NavItem): string {
  return normalize(`${route.label} ${route.description} ${route.href}`);
}

function fuzzyScore(query: string, target: string): number | null {
  if (query.length === 0) {
    return 0;
  }

  let queryIndex = 0;
  let score = 0;

  for (let targetIndex = 0; targetIndex < target.length; targetIndex += 1) {
    if (target[targetIndex] === query[queryIndex]) {
      score += targetIndex;
      queryIndex += 1;
      if (queryIndex === query.length) {
        return score;
      }
    }
  }

  return null;
}

function dedupeRoutes(items: NavItem[]): NavItem[] {
  const routeByHref = new Map<string, NavItem>();

  for (const item of items) {
    if (!routeByHref.has(item.href)) {
      routeByHref.set(item.href, item);
    }
  }

  return [...routeByHref.values()];
}

export function CommandPalette({
  routes,
  recentRouteHrefs,
  onClose,
  onSelect
}: CommandPaletteProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

  const routeMap = useMemo(
    () => new Map(routes.map((route) => [route.href, route])),
    [routes]
  );

  const recentRoutes = useMemo(
    () =>
      recentRouteHrefs
        .map((href) => routeMap.get(href))
        .filter((route): route is NavItem => Boolean(route)),
    [recentRouteHrefs, routeMap]
  );

  const filteredRoutes = useMemo(() => {
    const normalizedQuery = normalize(query);

    if (!normalizedQuery) {
      return routes;
    }

    return routes
      .map((route) => ({
        route,
        score: fuzzyScore(normalizedQuery, toSearchText(route))
      }))
      .filter(
        (item): item is { route: NavItem; score: number } =>
          item.score !== null
      )
      .sort((leftItem, rightItem) => leftItem.score - rightItem.score)
      .map((item) => item.route);
  }, [query, routes]);

  const sections = useMemo<CommandSection[]>(() => {
    const normalizedQuery = normalize(query);

    if (normalizedQuery) {
      return [{ label: "Results", items: filteredRoutes }];
    }

    return [
      { label: "Recently visited", items: recentRoutes },
      {
        label: "All routes",
        items: dedupeRoutes([...recentRoutes, ...filteredRoutes])
      }
    ];
  }, [filteredRoutes, query, recentRoutes]);

  const indexedSections = useMemo<IndexedSection[]>(() => {
    let nextIndex = 0;

    return sections
      .filter((section) => section.items.length > 0)
      .map((section) => {
        const indexedSection: IndexedSection = {
          ...section,
          startIndex: nextIndex
        };

        nextIndex += section.items.length;
        return indexedSection;
      });
  }, [sections]);

  const flatRoutes = useMemo(
    () => indexedSections.flatMap((section) => section.items),
    [indexedSections]
  );

  const safeSelectedIndex =
    flatRoutes.length > 0
      ? Math.min(selectedIndex, flatRoutes.length - 1)
      : 0;

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      inputRef.current?.focus();
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, []);

  const handleQueryChange = (value: string) => {
    setQuery(value);
    setSelectedIndex(0);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }

    if (flatRoutes.length === 0) {
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelectedIndex((currentValue) =>
        currentValue + 1 >= flatRoutes.length ? 0 : currentValue + 1
      );
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelectedIndex((currentValue) =>
        currentValue - 1 < 0 ? flatRoutes.length - 1 : currentValue - 1
      );
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      const route = flatRoutes[safeSelectedIndex];
      if (route) {
        onSelect(route);
      }
    }
  };

  return (
    <div className="command-overlay" role="dialog" aria-modal="true" onKeyDown={handleKeyDown}>
      <button
        className="command-backdrop"
        type="button"
        aria-label="Close command palette"
        onClick={onClose}
      />

      <section className="command-dialog">
        <label className="command-input-row" htmlFor="command-palette-input">
          <svg className="command-search-icon" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" strokeWidth="1.8" fill="none" />
            <path
              d="M15.3 15.3L20 20"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
          <input
            id="command-palette-input"
            ref={inputRef}
            className="command-input"
            value={query}
            onChange={(event) => handleQueryChange(event.currentTarget.value)}
            placeholder="Search routes, modules, and settings"
          />
        </label>

        <div className="command-list" role="listbox" aria-label="Command palette routes">
          {flatRoutes.length === 0 ? (
            <p className="command-empty">No matching routes found.</p>
          ) : (
            indexedSections.map((section) => (
              <section key={section.label} className="command-section">
                <p className="command-section-title">{section.label}</p>
                {section.items.map((route, routeIndex) => {
                  const absoluteIndex = section.startIndex + routeIndex;

                  return (
                    <button
                      key={`${section.label}-${route.href}`}
                      className={
                        absoluteIndex === safeSelectedIndex
                          ? "command-item command-item-selected"
                          : "command-item"
                      }
                      type="button"
                      role="option"
                      aria-selected={absoluteIndex === safeSelectedIndex}
                      onClick={() => onSelect(route)}
                    >
                      <span>
                        <strong>{route.label}</strong>
                        <small>{route.description}</small>
                      </span>
                      <span className="command-item-meta">
                        <code>{route.href}</code>
                        <kbd>{route.shortcut}</kbd>
                      </span>
                    </button>
                  );
                })}
              </section>
            ))
          )}
        </div>

        <footer className="command-footer">
          <span>Up/Down to navigate</span>
          <span>Enter to open</span>
          <span>Esc to close</span>
          <span>Cmd/Ctrl + K</span>
        </footer>
      </section>
    </div>
  );
}
