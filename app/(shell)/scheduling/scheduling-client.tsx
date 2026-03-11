"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { CalendarClock } from "lucide-react";

import { EmptyState } from "../../../components/shared/empty-state";
import { PageHeader } from "../../../components/shared/page-header";
import { MyScheduleCalendar } from "../../../components/scheduling/my-schedule-calendar";
import { ShiftSwapModal } from "../../../components/scheduling/shift-swap-modal";
import {
  useOpenShifts,
  useSchedulingShifts,
  useSchedulingSwaps
} from "../../../hooks/use-scheduling";
import type { ShiftRecord } from "../../../types/scheduling";

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

export function SchedulingClient({ embedded = false }: { embedded?: boolean }) {
  const shiftsQuery = useSchedulingShifts({ scope: "mine" });
  const openShiftsQuery = useOpenShifts();
  const swapsQuery = useSchedulingSwaps({ scope: "mine", status: "pending" });

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

  const handleSwapSubmit = useCallback(async (shiftIds: string[], reason: string) => {
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
            throw new Error(data?.error?.message ?? "Failed to request swap.");
          }
          return res.json();
        })
      )
    );

    const failures = results.filter((r) => r.status === "rejected");
    if (failures.length > 0) {
      const firstError = (failures[0] as PromiseRejectedResult).reason;
      throw new Error(
        firstError instanceof Error ? firstError.message : "Some swap requests failed."
      );
    }

    // Refresh data
    shiftsQuery.refresh();
    swapsQuery.refresh();
  }, [shiftsQuery, swapsQuery]);

  return (
    <>
      {!embedded ? (
        <PageHeader
          title="Schedule"
          description="Build, publish, and manage team shift schedules."
        />
      ) : null}

      {isInitialLoading ? schedulingSkeleton() : null}

      {!shiftsQuery.isLoading && shiftsQuery.errorMessage ? (
        <>
          <EmptyState
            title="Scheduling data is unavailable"
            description={shiftsQuery.errorMessage}
          />
          <button
            type="button"
            className="button"
            onClick={() => {
              shiftsQuery.refresh();
              openShiftsQuery.refresh();
              swapsQuery.refresh();
            }}
          >
            Retry
          </button>
        </>
      ) : null}

      {!shiftsQuery.isLoading && !shiftsQuery.errorMessage ? (
        <section className="compensation-layout" aria-label="Scheduling overview">
          {/* Metric cards */}
          <article className="metric-grid">
            <article className="metric-card">
              <p className="metric-label">Upcoming shifts</p>
              <p className="metric-value numeric">{upcomingCount}</p>
              <p className="metric-description">Scheduled future shifts.</p>
            </article>
            <article className="metric-card">
              <p className="metric-label">Open shifts</p>
              <p className="metric-value numeric">{openShiftsQuery.data?.shifts.length ?? 0}</p>
              <p className="metric-description">Available to claim now.</p>
            </article>
            <article className="metric-card">
              <p className="metric-label">Pending swaps</p>
              <p className="metric-value numeric">{swapsQuery.data?.swaps.length ?? 0}</p>
              <p className="metric-description">Swap requests awaiting action.</p>
            </article>
            <article className="metric-card">
              <p className="metric-label">Swap requested</p>
              <p className="metric-value numeric">{swapRequestedCount}</p>
              <p className="metric-description">Your shifts in swap request status.</p>
            </article>
          </article>

          {/* Quick actions */}
          <article className="metric-card">
            <div>
              <h2 className="section-title">Quick actions</h2>
              <p className="settings-card-description">
                Review open shifts or manage your swap requests.
              </p>
            </div>
            <div className="documents-row-actions">
              <Link href="/scheduling?tab=open-shifts" className="button">
                Open shifts
              </Link>
              <Link href="/scheduling?tab=team-calendar" className="button">
                Team calendar
              </Link>
            </div>
          </article>

          {/* Calendar view */}
          <article className="compensation-section">
            <header className="announcements-section-header">
              <div>
                <h2 className="section-title">My schedule</h2>
                <p className="settings-card-description">
                  Click on a shift to request a swap.
                </p>
              </div>
            </header>

            {shifts.length === 0 ? (
              <EmptyState
                icon={<CalendarClock size={32} />}
                title="No shifts yet"
                description="Your upcoming shifts will appear after a schedule is published."
                ctaLabel="View open shifts"
                ctaHref="/scheduling?tab=open-shifts"
              />
            ) : (
              <MyScheduleCalendar
                shifts={shifts}
                onShiftClick={handleShiftClick}
              />
            )}
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
