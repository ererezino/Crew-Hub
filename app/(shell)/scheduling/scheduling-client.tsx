"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { CalendarClock } from "lucide-react";

import { EmptyState } from "../../../components/shared/empty-state";
import { PageHeader } from "../../../components/shared/page-header";
import { MyScheduleCalendar } from "../../../components/scheduling/my-schedule-calendar";
import { ShiftSwapModal } from "../../../components/scheduling/shift-swap-modal";
import {
  useSchedulingShifts,
  useSchedulingSwaps
} from "../../../hooks/use-scheduling";
import type { ShiftRecord } from "../../../types/scheduling";
import { SchedulingOpenShiftsClient } from "./open-shifts/scheduling-open-shifts-client";
import { SchedulingSwapsClient } from "./swaps/scheduling-swaps-client";

function schedulingSkeleton() {
  return (
    <section className="timeoff-skeleton-layout" aria-hidden="true">
      <div className="timeoff-balance-skeleton-grid">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={`scheduling-metric-skeleton-${index}`} className="timeoff-balance-skeleton-card" />
        ))}
      </div>
      <div className="table-skeleton">
        <div className="table-skeleton-header" />
        {Array.from({ length: 6 }, (_, index) => (
          <div key={`scheduling-row-skeleton-${index}`} className="table-skeleton-row" />
        ))}
      </div>
    </section>
  );
}

