"use client";

import { hasAnyRole } from "../../lib/roles";
import type { UserRole } from "../../lib/navigation";

export interface PageTab {
  key: string;
  label: string;
  badge?: number;
  requiredRoles?: UserRole[];
}

export interface PageTabsProps {
  tabs: PageTab[];
  activeTab: string;
  onTabChange: (key: string) => void;
  userRoles: UserRole[];
}

export function PageTabs({ tabs, activeTab, onTabChange, userRoles }: PageTabsProps) {
  const visibleTabs = tabs.filter((tab) => {
    if (!tab.requiredRoles || tab.requiredRoles.length === 0) {
      return true;
    }

    return hasAnyRole(userRoles, tab.requiredRoles);
  });

  if (visibleTabs.length <= 1) {
    return null;
  }

  return (
    <div className="page-tabs" role="tablist" aria-label="Page sections">
      {visibleTabs.map((tab) => {
        const isActive = activeTab === tab.key;
        const badgeValue = typeof tab.badge === "number" ? Math.max(0, tab.badge) : null;

        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={isActive}
            className={isActive ? "page-tab page-tab-active" : "page-tab"}
            onClick={() => onTabChange(tab.key)}
          >
            <span>{tab.label}</span>
            {badgeValue !== null ? <span className="page-tab-badge numeric">{badgeValue}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
