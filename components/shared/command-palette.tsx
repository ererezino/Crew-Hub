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

type CommandPaletteProps = {
  routes: NavItem[];
  recentRouteHrefs: string[];
  onClose: () => void;
  onSelect: (route: NavItem) => void;
};

type EntityResult = {
  id: string;
  label: string;
  description: string;
  href: string;
  kind: "person" | "document";
};

type CommandItem = {
  key: string;
  label: string;
  description: string;
  href: string;
  shortcut?: string;
  kind: "route" | "person" | "document";
};

type CommandSection = {
  label: string;
  items: CommandItem[];
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

function routeToCommandItem(route: NavItem): CommandItem {
  return {
    key: `route-${route.href}`,
    label: route.label,
    description: route.description,
    href: route.href,
    shortcut: route.shortcut,
    kind: "route"
  };
}

function entityToCommandItem(entity: EntityResult): CommandItem {
  return {
    key: `${entity.kind}-${entity.id}`,
    label: entity.label,
    description: entity.description,
    href: entity.href,
    kind: entity.kind
  };
}

const ENTITY_SEARCH_MIN_LENGTH = 2;
const ENTITY_SEARCH_DEBOUNCE_MS = 300;

export function CommandPalette({
  routes,
  recentRouteHrefs,
  onClose,
  onSelect
}: CommandPaletteProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [entityResults, setEntityResults] = useState<EntityResult[]>([]);
  const [isSearchingEntities, setIsSearchingEntities] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

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

  // Entity search with debounce
  const searchEntities = useCallback(async (searchQuery: string) => {
    if (abortRef.current) {
      abortRef.current.abort();
    }

    const trimmed = searchQuery.trim();

    if (trimmed.length < ENTITY_SEARCH_MIN_LENGTH) {
      setEntityResults([]);
      setIsSearchingEntities(false);
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setIsSearchingEntities(true);

    try {
      const [peopleRes, docsRes] = await Promise.all([
        fetch(`/api/v1/people?scope=all&limit=5&search=${encodeURIComponent(trimmed)}`, {
          signal: controller.signal
        }).catch(() => null),
        fetch(`/api/v1/documents?scope=all&limit=5`, {
          signal: controller.signal
        }).catch(() => null)
      ]);

      if (controller.signal.aborted) return;

      const results: EntityResult[] = [];

      if (peopleRes?.ok) {
        const payload = (await peopleRes.json()) as {
          data?: { people?: Array<{ id: string; fullName: string; department: string | null; title: string | null }> };
        };

        if (payload.data?.people) {
          for (const person of payload.data.people) {
            results.push({
              id: person.id,
              label: person.fullName,
              description: [person.title, person.department].filter(Boolean).join(" - ") || "Team member",
              href: `/people/${person.id}`,
              kind: "person"
            });
          }
        }
      }

      if (docsRes?.ok) {
        const payload = (await docsRes.json()) as {
          data?: { documents?: Array<{ id: string; title: string; category: string; ownerName: string }> };
        };

        if (payload.data?.documents) {
          const normalizedSearch = normalize(trimmed);

          const matchingDocs = payload.data.documents.filter((doc) =>
            normalize(doc.title).includes(normalizedSearch) ||
            normalize(doc.category).includes(normalizedSearch)
          );

          for (const doc of matchingDocs.slice(0, 5)) {
            results.push({
              id: doc.id,
              label: doc.title,
              description: `${doc.category} - ${doc.ownerName}`,
              href: `/documents`,
              kind: "document"
            });
          }
        }
      }

      if (!controller.signal.aborted) {
        setEntityResults(results);
      }
    } catch {
      // Ignore abort errors
    } finally {
      if (!controller.signal.aborted) {
        setIsSearchingEntities(false);
      }
    }
  }, []);

  useEffect(() => {
    const trimmed = query.trim();

    if (trimmed.length < ENTITY_SEARCH_MIN_LENGTH) {
      setEntityResults([]);
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void searchEntities(trimmed);
    }, ENTITY_SEARCH_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [query, searchEntities]);

  useEffect(() => {
    return () => {
      if (abortRef.current) {
        abortRef.current.abort();
      }
    };
  }, []);

  const sections = useMemo<CommandSection[]>(() => {
    const normalizedQuery = normalize(query);

    if (normalizedQuery) {
      const routeItems = filteredRoutes.map(routeToCommandItem);
      const entityItems = entityResults.map(entityToCommandItem);

      const result: CommandSection[] = [];

      if (entityItems.length > 0) {
        const people = entityItems.filter((item) => item.kind === "person");
        const docs = entityItems.filter((item) => item.kind === "document");

        if (people.length > 0) {
          result.push({ label: "People", items: people });
        }

        if (docs.length > 0) {
          result.push({ label: "Documents", items: docs });
        }
      }

      if (routeItems.length > 0) {
        result.push({ label: "Pages", items: routeItems });
      }

      return result;
    }

    return [
      { label: "Recently visited", items: recentRoutes.map(routeToCommandItem) },
      {
        label: "All routes",
        items: dedupeRoutes([...recentRoutes, ...filteredRoutes]).map(routeToCommandItem)
      }
    ];
  }, [filteredRoutes, query, recentRoutes, entityResults]);

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

  const flatItems = useMemo(
    () => indexedSections.flatMap((section) => section.items),
    [indexedSections]
  );

  const safeSelectedIndex =
    flatItems.length > 0
      ? Math.min(selectedIndex, flatItems.length - 1)
      : 0;

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

  const handleQueryChange = (value: string) => {
    setQuery(value);
    setSelectedIndex(0);
  };

  const handleItemSelect = (item: CommandItem) => {
    const matchedRoute = routeMap.get(item.href);

    if (matchedRoute) {
      onSelect(matchedRoute);
    } else {
      // For entity results, create a synthetic NavItem
      onSelect({
        label: item.label,
        href: item.href,
        icon: item.kind === "person" ? "user" : "file",
        description: item.description,
        shortcut: ""
      });
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

  const kindIcon = (kind: CommandItem["kind"]) => {
    if (kind === "person") return "👤";
    if (kind === "document") return "📄";
    return null;
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
            placeholder="Search pages, people, and documents..."
          />
          {isSearchingEntities ? (
            <span className="command-loading-indicator" aria-label="Searching">...</span>
          ) : null}
        </label>

        <div className="command-list" role="listbox" aria-label="Command palette results">
          {flatItems.length === 0 ? (
            <p className="command-empty">
              {isSearchingEntities ? "Searching..." : "No results found."}
            </p>
          ) : (
            indexedSections.map((section) => (
              <section key={section.label} className="command-section">
                <p className="command-section-title">{section.label}</p>
                {section.items.map((item, itemIndex) => {
                  const absoluteIndex = section.startIndex + itemIndex;
                  const icon = kindIcon(item.kind);

                  return (
                    <button
                      key={item.key}
                      className={
                        absoluteIndex === safeSelectedIndex
                          ? "command-item command-item-selected"
                          : "command-item"
                      }
                      type="button"
                      role="option"
                      aria-selected={absoluteIndex === safeSelectedIndex}
                      onClick={() => handleItemSelect(item)}
                    >
                      <span>
                        <strong>
                          {icon ? <span className="command-item-icon">{icon} </span> : null}
                          {item.label}
                        </strong>
                        <small>{item.description}</small>
                      </span>
                      <span className="command-item-meta">
                        {item.kind === "route" ? (
                          <>
                            <code>{item.href}</code>
                            {item.shortcut ? <kbd>{item.shortcut}</kbd> : null}
                          </>
                        ) : (
                          <code>{item.href}</code>
                        )}
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
