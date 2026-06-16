"use client";

import { useTranslations } from "next-intl";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { FeatureBanner } from "../../../components/shared/feature-banner";
import { PageTabs, type PageTab } from "../../../components/shared/page-tabs";
import { PageHeader } from "../../../components/shared/page-header";
import type { UserRole } from "../../../lib/navigation";

import { SchedulingCalendarClient } from "./calendar/scheduling-calendar-client";
import { SchedulingGridClient } from "./grid/scheduling-grid-client";
import { SchedulingManageClient } from "./manage/scheduling-manage-client";
import { SchedulingRosterClient } from "./roster/scheduling-roster-client";
import { SchedulingClient } from "./scheduling-client";

type SchedulingTabsClientProps = {
  requestedTab: string;
  requestedScheduleId: string | null;
  userRoles: UserRole[];
  userDepartment?: string | null;
  currentUserId: string;
  canManageSchedules: boolean;
};

function resolveInitialTab(requestedTab: string, tabs: PageTab[]): string {
  const visibleKeys = new Set(tabs.map((tab) => tab.key));

  if (visibleKeys.has(requestedTab)) {
    return requestedTab;
  }

  return "my-shifts";
}

export function SchedulingTabsClient({
  requestedTab,
  requestedScheduleId,
  userRoles,
  userDepartment,
  currentUserId,
  canManageSchedules
}: SchedulingTabsClientProps) {
  const t = useTranslations("scheduling");
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  const canManage = canManageSchedules;

  const tabs = useMemo<PageTab[]>(
    () => {
      const nextTabs: PageTab[] = [
        {
          key: "my-shifts",
          label: t("tab.mySchedule")
        },
        {
          key: "roster",
          label: t("tab.roster")
        },
        {
          key: "team-calendar",
          label: t("tab.teamCalendar")
        }
      ];

      if (canManage) {
        nextTabs.push({
          key: "build",
          label: t("tab.build")
        });
        nextTabs.push({
          key: "manage",
          label: t("tab.manage")
        });
      }

      return nextTabs;
    },
    [canManage, t]
  );

  const visibleTabs = tabs;

  const [activeTab, setActiveTab] = useState(() => resolveInitialTab(requestedTab, visibleTabs));

  useEffect(() => {
    setActiveTab(resolveInitialTab(requestedTab, visibleTabs));
  }, [requestedTab, visibleTabs]);

  const handleTabChange = (tabKey: string) => {
    setActiveTab(tabKey);

    const nextParams = new URLSearchParams(searchParams.toString());

    if (tabKey === "my-shifts") {
      nextParams.delete("tab");
    } else {
      nextParams.set("tab", tabKey);
    }

    if (tabKey !== "team-calendar") {
      nextParams.delete("scheduleId");
    }

    const queryString = nextParams.toString();

    router.replace(queryString.length > 0 ? `${pathname}?${queryString}` : pathname, {
      scroll: false
    });
  };

  return (
    <>
      <PageHeader
        title={t("pageTitle")}
        description={t("pageDescription")}
      />

      <FeatureBanner
        moduleId="scheduling"
        description={t("pilotBanner")}
      />

      <PageTabs
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={handleTabChange}
        userRoles={userRoles}
      />

      <section key={activeTab} className="tab-content-layout">
        {activeTab === "my-shifts" ? (
          <SchedulingClient
            embedded
            currentUserId={currentUserId}
            canManageSwaps={canManage}
          />
        ) : null}
        {activeTab === "roster" ? (
          <SchedulingRosterClient currentUserId={currentUserId} />
        ) : null}
        {activeTab === "team-calendar" ? (
          <SchedulingCalendarClient
            canManageShifts={canManage}
            initialScheduleId={requestedScheduleId}
          />
        ) : null}
        {activeTab === "build" && canManage ? (
          <SchedulingGridClient canManage={canManage} />
        ) : null}
        {activeTab === "manage" && canManage ? (
          <SchedulingManageClient
            userRoles={userRoles}
            userDepartment={userDepartment}
          />
        ) : null}
      </section>
    </>
  );
}
