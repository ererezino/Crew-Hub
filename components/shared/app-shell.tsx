"use client";

import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode
} from "react";

import { defaultNavVisibilityForRoles, isSuperAdmin } from "../../lib/access-control";
import { getModuleState, isModuleVisibleInNav } from "../../lib/feature-state";
import { FeatureBadge } from "./feature-badge";
import { hasAnyRole, hasRole } from "../../lib/roles";
import {
  NAV_GROUPS,
  ROUTE_ITEMS,
  type NavGroup,
  type NavItem,
  type UserRole
} from "../../lib/navigation";
import type { MeAccessConfigResponse } from "../../types/access-control";
import { useKeyboardShortcuts } from "../../hooks/use-keyboard-shortcuts";
import { AppErrorBoundary } from "./app-error-boundary";
import { CommandPalette } from "./command-palette";
import { KeyboardShortcutsModal } from "./keyboard-shortcuts-modal";
import { NavIcon } from "./nav-icon";
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

type AvailabilityStatus = "available" | "in_meeting" | "on_break" | "focusing" | "afk" | "ooo";

const STATUS_OPTIONS: { value: AvailabilityStatus; label: string; color: string }[] = [
  { value: "available", label: "Available", color: "#22C55E" },
  { value: "in_meeting", label: "In a meeting", color: "#EAB308" },
  { value: "on_break", label: "On a break", color: "#EAB308" },
  { value: "focusing", label: "Focusing", color: "#F97316" },
  { value: "afk", label: "AFK", color: "#94A3B8" },
  { value: "ooo", label: "Out of office", color: "#EF4444" },
];

type UserMenuProps = {
  profile: { fullName: string; email: string; avatarUrl: string | null } | null;
  initials: string;
  roles: readonly UserRole[];
};

function getRoleBadgeLabel(roles: readonly UserRole[]): string {
  if (hasRole(roles, "SUPER_ADMIN")) return "Super Admin";
  if (hasRole(roles, "HR_ADMIN") && hasRole(roles, "FINANCE_ADMIN")) return "HR & Finance Admin";
  if (hasRole(roles, "HR_ADMIN")) return "HR Admin";
  if (hasRole(roles, "FINANCE_ADMIN")) return "Finance Admin";
  if (hasRole(roles, "MANAGER")) return "Manager";
  if (hasRole(roles, "TEAM_LEAD")) return "Team Lead";
  return "Employee";
}

