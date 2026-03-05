"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent
} from "react";

import type { NavItem } from "../../lib/navigation";

type SearchResult = {
  id: string;
  type: "person" | "document" | "policy" | "expense" | "leave";
  title: string;
  subtitle: string;
  url: string;
};

type CommandPaletteProps = {
  routes: NavItem[];
  recentRouteHrefs: string[];
  onClose: () => void;
  onSelect: (route: NavItem) => void;
  onNavigate?: (url: string) => void;
};

type CommandSection = {
  label: string;
  items: NavItem[];
};

type EntitySection = {
  label: string;
  type: string;
  items: SearchResult[];
};

type IndexedSection = CommandSection & {
  startIndex: number;
};

type FlatItem =
  | { kind: "route"; route: NavItem }
  | { kind: "entity"; result: SearchResult };

const ENTITY_TYPE_LABELS: Record<string, string> = {
  person: "People",
  document: "Documents",
  policy: "Policies",
  expense: "Expenses",
  leave: "Time Off"
};

const ENTITY_SEARCH_DEBOUNCE_MS = 250;
const MIN_ENTITY_QUERY_LENGTH = 2;

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

function groupEntityResults(results: SearchResult[]): EntitySection[] {
  const groups = new Map<string, SearchResult[]>();

  for (const result of results) {
    const existing = groups.get(result.type);
    if (existing) {
      existing.push(result);
    } else {
      groups.set(result.type, [result]);
    }
  }

  const sections: EntitySection[] = [];

  for (const [type, items] of groups) {
    sections.push({
      label: ENTITY_TYPE_LABELS[type] || type,
      type,
      items
    });
  }

  return sections;
}

export function CommandPalette({
  routes,
  recentRouteHrefs,
  onClose,
  onSelect,
  onNavigate
}: CommandPaletteProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [entityResults, setEntityResults] = useState<SearchResult[]>([]);
  const [entityLoading, setEntityLoading] = useState(false);

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
      return [{ label: "Routes", items: filteredRoutes }];
    }

    return [
      { label: "Recently visited", items: recentRoutes },
      {
        label: "All routes",
        items: dedupeRoutes([...recentRoutes, ...filteredRoutes])
      }
    ];
  }, [filteredRoutes, query, recentRoutes]);

  const entitySections = useMemo(
    () => groupEntityResults(entityResults),
    [entityResults]
  );

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

  const routeCount = useMemo(
    () => indexedSections.reduce((total, section) => total + section.items.length, 0),
    [indexedSections]
  );

  const flatItems = useMemo<FlatItem[]>(() => {
    const items: FlatItem[] = [];

    for (const section of indexedSections) {
      for (const route of section.items) {
        items.push({ kind: "route", route });
      }
    }

    for (const section of entitySections) {
      for (const result of section.items) {
        items.push({ kind: "entity", result });
      }
    }

    return items;
  }, [indexedSections, entitySections]);

  const safeSelectedIndex =
    flatItems.length > 0
      ? Math.min(selectedIndex, flatItems.length - 1)
      : 0;

  // Entity search via API
  const fetchEntityResults = useCallback(async (searchQuery: string) => {
    if (searchQuery.trim().length < MIN_ENTITY_QUERY_LENGTH) {
      setEntityResults([]);
      return;
    }

    setEntityLoading(true);

    try {
      const response = await fetch(
        `/api/v1/search?q=${encodeURIComponent(searchQuery)}`
      );

      if (response.ok) {
        const json = (await response.json()) as {
          data?: { results?: SearchResult[] } | null;
        };
        setEntityResults(json.data?.results ?? []);
      } else {
        setEntityResults([]);
      }
    } catch {
      setEntityResults([]);
    } finally {
      setEntityLoading(false);
    }
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      inputRef.current?.focus();
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, []);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  const handleQueryChange = (value: string) => {
    setQuery(value);
    setSelectedIndex(0);

    // Debounced entity search
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    if (value.trim().length < MIN_ENTITY_QUERY_LENGTH) {
      setEntityResults([]);
      setEntityLoading(false);
    } else {
      debounceRef.current = setTimeout(() => {
        fetchEntityResults(value);
      }, ENTITY_SEARCH_DEBOUNCE_MS);
    }
  };

  const handleItemSelect = (item: FlatItem) => {
    if (item.kind === "route") {
      onSelect(item.route);
    } else if (onNavigate) {
      onNavigate(item.result.url);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }

    if (flatItems.length === 0) {
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelectedIndex((currentValue) =>
        currentValue + 1 >= flatItems.length ? 0 : currentValue + 1
      );
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelectedIndex((currentValue) =>
        currentValue - 1 < 0 ? flatItems.length - 1 : currentValue - 1
      );
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      const item = flatItems[safeSelectedIndex];
      if (item) {
        handleItemSelect(item);
      }
    }
  };

  const normalizedQuery = normalize(query);
  const showEntitySection =
    normalizedQuery.length >= MIN_ENTITY_QUERY_LENGTH &&
    (entityResults.length > 0 || entityLoading);

  // Build entity indexed sections for rendering
  let entityStartIndex = routeCount;

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
            placeholder="Search routes, people, documents, policies..."
          />
        </label>

        <div className="command-list" role="listbox" aria-label="Command palette results">
          {flatItems.length === 0 && !entityLoading ? (
            <p className="command-empty">
              {normalizedQuery.length >= MIN_ENTITY_QUERY_LENGTH
                ? "No matching results found."
                : "No matching routes found."}
            </p>
          ) : (
            <>
              {indexedSections.map((section) => (
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
              ))}

              {entityLoading && entityResults.length === 0 ? (
                <p className="command-entity-loading">Searching entities...</p>
              ) : null}

              {showEntitySection
                ? entitySections.map((entitySection) => {
                    const sectionStart = entityStartIndex;
                    entityStartIndex += entitySection.items.length;

                    return (
                      <section
                        key={`entity-${entitySection.type}`}
                        className="command-section"
                      >
                        <p className="command-section-title">
                          {entitySection.label}
                        </p>
                        {entitySection.items.map((result, resultIndex) => {
                          const absoluteIndex = sectionStart + resultIndex;

                          return (
                            <button
                              key={result.id}
                              className={
                                absoluteIndex === safeSelectedIndex
                                  ? "command-entity-item command-entity-item-selected"
                                  : "command-entity-item"
                              }
                              type="button"
                              role="option"
                              aria-selected={absoluteIndex === safeSelectedIndex}
                              onClick={() =>
                                onNavigate
                                  ? onNavigate(result.url)
                                  : undefined
                              }
                              onMouseEnter={() => setSelectedIndex(absoluteIndex)}
                            >
                              <span className="command-entity-item-badge">
                                {result.type}
                              </span>
                              <span className="command-entity-item-content">
                                <strong>{result.title}</strong>
                                <small>{result.subtitle}</small>
                              </span>
                            </button>
                          );
                        })}
                      </section>
                    );
                  })
                : null}
            </>
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
