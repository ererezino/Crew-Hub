"use client";

import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode
} from "react";

import { defaultNavVisibilityForRoles, isSuperAdmin } from "../../lib/access-control";
import { hasAnyRole, hasRole } from "../../lib/roles";
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
const SIDEBAR_COLLAPSED_STORAGE_KEY = "crew-hub-sidebar-collapsed";
const SIDEBAR_GROUP_STORAGE_KEY = "crew-hub-sidebar-groups";
const RECENT_ROUTE_LIMIT = 6;
const APPROVAL_GROUP_ROLES: readonly UserRole[] = [
  "MANAGER",
  "TEAM_LEAD",
  "HR_ADMIN",
  "FINANCE_ADMIN",
  "SUPER_ADMIN"
];

type SidebarApprovalCounts = {
  timeOff: number;
  expenses: number;
  timesheets: number;
  total: number;
};

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

    return parsedValue.filter((item): item is string => typeof item === "string");
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

function readSidebarCollapsed(): boolean {
  if (typeof window === "undefined") {
    return true;
  }

  const storedValue = window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY);

  if (!storedValue) {
    return true;
  }

  return storedValue === "1";
}

function writeSidebarCollapsed(value: boolean): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, value ? "1" : "0");
}

function readSidebarGroupState(): Record<string, boolean> {
  if (typeof window === "undefined") {
    return {};
  }

  const storedValue = window.localStorage.getItem(SIDEBAR_GROUP_STORAGE_KEY);
  if (!storedValue) {
    return {};
  }

  try {
    const parsedValue: unknown = JSON.parse(storedValue);

    if (!parsedValue || typeof parsedValue !== "object" || Array.isArray(parsedValue)) {
      return {};
    }

    const state: Record<string, boolean> = {};

    for (const [key, value] of Object.entries(parsedValue)) {
      if (typeof value === "boolean") {
        state[key] = value;
      }
    }

    return state;
  } catch {
    return {};
  }
}

function writeSidebarGroupState(value: Record<string, boolean>): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(SIDEBAR_GROUP_STORAGE_KEY, JSON.stringify(value));
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

function normalizeKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function getSidebarGroupStorageKey(group: NavGroup, index: number): string {
  const fromLabel = normalizeKey(group.label);

  if (fromLabel.length > 0) {
    return `sidebar-group-${fromLabel}`;
  }

  const firstHref = group.items[0]?.href ?? `group-${index + 1}`;
  return `sidebar-group-${normalizeKey(firstHref)}`;
}

function getSidebarGroupId(group: NavGroup, index: number): string {
  const base = group.label || group.items[0]?.label || `group-${index + 1}`;
  return `sidebar-group-${normalizeKey(base)}`;
}

function getDefaultMobileExpandedGroups(
  groups: readonly { group: NavGroup; key: string }[],
  pathname: string
): Set<string> {
  const activeGroups = groups
    .filter(({ group }) => group.items.some((item) => isRouteActive(pathname, item.href)))
    .map(({ key }) => key);

  if (activeGroups.length > 0) {
    return new Set(activeGroups);
  }

  if (groups.length > 0) {
    return new Set([groups[0].key]);
  }

  return new Set();
}

