"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo } from "react";

import { PageTabs, type PageTab } from "../../../components/shared/page-tabs";
import { PageHeader } from "../../../components/shared/page-header";
import type { UserRole } from "../../../lib/navigation";
import { hasRole } from "../../../lib/roles";
import { ExpenseApprovalsClient } from "../expenses/approvals/approvals-client";
import { TimeAttendanceApprovalsClient } from "../time-attendance/approvals/approvals-client";
import { TimeOffApprovalsClient } from "../time-off/approvals/approvals-client";

type ApprovalsClientProps = {
  requestedTab: string;
  userRoles: UserRole[];
  canReviewTimeOff: boolean;
  canReviewExpenses: boolean;
  canReviewTimesheets: boolean;
};

function resolveInitialTab(requestedTab: string, visibleTabs: PageTab[]): string {
  const visibleTabKeys = new Set(visibleTabs.map((tab) => tab.key));

  if (visibleTabKeys.has(requestedTab)) {
    return requestedTab;
  }

  return "all";
}

export function ApprovalsClient({
  requestedTab,
  userRoles,
  canReviewTimeOff,
  canReviewExpenses,
  canReviewTimesheets
}: ApprovalsClientProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  const canManagerApproveExpenses =
    hasRole(userRoles, "MANAGER") || hasRole(userRoles, "SUPER_ADMIN");
  const canFinanceApproveExpenses =
    hasRole(userRoles, "FINANCE_ADMIN") || hasRole(userRoles, "SUPER_ADMIN");

  const approvalsCountQuery = useQuery({
    queryKey: [
      "approvals-tab-counts",
      userRoles.join("|"),
      canReviewTimeOff,
      canReviewExpenses,
      canReviewTimesheets
    ],
    queryFn: async () => {
      const response = await fetch("/api/v1/approvals/counts", { method: "GET" });

      if (!response.ok) {
        return {
          timeOff: 0,
          expenses: 0,
          timesheets: 0
        };
      }

      const payload = (await response.json()) as {
        data?: {
          timeOff?: number;
          expenses?: number;
          timesheets?: number;
        } | null;
      };

      return {
        timeOff: payload.data?.timeOff ?? 0,
        expenses: payload.data?.expenses ?? 0,
        timesheets: payload.data?.timesheets ?? 0
      };
    },
    staleTime: 2 * 60 * 1000,
    gcTime: 2 * 60 * 1000
  });

  const timeOffCount = approvalsCountQuery.data?.timeOff ?? 0;
  const expensesCount = approvalsCountQuery.data?.expenses ?? 0;
  const timesheetsCount = approvalsCountQuery.data?.timesheets ?? 0;

  const totalPendingCount = timeOffCount + expensesCount + timesheetsCount;

  const tabs = useMemo<PageTab[]>(
    () => [
      {
        key: "all",
        label: "All Pending",
        badge: totalPendingCount
      },
      {
        key: "time-off",
        label: "Time Off",
        badge: timeOffCount,
        requiredRoles: ["MANAGER", "HR_ADMIN", "SUPER_ADMIN"]
      },
      {
        key: "expenses",
        label: "Expenses",
        badge: expensesCount,
        requiredRoles: ["MANAGER", "FINANCE_ADMIN", "SUPER_ADMIN"]
      },
      {
        key: "timesheets",
        label: "Timesheets",
        badge: timesheetsCount,
        requiredRoles: ["TEAM_LEAD", "MANAGER", "HR_ADMIN", "FINANCE_ADMIN", "SUPER_ADMIN"]
      }
    ],
    [expensesCount, timeOffCount, timesheetsCount, totalPendingCount]
  );

  const visibleTabs = tabs.filter((tab) => {
    if (!tab.requiredRoles || tab.requiredRoles.length === 0) {
      return true;
    }

    return tab.requiredRoles.some((role) => hasRole(userRoles, role));
  });

  const activeTab = resolveInitialTab(requestedTab, visibleTabs);

  const handleTabChange = (tabKey: string) => {
    const nextParams = new URLSearchParams(searchParams.toString());

    if (tabKey === "time-off") {
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
        title="Approvals"
        description="Review and act on pending team requests."
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
          {activeTab === "all" ? (
            <section className="all-pending-overview">
              {totalPendingCount === 0 ? (
                <div className="all-pending-empty">
                  <p className="settings-card-description">No pending approvals. You&apos;re all caught up!</p>
                </div>
              ) : (
                <div className="all-pending-items">
                  {timeOffCount > 0 ? (
                    <button
                      type="button"
                      className="all-pending-item"
                      onClick={() => handleTabChange("time-off")}
                    >
                      <span className="all-pending-badge all-pending-badge-timeoff">Time Off</span>
                      <span className="all-pending-count">{timeOffCount} pending {timeOffCount === 1 ? "request" : "requests"}</span>
                      <span className="all-pending-arrow">→</span>
                    </button>
                  ) : null}
                  {expensesCount > 0 ? (
                    <button
                      type="button"
                      className="all-pending-item"
                      onClick={() => handleTabChange("expenses")}
                    >
                      <span className="all-pending-badge all-pending-badge-expenses">Expenses</span>
                      <span className="all-pending-count">{expensesCount} pending {expensesCount === 1 ? "expense" : "expenses"}</span>
                      <span className="all-pending-arrow">→</span>
                    </button>
                  ) : null}
                  {timesheetsCount > 0 ? (
                    <button
                      type="button"
                      className="all-pending-item"
                      onClick={() => handleTabChange("timesheets")}
                    >
                      <span className="all-pending-badge all-pending-badge-timesheets">Timesheets</span>
                      <span className="all-pending-count">{timesheetsCount} pending {timesheetsCount === 1 ? "timesheet" : "timesheets"}</span>
                      <span className="all-pending-arrow">→</span>
                    </button>
                  ) : null}
                </div>
              )}
            </section>
          ) : null}

          {activeTab === "time-off" ? <TimeOffApprovalsClient embedded /> : null}

          {activeTab === "expenses" ? (
            <ExpenseApprovalsClient
              canManagerApprove={canManagerApproveExpenses}
              canFinanceApprove={canFinanceApproveExpenses}
              embedded
            />
          ) : null}

          {activeTab === "timesheets" ? <TimeAttendanceApprovalsClient embedded /> : null}
        </motion.section>
      </AnimatePresence>
    </>
  );
}
