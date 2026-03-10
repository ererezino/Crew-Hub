"use client";

import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { SupportLink } from "./support-link";
import { UnsavedLeaveDialog } from "./unsaved-leave-dialog";
import { WhoIsOnline } from "./who-is-online";

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

async function fetchSidebarApprovalCounts(
  currentUserRoles: readonly UserRole[]
): Promise<SidebarApprovalCounts> {
  if (!hasAnyRole(currentUserRoles, APPROVAL_GROUP_ROLES)) {
    return {
      timeOff: 0,
      expenses: 0,
      timesheets: 0,
      total: 0
    };
  }

  const response = await fetch("/api/v1/approvals/counts", { method: "GET" });
  if (!response.ok) {
    return {
      timeOff: 0,
      expenses: 0,
      timesheets: 0,
      total: 0
    };
  }

  const payload = (await response.json()) as {
    data?: {
      timeOff?: number;
      expenses?: number;
      timesheets?: number;
      total?: number;
    } | null;
  };

  const timeOff = payload.data?.timeOff ?? 0;
  const expenses = payload.data?.expenses ?? 0;
  const timesheets = payload.data?.timesheets ?? 0;

  return {
    timeOff,
    expenses,
    timesheets,
    total: timeOff + expenses + timesheets
  };
}

async function fetchActiveAnnouncementCount(): Promise<number> {
  try {
    const [announcementsRes, notificationsRes] = await Promise.all([
      fetch("/api/v1/announcements"),
      fetch("/api/v1/notifications?unreadOnly=true&limit=1")
    ]);

    let count = 0;

    if (announcementsRes.ok) {
      const json = (await announcementsRes.json()) as {
        data?: { announcements?: { isRead?: boolean }[] } | null;
      };
      const announcements = json?.data?.announcements;
      if (Array.isArray(announcements)) {
        count += announcements.filter((a) => a.isRead !== true).length;
      }
    }

    if (notificationsRes.ok) {
      const json = (await notificationsRes.json()) as {
        data?: { unreadCount?: number } | null;
      };
      count += json?.data?.unreadCount ?? 0;
    }

    return count;
  } catch {
    return 0;
  }
}

type AvailabilityStatus = "available" | "afk" | "ooo";

const STATUS_OPTIONS: { value: AvailabilityStatus; label: string }[] = [
  { value: "available", label: "Available" },
  { value: "afk", label: "Away From Keyboard" },
  { value: "ooo", label: "Out of office" },
];

const AFK_DURATION_OPTIONS: { value: number; label: string }[] = [
  { value: 15, label: "15 min" },
  { value: 30, label: "30 min" },
  { value: 45, label: "45 min" },
  { value: 60, label: "1 hr" },
  { value: 75, label: "1 hr 15 min" },
  { value: 90, label: "1 hr 30 min" },
  { value: 105, label: "1 hr 45 min" },
  { value: 120, label: "2 hrs" },
];

