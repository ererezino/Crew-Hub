"use client";

import { useMemo, useState } from "react";

import { EmptyState } from "../../../components/shared/empty-state";
import { PageHeader } from "../../../components/shared/page-header";
import { StatusBadge } from "../../../components/shared/status-badge";
import { useTimeAttendanceOverview } from "../../../hooks/use-time-attendance";
import { countryFlagFromCode, countryNameFromCode } from "../../../lib/countries";
import { formatDateTimeTooltip, formatRelativeTime } from "../../../lib/datetime";
import { formatHoursFromMinutes, formatTimeEntryMethod } from "../../../lib/time-attendance";

type SortDirection = "asc" | "desc";

function overviewSkeleton() {
  return (
    <section className="timeoff-skeleton-layout" aria-hidden="true">
      <div className="timeoff-balance-skeleton-grid">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={`time-attendance-metric-skeleton-${index}`} className="timeoff-balance-skeleton-card" />
        ))}
      </div>
      <div className="timeoff-table-skeleton">
        <div className="timeoff-table-skeleton-header" />
        {Array.from({ length: 6 }, (_, index) => (
          <div key={`time-attendance-row-skeleton-${index}`} className="timeoff-table-skeleton-row" />
        ))}
      </div>
    </section>
  );
}

export function TimeAttendanceClient() {
  const overviewQuery = useTimeAttendanceOverview();
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  const sortedEntries = useMemo(() => {
    const rows = overviewQuery.data?.recentEntries ?? [];

    return [...rows].sort((leftEntry, rightEntry) => {
      const leftTime = new Date(leftEntry.clockIn).getTime();
      const rightTime = new Date(rightEntry.clockIn).getTime();

      return sortDirection === "asc" ? leftTime - rightTime : rightTime - leftTime;
    });
  }, [overviewQuery.data?.recentEntries, sortDirection]);

  const activeEntry = overviewQuery.data?.activeEntry ?? null;

  return (
    <>
      <PageHeader
        title="Hours"
        description="Track clock-ins, review worked hours, and monitor weekly attendance totals."
      />

      {overviewQuery.isLoading ? overviewSkeleton() : null}

      {!overviewQuery.isLoading && overviewQuery.errorMessage ? (
        <section className="compensation-error-state">
          <EmptyState
            title="Attendance data is unavailable"
            description={overviewQuery.errorMessage}
            ctaLabel="Back to dashboard"
            ctaHref="/dashboard"
          />
          <button
            type="button"
            className="button button-accent"
            onClick={() => overviewQuery.refresh()}
          >
            Retry
          </button>
        </section>
      ) : null}

      {!overviewQuery.isLoading && !overviewQuery.errorMessage && overviewQuery.data ? (
        <section className="compensation-layout" aria-label="Attendance overview">
          <article className="metric-grid">
            <article className="metric-card">
              <p className="metric-label">Clock status</p>
              <p className="metric-value numeric">{activeEntry ? "On shift" : "Off shift"}</p>
              <p className="metric-description">
                {activeEntry
                  ? `Started ${formatRelativeTime(activeEntry.clockIn)}`
                  : "No active time entry."}
              </p>
            </article>

            <article className="metric-card">
              <p className="metric-label">Worked today</p>
              <p className="metric-value numeric">
                {formatHoursFromMinutes(overviewQuery.data.totals.workedMinutesToday)}h
              </p>
              <p className="metric-description numeric">
                Breaks: {formatHoursFromMinutes(overviewQuery.data.totals.breakMinutesToday)}h
              </p>
            </article>

            <article className="metric-card">
              <p className="metric-label">Week total</p>
              <p className="metric-value numeric">
                {formatHoursFromMinutes(overviewQuery.data.totals.workedMinutesThisWeek)}h
              </p>
              <p className="metric-description numeric">
                OT: {formatHoursFromMinutes(overviewQuery.data.totals.overtimeMinutesThisWeek)}h
              </p>
            </article>

            <article className="metric-card">
              <p className="metric-label">Pending timesheets</p>
              <p className="metric-value numeric">{overviewQuery.data.totals.pendingTimesheetCount}</p>
              <p className="metric-description">Awaiting submit or approval.</p>
            </article>
          </article>

          <article className="compensation-summary-card">
            <div>
              <h2 className="section-title">Current shift</h2>
              <p className="settings-card-description">
                Live clock state for {overviewQuery.data.profile.fullName}.
              </p>
            </div>
            {activeEntry ? (
              <StatusBadge tone="processing">Clocked in</StatusBadge>
            ) : (
              <StatusBadge tone="draft">Clocked out</StatusBadge>
            )}
          </article>

          {activeEntry ? (
            <article className="settings-card">
              <header className="announcement-item-header">
                <div>
                  <h2 className="section-title">Active time entry</h2>
                  <p className="settings-card-description">
                    Started {formatRelativeTime(activeEntry.clockIn)} via {formatTimeEntryMethod(activeEntry.clockInMethod)}.
                  </p>
                </div>
                <StatusBadge tone="processing">In progress</StatusBadge>
              </header>
              <div className="documents-cell-copy">
                <span className="numeric" title={formatDateTimeTooltip(activeEntry.clockIn)}>
                  {activeEntry.clockIn}
                </span>
                <span className="settings-card-description country-chip">
                  <span>{countryFlagFromCode(overviewQuery.data.profile.countryCode)}</span>
                  <span>{countryNameFromCode(overviewQuery.data.profile.countryCode)}</span>
                </span>
              </div>
            </article>
          ) : null}

          <article className="compensation-section">
            <header className="announcements-section-header">
              <div>
                <h2 className="section-title">Recent time entries</h2>
                <p className="settings-card-description">
                  Entries include method, break totals, and worked hours.
                </p>
              </div>
            </header>

            {sortedEntries.length === 0 ? (
              <EmptyState
                title="No time entries yet"
                description="Clock-ins will appear here after attendance tracking starts."
                ctaLabel="Back to dashboard"
                ctaHref="/dashboard"
              />
            ) : (
              <div className="data-table-container">
                <table className="data-table" aria-label="Recent time entries">
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
                          Clock in
                          <span className="numeric">{sortDirection === "asc" ? "↑" : "↓"}</span>
                        </button>
                      </th>
                      <th>Clock out</th>
                      <th>Worked</th>
                      <th>Break</th>
                      <th>Method</th>
                      <th>Status</th>
                      <th className="table-action-column">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedEntries.map((entry) => (
                      <tr key={entry.id} className="data-table-row">
                        <td>
                          <span title={formatDateTimeTooltip(entry.clockIn)}>
                            {formatRelativeTime(entry.clockIn)}
                          </span>
                        </td>
                        <td>
                          {entry.clockOut ? (
                            <span title={formatDateTimeTooltip(entry.clockOut)}>
                              {formatRelativeTime(entry.clockOut)}
                            </span>
                          ) : (
                            "--"
                          )}
                        </td>
                        <td className="numeric">{formatHoursFromMinutes(entry.totalMinutes)}h</td>
                        <td className="numeric">{formatHoursFromMinutes(entry.breakMinutes)}h</td>
                        <td>{formatTimeEntryMethod(entry.clockInMethod)}</td>
                        <td>
                          <StatusBadge tone={entry.clockOut ? "success" : "processing"}>
                            {entry.clockOut ? "Closed" : "Open"}
                          </StatusBadge>
                        </td>
                        <td className="table-row-action-cell">
                          <div className="timeatt-row-actions">
                            <button type="button" className="table-row-action">
                              View
                            </button>
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
