"use client";

import { AnimatePresence, motion } from "framer-motion";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { PageTabs, type PageTab } from "../../../components/shared/page-tabs";
import { PageHeader } from "../../../components/shared/page-header";
import type { UserRole } from "../../../lib/navigation";
import { hasRole } from "../../../lib/roles";
import { SchedulingTemplatesAdminClient } from "../admin/scheduling/templates/scheduling-templates-admin-client";
import { SchedulingManageClient } from "./manage/scheduling-manage-client";
import { SchedulingOpenShiftsClient } from "./open-shifts/scheduling-open-shifts-client";
import { SchedulingClient } from "./scheduling-client";
import { SchedulingSwapsClient } from "./swaps/scheduling-swaps-client";

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

  const canManageTemplates = isSuperAdmin || (isCSTeam && hasRole(userRoles, "HR_ADMIN"));

  const tabs = useMemo<PageTab[]>(
    () => [
      {
        key: "my-shifts",
        label: "My Shifts"
      },
      {
        key: "open-shifts",
        label: "Open Shifts"
      },
      {
        key: "swaps",
        label: "Swap Requests"
      },
      {
        key: "manage",
        label: "Manage",
        requiredRoles: ["TEAM_LEAD", "MANAGER", "HR_ADMIN", "SUPER_ADMIN"]
      },
      {
        key: "templates",
        label: "Templates",
        requiredRoles: ["HR_ADMIN", "SUPER_ADMIN"]
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
        description="Shifts, swaps, and team schedule management."
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
          {activeTab === "open-shifts" ? <SchedulingOpenShiftsClient embedded /> : null}
          {activeTab === "swaps" ? (
            <SchedulingSwapsClient
              currentUserId={currentUserId}
              canManageSwaps={canManage}
              embedded
            />
          ) : null}
          {activeTab === "manage" && canManage ? <SchedulingManageClient embedded /> : null}
          {activeTab === "templates" && canManageTemplates ? (
            <>
              <div className="scheduling-template-explanation">
                <p>
                  Shift templates are reusable time presets for common shift patterns
                  (e.g. Morning 8–4, Evening 4–12) so you don&apos;t re-enter times each time you create a shift.
                </p>
              </div>
              <SchedulingTemplatesAdminClient embedded />
            </>
          ) : null}
        </motion.section>
      </AnimatePresence>
    </>
  );
}