function subscribeToMobileViewport(onViewportChange: () => void): () => void {
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

function getInitials(fullName: string): string {
  const tokens = fullName
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (tokens.length === 0) {
    return "CH";
  }

  if (tokens.length === 1) {
    return tokens[0].slice(0, 2).toUpperCase();
  }

  return `${tokens[0][0] ?? ""}${tokens[1][0] ?? ""}`.toUpperCase();
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

async function fetchJsonSafely<T>(url: string): Promise<T | null> {
  try {
    const response = await fetch(url, { method: "GET" });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as { data?: T | null };
    return payload.data ?? null;
  } catch {
    return null;
  }
}

async function fetchSidebarApprovalCounts(
  currentUserRoles: readonly UserRole[]
): Promise<SidebarApprovalCounts> {
  const canViewTimeOff =
    hasRole(currentUserRoles, "MANAGER") ||
    hasRole(currentUserRoles, "HR_ADMIN") ||
    hasRole(currentUserRoles, "SUPER_ADMIN");
  const canViewManagerExpenses =
    hasRole(currentUserRoles, "MANAGER") || hasRole(currentUserRoles, "SUPER_ADMIN");
  const canViewFinanceExpenses =
    hasRole(currentUserRoles, "FINANCE_ADMIN") || hasRole(currentUserRoles, "SUPER_ADMIN");
  const canViewTimesheets = hasAnyRole(currentUserRoles, APPROVAL_GROUP_ROLES);

  const [timeOffData, managerExpensesData, financeExpensesData, timesheetsData] =
    await Promise.all([
      canViewTimeOff
        ? fetchJsonSafely<{ requests: unknown[] }>("/api/v1/time-off/approvals?status=pending")
        : Promise.resolve(null),
      canViewManagerExpenses
        ? fetchJsonSafely<{ expenses: unknown[] }>(
            "/api/v1/expenses/approvals?stage=manager"
          )
        : Promise.resolve(null),
      canViewFinanceExpenses
        ? fetchJsonSafely<{ expenses: unknown[] }>(
            "/api/v1/expenses/approvals?stage=finance"
          )
        : Promise.resolve(null),
      canViewTimesheets
        ? fetchJsonSafely<{ timesheets: unknown[] }>(
            "/api/v1/time-attendance/approvals?status=submitted"
          )
        : Promise.resolve(null)
    ]);

  const timeOff = Array.isArray(timeOffData?.requests) ? timeOffData.requests.length : 0;
  const managerExpenses = Array.isArray(managerExpensesData?.expenses)
    ? managerExpensesData.expenses.length
    : 0;
  const financeExpenses = Array.isArray(financeExpensesData?.expenses)
    ? financeExpensesData.expenses.length
    : 0;
  const expenses = managerExpenses + financeExpenses;
  const timesheets = Array.isArray(timesheetsData?.timesheets)
    ? timesheetsData.timesheets.length
    : 0;

  return {
    timeOff,
    expenses,
    timesheets,
    total: timeOff + expenses + timesheets
  };
}

type AppShellProps = {
  currentUserRoles: readonly UserRole[];
  currentUserProfile: {
    fullName: string;
    email: string;
    avatarUrl: string | null;
  } | null;
  children: ReactNode;
};

function AppShellContent({ currentUserRoles, currentUserProfile, children }: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();

  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(readSidebarCollapsed);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [sidebarGroupState, setSidebarGroupState] = useState<Record<string, boolean>>(
    readSidebarGroupState
  );
  const [recentRouteHrefs, setRecentRouteHrefs] = useState<string[]>(readRecentRoutes);

  const isMobileViewport = useSyncExternalStore(
    subscribeToMobileViewport,
    getMobileViewportSnapshot,
    () => false
  );

  useEffect(() => {
    writeSidebarCollapsed(isSidebarCollapsed);
  }, [isSidebarCollapsed]);

  useEffect(() => {
    writeSidebarGroupState(sidebarGroupState);
  }, [sidebarGroupState]);

  const accessConfigQuery = useQuery({
    queryKey: ["me-access-config"],
    queryFn: fetchMyAccessConfig,
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    retry: 1
  });

  const approvalsCountQuery = useQuery({
    queryKey: ["sidebar-approvals-count", currentUserRoles.join("|")],
    queryFn: () => fetchSidebarApprovalCounts(currentUserRoles),
    staleTime: 30 * 1000,
    gcTime: 2 * 60 * 1000,
    retry: 1,
    enabled: hasAnyRole(currentUserRoles, APPROVAL_GROUP_ROLES)
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
    return NAV_GROUPS.filter((group) => {
      if (!group.requiredRoles || group.requiredRoles.length === 0) {
        return true;
      }

      return hasAnyRole(currentUserRoles, group.requiredRoles);
    })
      .map((group) => ({
        ...group,
        items: group.items.filter(
          (item) => item.href !== "/settings" && allowedRouteKeys.has(item.href)
        )
      }))
      .filter((group) => group.items.length > 0)
      .map((group, index) => ({
        group,
        key: getSidebarGroupStorageKey(group, index),
        domId: getSidebarGroupId(group, index)
      }));
  }, [allowedRouteKeys, currentUserRoles]);

  const commandRoutes = useMemo(
    () => ROUTE_ITEMS.filter((route) => allowedRouteKeys.has(route.href)),
    [allowedRouteKeys]
  );

  const activePathname = pathname ?? "/dashboard";

  const activeRoute = useMemo(
    () => resolveTopbarRoute(activePathname, commandRoutes),
    [activePathname, commandRoutes]
  );

  const defaultExpandedGroupKeys = useMemo(() => {
    if (isMobileViewport) {
      return getDefaultMobileExpandedGroups(navigationGroups, activePathname);
    }

    return new Set(
      navigationGroups
        .filter(({ group }) => group.label !== "Admin")
        .map(({ key }) => key)
    );
  }, [activePathname, isMobileViewport, navigationGroups]);

  const expandedGroupKeys = useMemo(() => {
    return new Set(
      navigationGroups
        .filter(({ group, key }) => {
          if (group.label.length === 0) {
            return true;
          }

          const override = sidebarGroupState[key];

          if (typeof override === "boolean") {
            return override;
          }

          return defaultExpandedGroupKeys.has(key);
        })
        .map(({ key }) => key)
    );
  }, [defaultExpandedGroupKeys, navigationGroups, sidebarGroupState]);

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

  const handleSidebarGroupToggle = (groupKey: string, defaultExpanded: boolean) => {
    setSidebarGroupState((currentState) => ({
      ...currentState,
      [groupKey]: !(currentState[groupKey] ?? defaultExpanded)
    }));
  };

  const handleCommandSelect = (route: NavItem) => {
    registerRouteVisit(route.href);
    router.push(route.href);
    setIsCommandPaletteOpen(false);
    setIsMobileSidebarOpen(false);
  };

  const settingsAllowed =
    isSuperAdmin(currentUserRoles) || allowedRouteKeys.has("/settings");

  const sidebarProfileInitials = currentUserProfile
    ? getInitials(currentUserProfile.fullName)
    : "CH";

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
          {navigationGroups.map(({ group, key, domId }) => {
            const defaultExpanded = defaultExpandedGroupKeys.has(key);
            const isGroupExpanded = expandedGroupKeys.has(key);
            const hasHeading = group.label.length > 0;

            return (
              <section key={key} className="sidebar-group">
                {hasHeading ? (
                  <h2 className="sidebar-group-heading">
                    <button
                      type="button"
                      className="sidebar-group-trigger"
                      onClick={() => handleSidebarGroupToggle(key, defaultExpanded)}
                      aria-expanded={isGroupExpanded}
                      aria-controls={domId}
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
                ) : null}

                <ul
                  id={domId}
                  className={
                    isGroupExpanded
                      ? "sidebar-links"
                      : "sidebar-links sidebar-links-collapsed"
                  }
                >
                  {group.items.map((item) => {
                    const isActive = isRouteActive(activePathname, item.href);
                    const showApprovalsBadge =
                      item.href === "/approvals" &&
                      (approvalsCountQuery.data?.total ?? 0) > 0;

                    return (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          className={isActive ? "sidebar-link sidebar-link-active" : "sidebar-link"}
                          onClick={() => handleSidebarItemClick(item.href)}
                        >
                          <span className="sidebar-link-indicator" aria-hidden="true" />
                          <span className="sidebar-link-dot" aria-hidden="true" />
                          <span className="sidebar-link-text">{item.label}</span>
                          {showApprovalsBadge ? (
                            <span className="sidebar-link-badge numeric" aria-label="Pending approvals">
                              {approvalsCountQuery.data?.total ?? 0}
                            </span>
                          ) : null}
                          <span className="sidebar-shortcut numeric">{item.shortcut}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </nav>

        <div className="sidebar-bottom">
          {settingsAllowed ? (
            <Link
              href="/settings"
              className={
                isRouteActive(activePathname, "/settings")
                  ? "sidebar-link sidebar-link-active sidebar-link-pinned"
                  : "sidebar-link sidebar-link-pinned"
              }
              onClick={() => handleSidebarItemClick("/settings")}
            >
              <span className="sidebar-link-indicator" aria-hidden="true" />
              <span className="sidebar-link-dot" aria-hidden="true" />
              <span className="sidebar-link-text">Settings</span>
              <span className="sidebar-shortcut numeric">A S</span>
            </Link>
          ) : null}

          {settingsAllowed && currentUserProfile ? (
            <Link
              href="/settings?tab=profile"
              className="sidebar-profile-link"
              onClick={() => handleSidebarItemClick("/settings")}
            >
              <span className="sidebar-profile-avatar numeric" aria-hidden="true">
                {sidebarProfileInitials}
              </span>
              <span className="sidebar-profile-copy">
                <span className="sidebar-profile-name">{currentUserProfile.fullName}</span>
                <span className="sidebar-profile-email">{currentUserProfile.email}</span>
              </span>
            </Link>
          ) : null}
        </div>
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
              <p className="topbar-subtitle">
                {activeRoute?.description ?? "Crew Hub workspace"}
              </p>
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

export function AppShell({ currentUserRoles, currentUserProfile, children }: AppShellProps) {
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
      <AppShellContent currentUserRoles={currentUserRoles} currentUserProfile={currentUserProfile}>
        {children}
      </AppShellContent>
    </QueryClientProvider>
  );
}