export function SchedulingClient({
  embedded = false,
  currentUserId = "",
  canManageSwaps = false
}: {
  embedded?: boolean;
  currentUserId?: string;
  canManageSwaps?: boolean;
}) {
  const t = useTranslations("scheduling");
  const tc = useTranslations("common");
  const shiftsQuery = useSchedulingShifts({ scope: "mine" });
  const swapsQuery = useSchedulingSwaps({
    scope: canManageSwaps ? "team" : "mine",
    status: "pending"
  });

  const [swapModalOpen, setSwapModalOpen] = useState(false);
  const [swapAnchorShift, setSwapAnchorShift] = useState<ShiftRecord | null>(null);

  const isInitialLoading = shiftsQuery.isLoading && shiftsQuery.data === null;
  const shifts = shiftsQuery.data?.shifts ?? [];
  const [currentTime] = useState(() => Date.now());
  const upcomingCount = shifts.filter((s) => new Date(s.endTime).getTime() >= currentTime).length;
  const swapRequestedCount = shifts.filter((s) => s.status === "swap_requested").length;

  const handleShiftClick = useCallback((shift: ShiftRecord) => {
    // Only allow swap requests on scheduled shifts
    if (shift.status !== "scheduled") return;
    setSwapAnchorShift(shift);
    setSwapModalOpen(true);
  }, []);

  const handleSwapSubmit = async (shiftIds: string[], reason: string) => {
    // Submit swap requests for each shift
    const results = await Promise.allSettled(
      shiftIds.map((shiftId) =>
        fetch("/api/v1/scheduling/swaps", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ shiftId, reason: reason || undefined })
        }).then(async (res) => {
          if (!res.ok) {
            const data = await res.json().catch(() => null);
            throw new Error(data?.error?.message ?? t("overview.failedSwap"));
          }
          return res.json();
        })
      )
    );

    const failures = results.filter((r) => r.status === "rejected");
    if (failures.length > 0) {
      const firstError = (failures[0] as PromiseRejectedResult).reason;
      throw new Error(
        firstError instanceof Error ? firstError.message : t("overview.someSwapsFailed")
      );
    }

    // Refresh data
    shiftsQuery.refresh();
    swapsQuery.refresh();
  };

  return (
    <>
      {!embedded ? (
        <PageHeader
          title={t("pageTitle")}
          description={t("pageDescription")}
        />
      ) : null}

      {isInitialLoading ? schedulingSkeleton() : null}

      {!shiftsQuery.isLoading && shiftsQuery.errorMessage ? (
        <>
          <EmptyState
            title={t("overview.dataUnavailable")}
            description={shiftsQuery.errorMessage}
          />
          <button
            type="button"
            className="button"
            onClick={() => {
              shiftsQuery.refresh();
              swapsQuery.refresh();
            }}
          >
            {tc("retry")}
          </button>
        </>
      ) : null}

      {!shiftsQuery.isLoading && !shiftsQuery.errorMessage ? (
        <section className="compensation-layout" aria-label={t("overview.ariaLabel")}>
          {/* Metric cards */}
          <article className="metric-grid">
            <article className="metric-card">
              <p className="metric-label">{t("overview.upcomingShifts")}</p>
              <p className="metric-value numeric">{upcomingCount}</p>
              <p className="metric-description">{t("overview.upcomingShiftsDesc")}</p>
            </article>
            <article className="metric-card">
              <p className="metric-label">{canManageSwaps ? t("overview.teamPendingSwaps") : t("overview.pendingSwaps")}</p>
              <p className="metric-value numeric">{swapsQuery.data?.swaps.length ?? 0}</p>
              <p className="metric-description">
                {canManageSwaps ? t("overview.teamPendingSwapsDesc") : t("overview.pendingSwapsDesc")}
              </p>
            </article>
            <article className="metric-card">
              <p className="metric-label">{t("overview.swapRequested")}</p>
              <p className="metric-value numeric">{swapRequestedCount}</p>
              <p className="metric-description">{t("overview.swapRequestedDesc")}</p>
            </article>
          </article>

          {/* Quick actions */}
          <article className="metric-card">
            <div>
              <h2 className="section-title">{t("overview.quickActions")}</h2>
              <p className="settings-card-description">
                {t("overview.quickActionsDesc")}
              </p>
            </div>
            <div className="documents-row-actions">
              <Link href="/scheduling?tab=team-calendar" className="button">
                {t("overview.teamCalendar")}
              </Link>
              {canManageSwaps ? (
                <Link href="/scheduling?tab=manage" className="button">
                  {t("tab.manage")}
                </Link>
              ) : null}
            </div>
          </article>

          {/* Calendar view */}
          <article className="compensation-section">
            <header className="announcements-section-header">
              <div>
                <h2 className="section-title">{t("overview.mySchedule")}</h2>
                <p className="settings-card-description">
                  {t("overview.myScheduleDesc")}
                </p>
              </div>
            </header>

            {shifts.length === 0 ? (
              <EmptyState
                icon={<CalendarClock size={32} />}
                title={t("overview.noShiftsTitle")}
                description={t("overview.noShiftsDesc")}
              />
            ) : (
              <MyScheduleCalendar
                shifts={shifts}
                onShiftClick={handleShiftClick}
              />
            )}
          </article>

          <article className="compensation-section">
            <header className="announcements-section-header">
              <div>
                <h2 className="section-title">{t("overview.swapRequests")}</h2>
                <p className="settings-card-description">
                  {t("overview.swapRequestsDesc")}
                </p>
              </div>
            </header>
            <SchedulingSwapsClient
              currentUserId={currentUserId}
              canManageSwaps={canManageSwaps}
              embedded
            />
          </article>

          <article className="compensation-section">
            <header className="announcements-section-header">
              <div>
                <h2 className="section-title">{t("openShifts.sectionTitle")}</h2>
                <p className="settings-card-description">
                  {t("openShifts.pageDescription")}
                </p>
              </div>
            </header>
            <SchedulingOpenShiftsClient embedded />
          </article>
        </section>
      ) : null}

      {/* Swap modal */}
      <ShiftSwapModal
        isOpen={swapModalOpen}
        anchorShift={swapAnchorShift}
        allShifts={shifts}
        onClose={() => setSwapModalOpen(false)}
        onSubmit={handleSwapSubmit}
      />
    </>
  );
}
