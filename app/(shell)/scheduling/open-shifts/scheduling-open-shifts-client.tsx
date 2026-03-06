"use client";

import { useMemo, useState } from "react";

import { EmptyState } from "../../../../components/shared/empty-state";
import { PageHeader } from "../../../../components/shared/page-header";
import { StatusBadge } from "../../../../components/shared/status-badge";
import { useOpenShifts } from "../../../../hooks/use-scheduling";
import { formatDateTimeTooltip, formatRelativeTime } from "../../../../lib/datetime";
import { formatShiftStatus } from "../../../../lib/format-labels";
import { formatTimeRangeLabel } from "../../../../lib/scheduling";

type SortDirection = "asc" | "desc";

function openShiftsSkeleton() {
  return (
    <div className="table-skeleton" aria-hidden="true">
      <div className="table-skeleton-header" />
      {Array.from({ length: 6 }, (_, index) => (
        <div key={`open-shift-skeleton-${index}`} className="table-skeleton-row" />
      ))}
    </div>
  );
}

export function SchedulingOpenShiftsClient({ embedded = false }: { embedded?: boolean }) {
  const openShiftsQuery = useOpenShifts();
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [isClaimingShiftId, setIsClaimingShiftId] = useState<string | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);

  const sortedShifts = useMemo(() => {
    const rows = openShiftsQuery.data?.shifts ?? [];

    return [...rows].sort((leftShift, rightShift) => {
      const leftValue = new Date(leftShift.startTime).getTime();
      const rightValue = new Date(rightShift.startTime).getTime();

      return sortDirection === "asc" ? leftValue - rightValue : rightValue - leftValue;
    });
  }, [openShiftsQuery.data?.shifts, sortDirection]);

  async function handleClaimShift(shiftId: string) {
    setIsClaimingShiftId(shiftId);
    setFeedbackMessage(null);

    try {
      const response = await fetch(`/api/v1/scheduling/shifts/${shiftId}/claim`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({})
      });
      const payload = (await response.json()) as {
        data: unknown;
        error: { message?: string } | null;
      };

      if (!response.ok) {
        setFeedbackMessage(payload.error?.message ?? "Unable to claim shift.");
        return;
      }

      setFeedbackMessage("Shift claimed.");
      openShiftsQuery.refresh();
    } catch (error) {
      setFeedbackMessage(error instanceof Error ? error.message : "Unable to claim shift.");
    } finally {
      setIsClaimingShiftId(null);
    }
  }

  return (
    <>
      {!embedded ? (
        <PageHeader
          title="Open Shifts"
          description="Claim available shifts published by your managers."
        />
      ) : null}

      {openShiftsQuery.isLoading ? openShiftsSkeleton() : null}

      {!openShiftsQuery.isLoading && openShiftsQuery.errorMessage ? (
        <>
          <EmptyState
            title="Open shifts are unavailable"
            description={openShiftsQuery.errorMessage}
          />
          <button
            type="button"
            className="button"
            onClick={() => openShiftsQuery.refresh()}
          >
            Retry
          </button>
        </>
      ) : null}

      {!openShiftsQuery.isLoading && !openShiftsQuery.errorMessage && sortedShifts.length === 0 ? (
        <EmptyState
          title="No open shifts available"
          description="When managers publish open shifts, they appear here."
          ctaLabel="Open Scheduling"
          ctaHref="/scheduling"
        />
      ) : null}

      {!openShiftsQuery.isLoading && !openShiftsQuery.errorMessage && sortedShifts.length > 0 ? (
        <section className="compensation-layout" aria-label="Open shifts">
          <article className="metric-card">
            <div>
              <h2 className="section-title">Open opportunities</h2>
              <p className="settings-card-description">
                {sortedShifts.length} shifts are available to claim.
              </p>
            </div>
            <StatusBadge tone="pending">Open</StatusBadge>
          </article>

          {feedbackMessage ? <p className="settings-card-description">{feedbackMessage}</p> : null}

          <div className="data-table-container">
            <table className="data-table" aria-label="Open shifts table">
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
                      Shift
                      <span className="numeric">{sortDirection === "asc" ? "↑" : "↓"}</span>
                    </button>
                  </th>
                  <th>Schedule</th>
                  <th>Template</th>
                  <th>Status</th>
                  <th className="table-action-column">Actions</th>
                </tr>
              </thead>
              <tbody>
                {sortedShifts.map((shift) => (
                  <tr key={shift.id} className="data-table-row">
                    <td className="numeric">
                      <span title={formatDateTimeTooltip(shift.startTime)}>
                        {formatRelativeTime(shift.startTime)}
                      </span>{" "}
                      {formatTimeRangeLabel(shift.startTime, shift.endTime)}
                    </td>
                    <td>{shift.scheduleName ?? "Schedule"}</td>
                    <td>{shift.templateName ?? "--"}</td>
                    <td>
                      <StatusBadge tone="pending">{formatShiftStatus(shift.status)}</StatusBadge>
                    </td>
                    <td className="table-row-action-cell">
                      <div className="timeatt-row-actions">
                        <button
                          type="button"
                          className="table-row-action"
                          onClick={() => handleClaimShift(shift.id)}
                          disabled={isClaimingShiftId === shift.id}
                        >
                          {isClaimingShiftId === shift.id ? "Claiming..." : "Claim"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </>
  );
}