function UserMenu({ profile, initials, roles }: UserMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [isStatusPickerOpen, setIsStatusPickerOpen] = useState(false);
  const [currentStatus, setCurrentStatus] = useState<AvailabilityStatus>("available");
  const [statusNote, setStatusNote] = useState("");
  const menuRef = useRef<HTMLDivElement | null>(null);
  const statusRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
      if (statusRef.current && !statusRef.current.contains(event.target as Node)) {
        setIsStatusPickerOpen(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  const handleStatusChange = useCallback(async (status: AvailabilityStatus) => {
    setCurrentStatus(status);
    setIsStatusPickerOpen(false);
    try {
      await fetch("/api/v1/me/status", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, note: statusNote })
      });
    } catch {
      // Best effort
    }
  }, [statusNote]);

  const handleSignOut = useCallback(async () => {
    setIsSigningOut(true);
    try {
      await fetch("/api/auth/sign-out", { method: "POST" });
      window.location.href = "/login";
    } catch {
      setIsSigningOut(false);
    }
  }, []);

  const roleBadge = getRoleBadgeLabel(roles);

  return (
    <div className="user-menu" ref={menuRef} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
      <div ref={statusRef} style={{ position: "relative" }}>
        <button
          type="button"
          className="user-menu-trigger"
          onClick={() => setIsStatusPickerOpen((v) => !v)}
          aria-label="Change status"
        >
          <span className="user-menu-avatar numeric">{initials}</span>
          <span className={`status-dot status-dot-${currentStatus}`} />
        </button>

        {isStatusPickerOpen ? (
          <div className="status-picker">
            {STATUS_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={`status-picker-option${currentStatus === opt.value ? " status-picker-option-active" : ""}`}
                onClick={() => void handleStatusChange(opt.value)}
              >
                <span className="status-picker-option-dot" style={{ background: opt.color }} />
                {opt.label}
              </button>
            ))}
            {(currentStatus === "afk" || currentStatus === "ooo") ? (
              <input
                type="text"
                className="status-note-input"
                placeholder="Add a note (optional)"
                value={statusNote}
                onChange={(e) => setStatusNote(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    void handleStatusChange(currentStatus);
                  }
                }}
              />
            ) : null}
          </div>
        ) : null}
      </div>

      <button
        type="button"
        className="user-menu-trigger"
        onClick={() => setIsOpen((v) => !v)}
        aria-label="User menu"
        style={{ position: "relative" }}
      >
        <svg viewBox="0 0 24 24" style={{ width: "16px", height: "16px" }} aria-hidden="true">
          <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </svg>
      </button>

      {isOpen ? (
        <div className="user-menu-dropdown" role="menu">
          <div className="user-menu-profile">
            <span className="user-menu-avatar-lg numeric">{initials}</span>
            <div className="user-menu-profile-copy">
              <p className="user-menu-name">{profile?.fullName ?? "User"}</p>
              <p className="user-menu-email">{profile?.email ?? ""}</p>
              <span className="user-menu-role-badge">{roleBadge}</span>
            </div>
          </div>

          <div className="user-menu-divider" />

          <Link
            href="/settings?tab=profile"
            className="user-menu-item"
            onClick={() => setIsOpen(false)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" className="user-menu-item-icon">
              <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="1.6" fill="none" />
              <path d="M4 20c0-3.3 3.6-6 8-6s8 2.7 8 6" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" />
            </svg>
            My Profile
          </Link>

          <Link
            href="/settings"
            className="user-menu-item"
            onClick={() => setIsOpen(false)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" className="user-menu-item-icon">
              <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.6" fill="none" />
              <path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32l1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41m11.32-11.32l1.41-1.41" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
            Settings
          </Link>

          <div className="user-menu-divider" />

          <button
            type="button"
            className="user-menu-item user-menu-item-danger"
            onClick={() => void handleSignOut()}
            disabled={isSigningOut}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" className="user-menu-item-icon">
              <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
              <polyline points="16,17 21,12 16,7" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
              <line x1="21" y1="12" x2="9" y2="12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
            {isSigningOut ? "Signing out…" : "Sign out"}
          </button>
        </div>
      ) : null}
    </div>
  );
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

  useKeyboardShortcuts();

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
          (item) =>
            item.href !== "/settings" &&
            allowedRouteKeys.has(item.href) &&
            (!item.moduleId || isModuleVisibleInNav(item.moduleId))
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

  const handleCommandNavigate = (url: string) => {
    registerRouteVisit(url);
    router.push(url);
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
          {isSidebarCollapsed ? (
            <button
              type="button"
              className="sidebar-expand-btn desktop-only"
              onClick={() => setIsSidebarCollapsed(false)}
              aria-label="Expand sidebar"
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
          ) : (
            <>
              <Link
                href="/dashboard"
                className="sidebar-brand desktop-only"
                aria-label="Crew Hub home"
                onClick={() => handleSidebarItemClick("/dashboard")}
              >
                <span className="sidebar-brand-icon" aria-hidden="true">
                  <Image
                    src="/brand/icon-dark.png"
                    alt=""
                    width={30}
                    height={30}
                    className="sidebar-brand-image sidebar-brand-image-light"
                    priority
                  />
                  <Image
                    src="/brand/icon-light.png"
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
                className="sidebar-collapse-btn desktop-only"
                onClick={() => setIsSidebarCollapsed(true)}
                aria-label="Collapse sidebar"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <rect x="3" y="3" width="18" height="18" rx="3" stroke="currentColor" strokeWidth="1.5" fill="none" />
                  <line x1="9" y1="3" x2="9" y2="21" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M14 10l-2 2 2 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                </svg>
              </button>
            </>
          )}

          <Link
            href="/dashboard"
            className="sidebar-brand mobile-only"
            aria-label="Crew Hub home"
            onClick={() => handleSidebarItemClick("/dashboard")}
          >
            <span className="sidebar-brand-icon" aria-hidden="true">
              <Image
                src="/brand/icon-dark.png"
                alt=""
                width={30}
                height={30}
                className="sidebar-brand-image sidebar-brand-image-light"
                priority
              />
              <Image
                src="/brand/icon-light.png"
                alt=""
                width={30}
                height={30}
                className="sidebar-brand-image sidebar-brand-image-dark"
                priority
              />
            </span>
            <span className="sidebar-brand-copy">Crew Hub</span>
          </Link>
        </div>

        <nav className="sidebar-nav" aria-label="Primary">
          {navigationGroups.map(({ group, key, domId }) => {
            const hasHeading = group.label.length > 0;
            const isExpanded = expandedGroupKeys.has(key);
            const defaultExpanded = defaultExpandedGroupKeys.has(key);

            return (
              <section key={key} className="sidebar-group">
                {hasHeading ? (
                  <button
                    type="button"
                    className="sidebar-section-label"
                    onClick={() => handleSidebarGroupToggle(key, defaultExpanded)}
                    aria-expanded={isExpanded}
                    aria-controls={domId}
                    style={{
                      background: "none",
                      border: 0,
                      padding: 0,
                      textAlign: "left",
                      width: "100%",
                      cursor: "pointer"
                    }}
                  >
                    {group.label}
                  </button>
                ) : null}

                <ul id={domId} className="sidebar-links" hidden={!isExpanded}>
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
                          <NavIcon name={item.icon} size={18} className="sidebar-link-icon" />
                          <span className="sidebar-link-text">{item.label}</span>
                          {item.moduleId && getModuleState(item.moduleId) !== "LIVE" ? (
                            <FeatureBadge moduleId={item.moduleId} />
                          ) : null}
                          {showApprovalsBadge ? (
                            <span className="sidebar-link-badge numeric" aria-label="Pending approvals">
                              {approvalsCountQuery.data?.total ?? 0}
                            </span>
                          ) : null}
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
              <NavIcon name="Settings" size={18} className="sidebar-link-icon" />
              <span className="sidebar-link-text">Settings</span>
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
            <UserMenu
              profile={currentUserProfile}
              initials={sidebarProfileInitials}
              roles={currentUserRoles}
            />
          </div>
        </header>

        <main className="page-content">
          <AppErrorBoundary>{children}</AppErrorBoundary>
        </main>
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
          onNavigate={handleCommandNavigate}
        />
      ) : null}

      <KeyboardShortcutsModal />
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
