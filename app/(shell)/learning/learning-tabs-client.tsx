"use client";

import { AnimatePresence, motion } from "framer-motion";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { PageTabs, type PageTab } from "../../../components/shared/page-tabs";
import { PageHeader } from "../../../components/shared/page-header";
import type { UserRole } from "../../../lib/navigation";
import { LearningCertificatesClient } from "./certificates/learning-certificates-client";
import { LearningClient } from "./learning-client";
import { SurveysClient } from "../surveys/surveys-client";

type LearningTabsClientProps = {
  requestedTab: string;
  userRoles: UserRole[];
  canManageSurveys: boolean;
};

function resolveInitialTab(requestedTab: string, tabs: PageTab[]): string {
  const tabKeys = new Set(tabs.map((tab) => tab.key));

  if (tabKeys.has(requestedTab)) {
    return requestedTab;
  }

  return "courses";
}

export function LearningTabsClient({
  requestedTab,
  userRoles,
  canManageSurveys
}: LearningTabsClientProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  const tabs = useMemo<PageTab[]>(
    () => [
      {
        key: "courses",
        label: "My Courses"
      },
      {
        key: "certificates",
        label: "Certificates"
      },
      {
        key: "surveys",
        label: "Surveys"
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

    if (tabKey === "courses") {
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
        title="Learning"
        description="Assigned courses, certificates, and surveys in one workspace."
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
          {activeTab === "courses" ? <LearningClient embedded /> : null}
          {activeTab === "certificates" ? <LearningCertificatesClient embedded /> : null}
          {activeTab === "surveys" ? (
            <SurveysClient canManageSurveys={canManageSurveys} embedded />
          ) : null}
        </motion.section>
      </AnimatePresence>
    </>
  );
}
