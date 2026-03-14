"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";

import { PageHeader } from "../../../components/shared/page-header";
import { PageTabs, type PageTab } from "../../../components/shared/page-tabs";
import type { UserRole } from "../../../lib/navigation";
import { PeopleClient } from "./people-client";

const OrgChartClient = lazy(() =>
  import("./org-chart/org-chart-client").then((m) => ({ default: m.OrgChartClient }))
);

const DelegationsClient = lazy(() =>
  import("./delegations/delegations-client").then((m) => ({ default: m.DelegationsClient }))
);

type PeopleScope = "all" | "reports" | "me";

type PeopleTabsClientProps = {
  requestedTab: string;
  userRoles: UserRole[];
  currentUserId: string;
  initialScope: PeopleScope;
  canCreatePeople: boolean;
  canInvitePeople: boolean;
  canEditPeople: boolean;
  canResetAuthenticator: boolean;
  isAdmin: boolean;
  isSuperAdmin: boolean;
};

function resolveInitialTab(requestedTab: string, tabs: PageTab[]): string {
  const validTabs = new Set(tabs.map((tab) => tab.key));
  if (validTabs.has(requestedTab)) {
    return requestedTab;
  }
  return "directory";
}

export function PeopleTabsClient({
  requestedTab,
  userRoles,
  currentUserId,
  initialScope,
  canCreatePeople,
  canInvitePeople,
  canEditPeople,
  canResetAuthenticator,
  isAdmin,
  isSuperAdmin
}: PeopleTabsClientProps) {
  const tNav = useTranslations("nav");
  const t = useTranslations("people");
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  const tabs = useMemo<PageTab[]>(() => {
    const items: PageTab[] = [
      {
        key: "directory",
        label: t("tab.directory")
      }
    ];

    if (isSuperAdmin) {
      items.push({
        key: "org-chart",
        label: t("tab.orgChart"),
        requiredRoles: ["SUPER_ADMIN"]
      });

      items.push({
        key: "delegations",
        label: t("tab.delegations"),
        requiredRoles: ["SUPER_ADMIN"]
      });
    }

    return items;
  }, [t, isSuperAdmin]);

  const [activeTab, setActiveTab] = useState(() => resolveInitialTab(requestedTab, tabs));

  useEffect(() => {
    setActiveTab(resolveInitialTab(requestedTab, tabs));
  }, [requestedTab, tabs]);

  const handleTabChange = (tabKey: string) => {
    setActiveTab(tabKey);

    const nextParams = new URLSearchParams(searchParams.toString());

    if (tabKey === "directory") {
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
        title={tNav("people")}
        description={tNav("description.people")}
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
          {activeTab === "directory" ? (
            <PeopleClient
              currentUserId={currentUserId}
              initialScope={initialScope}
              canCreatePeople={canCreatePeople}
              canInvitePeople={canInvitePeople}
              canEditPeople={canEditPeople}
              canResetAuthenticator={canResetAuthenticator}
              isAdmin={isAdmin}
              embedded
            />
          ) : null}

          {activeTab === "org-chart" ? (
            <Suspense
              fallback={
                <div className="org-chart-loading">
                  <div className="spinner" />
                </div>
              }
            >
              <OrgChartClient />
            </Suspense>
          ) : null}

          {activeTab === "delegations" ? (
            <Suspense
              fallback={
                <div className="delegations-loading">
                  <div className="spinner" />
                </div>
              }
            >
              <DelegationsClient />
            </Suspense>
          ) : null}
        </motion.section>
      </AnimatePresence>
    </>
  );
}
