"use client";

import { useTranslations } from "next-intl";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { PageTabs, type PageTab } from "../../../components/shared/page-tabs";
import { PageHeader } from "../../../components/shared/page-header";
import type { UserRole } from "../../../lib/navigation";
import type { TimeOffSummaryResponseData } from "../../../types/time-off";
import { TimeOffCalendarClient } from "./calendar/calendar-client";
import { TimeOffClient } from "./time-off-client";

type TimeOffTabsClientProps = {
  requestedTab: string;
  userRoles: UserRole[];
  initialSummaryData?: TimeOffSummaryResponseData;
};

function resolveInitialTab(requestedTab: string, tabs: PageTab[]): string {
  const validTabs = new Set(tabs.map((tab) => tab.key));

  if (validTabs.has(requestedTab)) {
    return requestedTab;
  }

  return "my-requests";
}

export function TimeOffTabsClient({ requestedTab, userRoles, initialSummaryData }: TimeOffTabsClientProps) {
  const tNav = useTranslations('nav');
  const t = useTranslations('timeOffPage');
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  const tabs = useMemo<PageTab[]>(
    () => [
      {
        key: "my-requests",
        label: t('tab.myRequests')
      },
      {
        key: "calendar",
        label: t('tab.calendar')
      }
    ],
    [t]
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
        title={tNav('timeOff')}
        description={tNav('description.timeOff')}
      />

      <PageTabs
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={handleTabChange}
        userRoles={userRoles}
      />

      <section key={activeTab} className="tab-content-layout">
        {activeTab === "my-requests" ? <TimeOffClient embedded initialSummaryData={initialSummaryData} /> : null}
        {activeTab === "calendar" ? <TimeOffCalendarClient embedded userRoles={userRoles} /> : null}
      </section>
    </>
  );
}
