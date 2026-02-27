"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { NAV_GROUPS, ROUTE_ITEMS, type NavItem, type UserRole } from "../../lib/navigation";
import { hasRole } from "../../lib/roles";
import { CommandPalette } from "./command-palette";
import { NotificationCenter } from "./notification-center";
import { ThemeToggle } from "./theme-toggle";

const RECENT_ROUTE_STORAGE_KEY = "crew-hub-recent-routes";
const RECENT_ROUTE_LIMIT = 6;

const MOCK_USER_ROLES: UserRole[] = ["EMPLOYEE"];

function canAccessAdmin(userRoles: readonly UserRole[]): boolean {
  return (
    hasRole(userRoles, "HR_ADMIN") ||
    hasRole(userRoles, "FINANCE_ADMIN") ||
    hasRole(userRoles, "SUPER_ADMIN")
  );
}

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

type AppShellProps = {
  children: ReactNode;
};

export function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();

  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [recentRouteHrefs, setRecentRouteHrefs] = useState<string[]>(readRecentRoutes);

  const showAdminSection = canAccessAdmin(MOCK_USER_ROLES);

  const navigationGroups = useMemo(
    () => NAV_GROUPS.filter((group) => !group.adminOnly || showAdminSection),
    [showAdminSection]
  );

  const commandRoutes = useMemo(
    () => ROUTE_ITEMS.filter((route) => !route.href.startsWith("/admin") || showAdminSection),
    [showAdminSection]
  );

  const activePathname = pathname ?? "/dashboard";

  const activeRoute = useMemo(
    () => resolveTopbarRoute(activePathname, commandRoutes),
    [activePathname, commandRoutes]
  );

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
              <svg viewBox="0 0 24 24">
                <path
                  d="M4 8.2 12 3l8 5.2V18a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V8.2Z"
                  fill="currentColor"
                />
                <path
                  d="M9 15h6"
                  stroke="#FFFFFF"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                />
              </svg>
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
          {navigationGroups.map((group) => (
            <section key={group.label} className="sidebar-group">
              <h2 className="sidebar-group-title">{group.label}</h2>
              <ul className="sidebar-links">
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
          ))}
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
