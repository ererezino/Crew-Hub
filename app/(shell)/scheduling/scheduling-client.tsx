"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

import { EmptyState } from "../../../components/shared/empty-state";
import { PageHeader } from "../../../components/shared/page-header";
import { StatusBadge } from "../../../components/shared/status-badge";
import {
  useOpenShifts,
  useSchedulingShifts,
  useSchedulingSwaps
} from "../../../hooks/use-scheduling";
import { formatDateTimeTooltip, formatRelativeTime } from "../../../lib/datetime";
import { formatTimeRangeLabel } from "../../../lib/scheduling";
import type { ShiftStatus } from "../../../types/scheduling";

type SortDirection = "asc" | "desc";

function toneForShiftStatus(status: ShiftStatus) {
  switch (status) {
    case "scheduled":
      return "info" as const;
    case "swap_requested":
      return "pending" as const;
    case "swapped":
      return "success" as const;
    case "cancelled":
      return "error" as const;
    default:
      return "draft" as const;
  }
}

function schedulingSkeleton() {
  return (
    <section className="timeoff-skeleton-layout" aria-hidden="true">
      <div className="timeoff-balance-skeleton-grid">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={`scheduling-metric-skeleton-${index}`} className="timeoff-balance-skeleton-card" />
        ))}
      </div>
      <div className="timeoff-table-skeleton">
        <div className="timeoff-table-skeleton-header" />
        {Array.from({ length: 6 }, (_, index) => (
          <div key={`scheduling-row-skeleton-${index}`} className="timeoff-table-skeleton-row" />
        ))}
      </div>
    </section>
  );
}

export function SchedulingClient({ embedded = false }: { embedded?: boolean }) {
  const shiftsQuery = useSchedulingShifts({
    scope: "mine"
  });
  const openShiftsQuery = useOpenShifts();
  const swapsQuery = useSchedulingSwaps({
    scope: "mine",
    status: "pending"
  });
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [currentTime] = useState(() => Date.now());

  const sortedShifts = useMemo(() => {
    const rows = shiftsQuery.data?.shifts ?? [];

    return [...rows].sort((leftShift, rightShift) => {
      const leftValue = new Date(leftShift.startTime).getTime();
      const rightValue = new Date(rightShift.startTime).getTime();

      return sortDirection === "asc" ? leftValue - rightValue : rightValue - leftValue;
    });
  }, [shiftsQuery.data?.shifts, sortDirection]);

  const upcomingCount = sortedShifts.filter((shift) => new Date(shift.endTime).getTime() >= currentTime).length;
  const swapRequestedCount = sortedShifts.filter((shift) => shift.status === "swap_requested").length;

  return (
    <>
      {!embedded ? (
        <PageHeader
          title="Schedule"
          description="Review your upcoming shifts, open opportunities, and swap requests."
        />
      ) : null}

      {(shiftsQuery.isLoading || openShiftsQuery.isLoading || swapsQuery.isLoading) ? schedulingSkeleton() : null}

      {!shiftsQuery.isLoading && shiftsQuery.errorMessage ? (
        <section className="compensation-error-state">
          <EmptyState
            title="Scheduling data is unavailable"
            description={shiftsQuery.errorMessage}
            ctaLabel="Back to dashboard"
            ctaHref="/dashboard"
          />
          <button
            type="button"
            className="button button-accent"
            onClick={() => {
              shiftsQuery.refresh();
              openShiftsQuery.refresh();
              swapsQuery.refresh();
            }}
          >
            Retry
          </button>
        </section>
      ) : null}

      {!shiftsQuery.isLoading && !shiftsQuery.errorMessage ? (
        <section className="compensation-layout" aria-label="Scheduling overview">
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

          <article className="compensation-summary-card">
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
              <Link href="/scheduling?tab=swaps" className="button">
                Shift swaps
              </Link>
            </div>
          </article>

          <article className="compensation-section">
            <header className="announcements-section-header">
              <div>
                <h2 className="section-title">My upcoming shifts</h2>
                <p className="settings-card-description">
                  Weekly shifts sorted by start time.
                </p>
              </div>
            </header>

            {sortedShifts.length === 0 ? (
              <EmptyState
                title="No shifts scheduled yet"
                description="Your assigned shifts will appear here once a schedule is published."
                ctaLabel="View open shifts"
                ctaHref="/scheduling?tab=open-shifts"
              />
            ) : (
              <div className="data-table-container">
                <table className="data-table" aria-label="My shifts">
                  <thead>
                    <tr>
                      <th>
                        <button
                          type="button"
                          className="table-sort-trigger"
                          onClick={() =>
                            setSortDirection((currentDirection) =>
                              currentDirection === "asc" ? "desc" : "asc"
                            )
                          }
                        >
                          Shift date
                          <span className="numeric">{sortDirection === "asc" ? "↑" : "↓"}</span>
                        </button>
                      </th>
                      <th>Time</th>
                      <th>Schedule</th>
                      <th>Template</th>
                      <th>Break</th>
                      <th>Status</th>
                      <th className="table-action-column">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedShifts.map((shift) => (
                      <tr key={shift.id} className="data-table-row">
                        <td>
                          <span title={formatDateTimeTooltip(`${shift.shiftDate}T00:00:00.000Z`)}>
                            {formatRelativeTime(`${shift.shiftDate}T00:00:00.000Z`)}
                          </span>
                        </td>
                        <td className="numeric">{formatTimeRangeLabel(shift.startTime, shift.endTime)}</td>
                        <td>{shift.scheduleName ?? "Schedule"}</td>
                        <td>{shift.templateName ?? "--"}</td>
                        <td className="numeric">{shift.breakMinutes}m</td>
                        <td>
                          <StatusBadge tone={toneForShiftStatus(shift.status)}>
                            {shift.status.replace("_", " ")}
                          </StatusBadge>
                        </td>
                        <td className="table-row-action-cell">
                          <div className="timeatt-row-actions">
                            <Link href="/scheduling?tab=swaps" className="table-row-action">
                              Swap
                            </Link>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </article>
        </section>
      ) : null}
    </>
  );
}
