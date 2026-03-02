"use client";

import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";

import {
  defaultNavVisibilityForRoles,
  isSuperAdmin
} from "../../lib/access-control";
import {
  NAV_GROUPS,
  ROUTE_ITEMS,
  type NavGroup,
  type NavItem,
  type UserRole
} from "../../lib/navigation";
import type { MeAccessConfigResponse } from "../../types/access-control";
import { CommandPalette } from "./command-palette";
import { NotificationCenter } from "./notification-center";
import { ThemeToggle } from "./theme-toggle";

const RECENT_ROUTE_STORAGE_KEY = "crew-hub-recent-routes";
const RECENT_ROUTE_LIMIT = 6;

function readRecentRoutes(): string[] {
  if (typeof window === "undefined") {
    return [];
  }

  const storedValue = window.localStorage.getItem(RECENT_ROUTE_STORAGE_KEY);
  if (!storedValue) {
    return [];
  }

  try {
    const parsedValue: unknown = JSON.parse(storedValue);
    if (!Array.isArray(parsedValue)) {
      return [];
    }

    return parsedValue.filter(
      (item): item is string => typeof item === "string"
    );
  } catch {
    return [];
  }
}

function writeRecentRoutes(routes: string[]): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(RECENT_ROUTE_STORAGE_KEY, JSON.stringify(routes));
}

function updateRecentRoutes(pathname: string, previousRoutes: string[]): string[] {
  return [pathname, ...previousRoutes.filter((route) => route !== pathname)].slice(
    0,
    RECENT_ROUTE_LIMIT
  );
}

function isRouteActive(currentPathname: string, href: string): boolean {
  return currentPathname === href || currentPathname.startsWith(`${href}/`);
}

function resolveTopbarRoute(pathname: string, routes: NavItem[]): NavItem | undefined {
  const sortedRoutes = [...routes].sort(
    (leftRoute, rightRoute) => rightRoute.href.length - leftRoute.href.length
  );

  return sortedRoutes.find((route) => isRouteActive(pathname, route.href));
}

function getSidebarGroupId(groupLabel: string): string {
  const normalizedLabel = groupLabel
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

  return `sidebar-group-${normalizedLabel}`;
}

function getDefaultMobileExpandedGroups(
  groups: readonly NavGroup[],
  pathname: string
): string[] {
  const activeGroups = groups
    .filter((group) =>
      group.items.some((item) => isRouteActive(pathname, item.href))
    )
    .map((group) => group.label);

  if (activeGroups.length > 0) {
    return activeGroups;
  }

  return groups.length > 0 ? [groups[0].label] : [];
}

function subscribeToMobileViewport(
  onViewportChange: () => void
): () => void {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  const mediaQueryList = window.matchMedia("(max-width: 767px)");
  const handleViewportChange = () => {
    onViewportChange();
  };

  mediaQueryList.addEventListener("change", handleViewportChange);

  return () => {
    mediaQueryList.removeEventListener("change", handleViewportChange);
  };
}

function getMobileViewportSnapshot(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  return window.matchMedia("(max-width: 767px)").matches;
}

async function fetchMyAccessConfig() {
  const response = await fetch("/api/v1/me/access-config", {
    method: "GET"
  });
  const payload = (await response.json()) as MeAccessConfigResponse;

  if (!response.ok || !payload.data) {
    throw new Error(payload.error?.message ?? "Unable to load access configuration.");
  }

  return payload.data;
}

type AppShellProps = {
  currentUserRoles: readonly UserRole[];
  children: ReactNode;
};

