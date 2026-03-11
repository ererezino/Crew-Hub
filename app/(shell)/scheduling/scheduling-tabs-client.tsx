"use client";

import { AnimatePresence, motion } from "framer-motion";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { FeatureBanner } from "../../../components/shared/feature-banner";
import { PageTabs, type PageTab } from "../../../components/shared/page-tabs";
import { PageHeader } from "../../../components/shared/page-header";
import type { UserRole } from "../../../lib/navigation";
import { hasRole } from "../../../lib/roles";
import { SchedulingCalendarClient } from "./calendar/scheduling-calendar-client";
import { SchedulingManageClient } from "./manage/scheduling-manage-client";
import { SchedulingOpenShiftsClient } from "./open-shifts/scheduling-open-shifts-client";
import { SchedulingClient } from "./scheduling-client";

type SchedulingTabsClientProps = {
  requestedTab: string;
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
  userRoles,
  userDepartment,
  currentUserId
}: SchedulingTabsClientProps) {
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
    () => [
      {
        key: "my-shifts",
        label: "My Schedule"
      },
      {
        key: "team-calendar",
        label: "Team Calendar"
      },
      {
        key: "open-shifts",
        label: "Open Shifts"
      },
      {
        key: "manage",
        label: "Manage",
        requiredRoles: ["TEAM_LEAD", "MANAGER", "HR_ADMIN", "SUPER_ADMIN"]
      }
    ],
    []
  );

  const visibleTabs = tabs.filter((tab) => {
    if (!tab.requiredRoles || tab.requiredRoles.length === 0) {
      return true;
    }

    return tab.requiredRoles.some((role) => hasRole(userRoles, role));
  });

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

    const queryString = nextParams.toString();

    router.replace(queryString.length > 0 ? `${pathname}?${queryString}` : pathname, {
      scroll: false
    });
  };

  return (
    <>
      <PageHeader
        title="Schedule"
        description="Build, publish, and manage team shift schedules."
      />

      <FeatureBanner
        moduleId="scheduling"
        description="Scheduling is in limited pilot for Customer Success. Create monthly schedules for your team in a few clicks."
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
          {activeTab === "my-shifts" ? <SchedulingClient embedded /> : null}
          {activeTab === "team-calendar" ? (
            <SchedulingCalendarClient canManageShifts={canManage} />
          ) : null}
          {activeTab === "open-shifts" ? <SchedulingOpenShiftsClient embedded /> : null}
          {activeTab === "manage" && canManage ? <SchedulingManageClient /> : null}
        </motion.section>
      </AnimatePresence>
    </>
  );
}