const OOO_DAY_OPTIONS: { value: number; label: string }[] = [
  { value: 1, label: "1 day" },
  { value: 2, label: "2 days" },
  { value: 3, label: "3 days" },
  { value: 4, label: "4 days" },
  { value: 5, label: "5 days" },
  { value: -1, label: "Other" },
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
  const [pendingStatus, setPendingStatus] = useState<AvailabilityStatus | null>(null);
  const [statusNote, setStatusNote] = useState("");
  const [statusDuration, setStatusDuration] = useState(30);
  const [statusDurationDays, setStatusDurationDays] = useState(1);
  const [statusCustomDays, setStatusCustomDays] = useState("");
  const [showCustomDaysInput, setShowCustomDaysInput] = useState(false);
  const [statusNoteError, setStatusNoteError] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const statusRef = useRef<HTMLDivElement | null>(null);
  const noteInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
      if (statusRef.current && !statusRef.current.contains(event.target as Node)) {
        setIsStatusPickerOpen(false);
        setPendingStatus(null);
        setStatusNoteError(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  const submitStatusChange = useCallback(async (
    status: AvailabilityStatus,
    note: string,
    durationMinutes?: number,
    durationDays?: number
  ) => {
    setCurrentStatus(status);
    setPendingStatus(null);
    setIsStatusPickerOpen(false);
    setStatusNoteError(false);
    setShowCustomDaysInput(false);
    try {
      await fetch("/api/v1/me/status", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, note, durationMinutes, durationDays })
      });
    } catch {
      // Best effort
    }
  }, []);

  const handleStatusOptionClick = useCallback((status: AvailabilityStatus) => {
    if (status === "available") {
      setStatusNote("");
      setStatusDuration(30);
      setStatusDurationDays(1);
      setStatusCustomDays("");
      setShowCustomDaysInput(false);
      void submitStatusChange(status, "");
      return;
    }
    setPendingStatus(status);
    setStatusNote("");
    setStatusNoteError(false);
    if (status === "ooo") {
      setStatusDurationDays(1);
      setStatusCustomDays("");
      setShowCustomDaysInput(false);
    } else {
      setStatusDuration(30);
    }
    setTimeout(() => noteInputRef.current?.focus(), 50);
  }, [submitStatusChange]);

  const confirmPendingStatus = useCallback(() => {
    if (!pendingStatus) return;
    const trimmed = statusNote.trim();
    if (!trimmed) {
      setStatusNoteError(true);
      noteInputRef.current?.focus();
      return;
    }
    if (pendingStatus === "ooo") {
      const days = showCustomDaysInput
        ? Math.min(Math.max(Number(statusCustomDays) || 1, 1), 10)
        : statusDurationDays;
      void submitStatusChange(pendingStatus, trimmed, undefined, days);
    } else {
      void submitStatusChange(pendingStatus, trimmed, statusDuration);
    }
  }, [pendingStatus, statusDuration, statusDurationDays, statusCustomDays, showCustomDaysInput, statusNote, submitStatusChange]);

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
    <div className="user-menu" ref={menuRef}>
      <div ref={statusRef} className="user-menu-status-wrapper">
        <button
          type="button"
          className="user-menu-trigger"
          onClick={() => setIsStatusPickerOpen((v) => !v)}
          aria-label="Change status"
        >
          {profile?.avatarUrl ? (
            <Image src={profile.avatarUrl} alt={profile.fullName} width={32} height={32} className="user-menu-avatar-image" />
          ) : (
            <span className="user-menu-avatar numeric">{initials}</span>
          )}
          <span className={`status-dot status-dot-${currentStatus}`} />
        </button>

        {isStatusPickerOpen ? (
          <div className="status-picker">
            {pendingStatus === null ? (
              STATUS_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  className={`status-picker-option${currentStatus === opt.value ? " status-picker-option-active" : ""}`}
                  onClick={() => handleStatusOptionClick(opt.value)}
                >
                  <span className={`status-picker-option-dot status-picker-option-dot-${opt.value}`} />
                  {opt.label}
                </button>
              ))
            ) : (
              <div className="status-note-panel">
                <p className="status-note-heading">
                  {STATUS_OPTIONS.find((o) => o.value === pendingStatus)?.label ?? "Status"}
                </p>
                <p className="status-note-label">
                  Add note &amp; set time <span className="status-note-required">*</span>
                </p>
                <input
                  ref={noteInputRef}
                  type="text"
                  className={`status-note-input${statusNoteError ? " status-note-input-error" : ""}`}
                  placeholder={
                    pendingStatus === "ooo"
                      ? "e.g. Taking my leave — back next Monday"
                      : "e.g. Stepping out to fix Gabby's car"
                  }
                  value={statusNote}
                  maxLength={200}
                  onChange={(e) => {
                    setStatusNote(e.target.value);
                    if (statusNoteError) setStatusNoteError(false);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") confirmPendingStatus();
                    if (e.key === "Escape") {
                      setPendingStatus(null);
                      setStatusNoteError(false);
                    }
                  }}
                />
                {statusNoteError ? (
                  <p className="status-note-error-text">A note is required.</p>
                ) : null}
                <div className="status-duration-row">
                  <label className="status-duration-label" htmlFor="status-duration-select">
                    {pendingStatus === "ooo" ? "Days" : "Duration"}
                  </label>
                  {pendingStatus === "ooo" ? (
                    showCustomDaysInput ? (
                      <div className="status-custom-days-row">
                        <input
                          type="number"
                          className="status-custom-days-input"
                          min={1}
                          max={10}
                          placeholder="1–10"
                          value={statusCustomDays}
                          onChange={(e) => setStatusCustomDays(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") confirmPendingStatus();
                          }}
                        />
                        <span className="status-custom-days-suffix">days</span>
                        <button
                          type="button"
                          className="status-custom-days-back"
                          onClick={() => { setShowCustomDaysInput(false); setStatusCustomDays(""); }}
                          aria-label="Back to dropdown"
                        >
                          ✕
                        </button>
                      </div>
                    ) : (
                      <select
                        id="status-duration-select"
                        className="status-duration-select"
                        value={statusDurationDays}
                        onChange={(e) => {
                          const val = Number(e.target.value);
                          if (val === -1) {
                            setShowCustomDaysInput(true);
                            setStatusCustomDays("");
                          } else {
                            setStatusDurationDays(val);
                          }
                        }}
                      >
                        {OOO_DAY_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                    )
                  ) : (
                    <select
                      id="status-duration-select"
                      className="status-duration-select"
                      value={statusDuration}
                      onChange={(e) => setStatusDuration(Number(e.target.value))}
                    >
                      {AFK_DURATION_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  )}
                </div>
                <div className="status-note-actions">
                  <button
                    type="button"
                    className="status-note-cancel"
                    onClick={() => {
                      setPendingStatus(null);
                      setStatusNoteError(false);
                      setShowCustomDaysInput(false);
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="status-note-confirm"
                    onClick={confirmPendingStatus}
                  >
                    Enter
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : null}
      </div>

      <button
        type="button"
        className="user-menu-trigger"
        onClick={() => setIsOpen((v) => !v)}
        aria-label="User menu"
      >
        <svg viewBox="0 0 24 24" className="user-menu-chevron-icon" aria-hidden="true">
          <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </svg>
      </button>

      {isOpen ? (
        <div className="user-menu-dropdown" role="menu">
          <div className="user-menu-profile">
            {profile?.avatarUrl ? (
              <Image src={profile.avatarUrl} alt={profile.fullName} width={40} height={40} className="user-menu-avatar-lg-image" />
            ) : (
              <span className="user-menu-avatar-lg numeric">{initials}</span>
            )}
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
    staleTime: 2 * 60 * 1000,
    gcTime: 2 * 60 * 1000,
    retry: 1,
    enabled: hasAnyRole(currentUserRoles, APPROVAL_GROUP_ROLES)
  });

  const announcementCountQuery = useQuery({
    queryKey: ["sidebar-announcement-count"],
    queryFn: fetchActiveAnnouncementCount,
    staleTime: 2 * 60 * 1000,
    gcTime: 5 * 60 * 1000,
    retry: 1
  });

  /* Refresh the sidebar badge when notifications/announcements are dismissed from the bell */
  const queryClient = useQueryClient();
  useEffect(() => {
    const handler = () => {
      void queryClient.invalidateQueries({ queryKey: ["sidebar-announcement-count"] });
    };
    window.addEventListener("crew-hub:badge-refresh", handler);
    return () => window.removeEventListener("crew-hub:badge-refresh", handler);
  }, [queryClient]);

  /* Presence heartbeat — pings /api/v1/me/heartbeat every 60s while the tab is visible */
  useEffect(() => {
    const HEARTBEAT_INTERVAL_MS = 60_000;

    const sendHeartbeat = () => {
      if (document.visibilityState !== "visible") return;
      void fetch("/api/v1/me/heartbeat", { method: "POST" }).catch(() => {
        /* swallow — heartbeat is best-effort */
      });
    };

    /* Send initial heartbeat on mount */
    sendHeartbeat();

    const intervalId = window.setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);

    /* Also send one when the tab becomes visible again */
    const handleVisibility = () => {
      if (document.visibilityState === "visible") sendHeartbeat();
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

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

  /* Settings is available to all authenticated users — everyone can manage
     their profile, preferences, and security. Admin-only tabs (Organization,
     Audit Log) are filtered inside SettingsClient via requiredRoles. */
  const settingsAllowed = Boolean(currentUserProfile);

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
                  >
                    {group.label}
                    <svg
                      viewBox="0 0 24 24"
                      className={`sidebar-section-chevron${isExpanded ? " sidebar-section-chevron-open" : ""}`}
                      aria-hidden="true"
                    >
                      <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                    </svg>
                  </button>
                ) : null}

                <ul id={domId} className="sidebar-links" hidden={!isExpanded}>
                  {group.items.map((item) => {
                    const isActive = isRouteActive(activePathname, item.href);
                    const showApprovalsBadge =
                      item.href === "/approvals" &&
                      (approvalsCountQuery.data?.total ?? 0) > 0;
                    const showAnnouncementBadge =
                      item.href === "/announcements" &&
                      (announcementCountQuery.data ?? 0) > 0;

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
                          {showAnnouncementBadge ? (
                            <span className="sidebar-link-badge numeric" aria-label="Unread announcements">
                              {announcementCountQuery.data ?? 0}
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

        {isSuperAdmin(currentUserRoles) ? (
          <WhoIsOnline isSidebarCollapsed={isSidebarCollapsed && !isMobileSidebarOpen} />
        ) : null}

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

          <SupportLink isActive={isRouteActive(activePathname, "/support")} />

          {settingsAllowed && currentUserProfile ? (
            <Link
              href="/settings?tab=profile"
              className="sidebar-profile-link"
              onClick={() => handleSidebarItemClick("/settings")}
            >
              {currentUserProfile?.avatarUrl ? (
                <Image src={currentUserProfile.avatarUrl} alt="" width={32} height={32} className="sidebar-profile-avatar-image" aria-hidden="true" />
              ) : (
                <span className="sidebar-profile-avatar numeric" aria-hidden="true">
                  {sidebarProfileInitials}
                </span>
              )}
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
      <UnsavedLeaveDialog />
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
            gcTime: 15 * 60 * 1000,
            refetchOnWindowFocus: false
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