function AppShellContent({ currentUserRoles, children }: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();

  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [sidebarGroupOverrides, setSidebarGroupOverrides] = useState<
    Record<string, boolean>
  >({});
  const [recentRouteHrefs, setRecentRouteHrefs] = useState<string[]>(readRecentRoutes);

  const isMobileViewport = useSyncExternalStore(
    subscribeToMobileViewport,
    getMobileViewportSnapshot,
    () => false
  );

  const accessConfigQuery = useQuery({
    queryKey: ["me-access-config"],
    queryFn: fetchMyAccessConfig,
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    retry: 1
  });

  const fallbackAllowedRouteKeys = useMemo(
    () => new Set(defaultNavVisibilityForRoles(currentUserRoles)),
    [currentUserRoles]
  );

  const allowedRouteKeys = useMemo(() => {
    if (isSuperAdmin(currentUserRoles)) {
      return new Set(ROUTE_ITEMS.map((route) => route.href));
    }

    if (accessConfigQuery.data?.configExists) {
      return new Set(accessConfigQuery.data.allowedNavItemKeys);
    }

    return fallbackAllowedRouteKeys;
  }, [accessConfigQuery.data, currentUserRoles, fallbackAllowedRouteKeys]);

  const navigationGroups = useMemo(() => {
    return NAV_GROUPS.map((group) => ({
      ...group,
      items: group.items.filter((item) => allowedRouteKeys.has(item.href))
    })).filter((group) => group.items.length > 0);
  }, [allowedRouteKeys]);

  const commandRoutes = useMemo(
    () => ROUTE_ITEMS.filter((route) => allowedRouteKeys.has(route.href)),
    [allowedRouteKeys]
  );

  const activePathname = pathname ?? "/dashboard";

  const activeRoute = useMemo(
    () => resolveTopbarRoute(activePathname, commandRoutes),
    [activePathname, commandRoutes]
  );

  const defaultExpandedGroupLabels = useMemo(() => {
    if (!isMobileViewport) {
      return [];
    }

    return getDefaultMobileExpandedGroups(navigationGroups, activePathname);
  }, [activePathname, isMobileViewport, navigationGroups]);

  const expandedGroupLabels = useMemo(() => {
    const defaultExpandedSet = new Set(defaultExpandedGroupLabels);

    return navigationGroups
      .map((group) => group.label)
      .filter((groupLabel) => {
        const overrideValue = sidebarGroupOverrides[groupLabel];

        if (typeof overrideValue === "boolean") {
          return overrideValue;
        }

        return defaultExpandedSet.has(groupLabel);
      });
  }, [defaultExpandedGroupLabels, navigationGroups, sidebarGroupOverrides]);

  useEffect(() => {
    const handleCommandShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setIsCommandPaletteOpen((currentValue) => !currentValue);
      }
    };

    window.addEventListener("keydown", handleCommandShortcut);
    return () => {
      window.removeEventListener("keydown", handleCommandShortcut);
    };
  }, []);

  const registerRouteVisit = (href: string) => {
    setRecentRouteHrefs((previousRoutes) => {
      const nextRoutes = updateRecentRoutes(href, previousRoutes);
      writeRecentRoutes(nextRoutes);
      return nextRoutes;
    });
  };

  const handleSidebarItemClick = (href: string) => {
    registerRouteVisit(href);
    setIsMobileSidebarOpen(false);
    setIsCommandPaletteOpen(false);
  };

  const handleSidebarGroupToggle = (groupLabel: string) => {
    setSidebarGroupOverrides((currentOverrides) => {
      const hasOverride = Object.prototype.hasOwnProperty.call(
        currentOverrides,
        groupLabel
      );
      const defaultExpanded = defaultExpandedGroupLabels.includes(groupLabel);
      const currentlyExpanded = hasOverride
        ? currentOverrides[groupLabel]
        : defaultExpanded;
      const nextExpanded = !currentlyExpanded;

      if (nextExpanded === defaultExpanded) {
        const remainingOverrides = { ...currentOverrides };
        delete remainingOverrides[groupLabel];
        return remainingOverrides;
      }

      return {
        ...currentOverrides,
        [groupLabel]: nextExpanded
      };
    });
  };

  const handleCommandSelect = (route: NavItem) => {
    registerRouteVisit(route.href);
    router.push(route.href);
    setIsCommandPaletteOpen(false);
    setIsMobileSidebarOpen(false);
  };

  return (
    <div className="app-shell">
      <aside
        className={[
          "sidebar",
          isSidebarCollapsed ? "sidebar-collapsed" : "",
          isMobileSidebarOpen ? "sidebar-mobile-open" : ""
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <div className="sidebar-header">
          <Link
            href="/dashboard"
            className="sidebar-brand"
            aria-label="Crew Hub dashboard"
            onClick={() => handleSidebarItemClick("/dashboard")}
          >
            <span className="sidebar-brand-icon" aria-hidden="true">
              <Image
                src="/brand/crew-hub-app-logo.svg"
                alt=""
                width={30}
                height={30}
                className="sidebar-brand-image sidebar-brand-image-light"
                priority
              />
              <Image
                src="/brand/crew-hub-site-logo.svg"
                alt=""
                width={30}
                height={30}
                className="sidebar-brand-image sidebar-brand-image-dark"
                priority
              />
            </span>
            <span className="sidebar-brand-copy">Crew Hub</span>
          </Link>

          <button
            type="button"
            className="icon-button desktop-only"
            onClick={() => setIsSidebarCollapsed((currentValue) => !currentValue)}
            aria-label={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                d={isSidebarCollapsed ? "M9 5l7 7-7 7" : "M15 5l-7 7 7 7"}
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            </svg>
          </button>
        </div>

        <nav className="sidebar-nav" aria-label="Primary">
          {navigationGroups.map((group) => {
            const groupId = getSidebarGroupId(group.label);
            const isGroupExpanded = expandedGroupLabels.includes(group.label);

            return (
              <section key={group.label} className="sidebar-group">
                <h2 className="sidebar-group-heading">
                  <button
                    type="button"
                    className="sidebar-group-trigger"
                    onClick={() => handleSidebarGroupToggle(group.label)}
                    aria-expanded={isGroupExpanded}
                    aria-controls={groupId}
                  >
                    <span className="sidebar-group-title">{group.label}</span>
                    <span
                      className={
                        isGroupExpanded
                          ? "sidebar-group-chevron"
                          : "sidebar-group-chevron sidebar-group-chevron-collapsed"
                      }
                      aria-hidden="true"
                    >
                      <svg viewBox="0 0 20 20">
                        <path
                          d="M5.5 7.5 10 12l4.5-4.5"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          fill="none"
                        />
                      </svg>
                    </span>
                  </button>
                </h2>
                <ul
                  id={groupId}
                  className={
                    isGroupExpanded
                      ? "sidebar-links"
                      : "sidebar-links sidebar-links-collapsed"
                  }
                >
                  {group.items.map((item) => (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        className={
                          isRouteActive(activePathname, item.href)
                            ? "sidebar-link sidebar-link-active"
                            : "sidebar-link"
                        }
                        onClick={() => handleSidebarItemClick(item.href)}
                      >
                        <span className="sidebar-link-dot" aria-hidden="true" />
                        <span className="sidebar-link-text">{item.label}</span>
                        <span className="sidebar-shortcut numeric">{item.shortcut}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </nav>
      </aside>

      <div
        className={isSidebarCollapsed ? "shell-main shell-main-collapsed" : "shell-main"}
      >
        <header className="topbar">
          <div className="topbar-leading">
            <button
              type="button"
              className="icon-button mobile-only"
              onClick={() => setIsMobileSidebarOpen(true)}
              aria-label="Open navigation"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d="M4 7h16M4 12h16M4 17h16"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </svg>
            </button>

            <div>
              <p className="topbar-title">{activeRoute?.label ?? "Crew Hub"}</p>
              <p className="topbar-subtitle">{activeRoute?.description ?? "Crew Hub workspace"}</p>
            </div>
          </div>

          <div className="topbar-actions">
            <button
              type="button"
              className="command-trigger"
              onClick={() => setIsCommandPaletteOpen(true)}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" strokeWidth="1.8" fill="none" />
                <path
                  d="M15.3 15.3L20 20"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </svg>
              <span>Search</span>
              <kbd>Cmd/Ctrl + K</kbd>
            </button>
            <NotificationCenter />
            <ThemeToggle />
          </div>
        </header>

        <main className="page-content">{children}</main>
      </div>

      {isMobileSidebarOpen ? (
        <button
          type="button"
          className="sidebar-scrim mobile-only"
          onClick={() => setIsMobileSidebarOpen(false)}
          aria-label="Close navigation"
        />
      ) : null}

      {isCommandPaletteOpen ? (
        <CommandPalette
          routes={commandRoutes}
          recentRouteHrefs={recentRouteHrefs}
          onClose={() => setIsCommandPaletteOpen(false)}
          onSelect={handleCommandSelect}
        />
      ) : null}
    </div>
  );
}

export function AppShell({ currentUserRoles, children }: AppShellProps) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 5 * 60 * 1000,
            gcTime: 15 * 60 * 1000
          }
        }
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      <AppShellContent currentUserRoles={currentUserRoles}>{children}</AppShellContent>
    </QueryClientProvider>
  );
}
