"use client";

import { useTranslations } from "next-intl";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { PageHeader } from "../../../components/shared/page-header";
import { PageTabs, type PageTab } from "../../../components/shared/page-tabs";
import type { UserRole } from "../../../lib/navigation";
import { GamesNightTab } from "./components/games-night-tab";
import { PresentationNightTab } from "./components/presentation-night-tab";

type CrewGamesClientProps = {
  currentUserId: string;
  orgId: string;
  userRoles: UserRole[];
  isAdmin: boolean;
};

export function CrewGamesClient({
  currentUserId,
  orgId,
  userRoles,
  isAdmin
}: CrewGamesClientProps) {
  const t = useTranslations("crewGames");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const tabs = useMemo<PageTab[]>(
    () => [
      { key: "games-night", label: t("tab.gamesNight") },
      { key: "presentation-night", label: t("tab.presentationNight") }
    ],
    [t]
  );

  const requestedTab = searchParams.get("tab") ?? "games-night";
  const initialTab = tabs.some((tab) => tab.key === requestedTab)
    ? requestedTab
    : "games-night";

  const [activeTab, setActiveTab] = useState(initialTab);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  const handleTabChange = (tabKey: string) => {
    setActiveTab(tabKey);

    const nextParams = new URLSearchParams(searchParams.toString());
    if (tabKey === "games-night") {
      nextParams.delete("tab");
    } else {
      nextParams.set("tab", tabKey);
    }

    const queryString = nextParams.toString();
    const nextUrl = queryString ? `${pathname}?${queryString}` : pathname;
    router.replace(nextUrl, { scroll: false });
  };

  return (
    <>
      <PageHeader
        title={t("pageTitle")}
        description={t("pageDescription")}
      />

      <PageTabs
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={handleTabChange}
        userRoles={userRoles}
      />

      <section key={activeTab} className="tab-content-layout">
        {activeTab === "games-night" ? (
          <GamesNightTab
            orgId={orgId}
            currentUserId={currentUserId}
            isAdmin={isAdmin}
          />
        ) : null}
        {activeTab === "presentation-night" ? (
          <PresentationNightTab
            orgId={orgId}
            currentUserId={currentUserId}
            isAdmin={isAdmin}
          />
        ) : null}
      </section>
    </>
  );
}
