"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { FeatureBanner } from "../../../components/shared/feature-banner";
import { PageTabs, type PageTab } from "../../../components/shared/page-tabs";
import { PageHeader } from "../../../components/shared/page-header";
import type { UserRole } from "../../../lib/navigation";
import { hasRole } from "../../../lib/roles";
import { SchedulingCalendarClient } from "./calendar/scheduling-calendar-client";
import { SchedulingManageClient } from "./manage/scheduling-manage-client";
import { SchedulingClient } from "./scheduling-client";

type SchedulingTabsClientProps = {
  requestedTab: string;
  requestedScheduleId: string | null;
  userRoles: UserRole[];
  userDepartment?: string | null;
  currentUserId: string;
};

const CS_DEPARTMENT = "Customer Success";

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
  currentUserId
}: SchedulingTabsClientProps) {
  const t = useTranslations("scheduling");
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  const isCSTeam = userDepartment === CS_DEPARTMENT;
  const isSuperAdmin = hasRole(userRoles, "SUPER_ADMIN");

  const canManage =
    isSuperAdmin ||
    (isCSTeam && (
      hasRole(userRoles, "TEAM_LEAD") ||
      hasRole(userRoles, "MANAGER")
    ));

  const tabs = useMemo<PageTab[]>(
    () => {
      const nextTabs: PageTab[] = [
        {
          key: "my-shifts",
          label: t("tab.mySchedule")
        },
        {
          key: "team-calendar",
          label: t("tab.teamCalendar")
        }
      ];

      if (canManage) {
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

      <AnimatePresence mode="wait" initial={false}>
        <motion.section
          key={activeTab}
          className="tab-content-layout"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
        >
          {activeTab === "my-shifts" ? (
            <SchedulingClient
              embedded
              currentUserId={currentUserId}
              canManageSwaps={canManage}
            />
          ) : null}
          {activeTab === "team-calendar" ? (
            <SchedulingCalendarClient
              canManageShifts={canManage}
              initialScheduleId={requestedScheduleId}
              viewerDepartment={userDepartment ?? null}
            />
          ) : null}
          {activeTab === "manage" && canManage ? (
            <SchedulingManageClient viewerDepartment={userDepartment ?? null} />
          ) : null}
        </motion.section>
      </AnimatePresence>
    </>
  );
}
