"use client";

import { AnimatePresence, motion } from "framer-motion";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { PageTabs, type PageTab } from "../../../components/shared/page-tabs";
import { PageHeader } from "../../../components/shared/page-header";
import type { UserRole } from "../../../lib/navigation";
import { TimeOffCalendarClient } from "./calendar/calendar-client";
import { TimeOffClient } from "./time-off-client";

type TimeOffTabsClientProps = {
  requestedTab: string;
  userRoles: UserRole[];
};

function resolveInitialTab(requestedTab: string, tabs: PageTab[]): string {
  const validTabs = new Set(tabs.map((tab) => tab.key));

  if (validTabs.has(requestedTab)) {
    return requestedTab;
  }

  return "my-requests";
}

export function TimeOffTabsClient({ requestedTab, userRoles }: TimeOffTabsClientProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  const tabs = useMemo<PageTab[]>(
    () => [
      {
        key: "my-requests",
        label: "My Requests"
      },
      {
        key: "calendar",
        label: "Calendar"
      }
    ],
    []
  );

  const [activeTab, setActiveTab] = useState(() => resolveInitialTab(requestedTab, tabs));

  useEffect(() => {
    setActiveTab(resolveInitialTab(requestedTab, tabs));
  }, [requestedTab, tabs]);

  const handleTabChange = (tabKey: string) => {
    setActiveTab(tabKey);

    const nextParams = new URLSearchParams(searchParams.toString());

    if (tabKey === "my-requests") {
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
        title="Time Off"
        description="Track leave balances, submit requests, and review your leave calendar."
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
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
        >
          {activeTab === "my-requests" ? <TimeOffClient embedded /> : null}
          {activeTab === "calendar" ? <TimeOffCalendarClient embedded userRoles={userRoles} /> : null}
        </motion.section>
      </AnimatePresence>
    </>
  );
}
