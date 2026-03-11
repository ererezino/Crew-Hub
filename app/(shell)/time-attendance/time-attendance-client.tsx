"use client";

import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";

import { EmptyState } from "../../../components/shared/empty-state";
import { PageHeader } from "../../../components/shared/page-header";
import { StatusBadge } from "../../../components/shared/status-badge";
import { useTimeAttendanceOverview } from "../../../hooks/use-time-attendance";
import { countryFlagFromCode, countryNameFromCode } from "../../../lib/countries";
import {
  formatInTimezone,
  formatRelativeTime,
  formatTimeInTimezone
} from "../../../lib/datetime";
import { formatHoursFromMinutes, formatTimeEntryMethod } from "../../../lib/time-attendance";

type AppLocale = "en" | "fr";
type SortDirection = "asc" | "desc";

const FALLBACK_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

function overviewSkeleton() {
  return (
    <section className="timeoff-skeleton-layout" aria-hidden="true">
      <div className="timeoff-balance-skeleton-grid">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={`time-attendance-metric-skeleton-${index}`} className="timeoff-balance-skeleton-card" />
        ))}
      </div>
      <div className="table-skeleton">
        <div className="table-skeleton-header" />
        {Array.from({ length: 6 }, (_, index) => (
          <div key={`time-attendance-row-skeleton-${index}`} className="table-skeleton-row" />
        ))}
      </div>
    </section>
  );
}

export function TimeAttendanceClient() {
  const t = useTranslations('timeAttendance');
  const tCommon = useTranslations('common');
  const locale = useLocale() as AppLocale;

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
        title={t('title')}
        description={t('description')}
      />

      {overviewQuery.isLoading ? overviewSkeleton() : null}

      {!overviewQuery.isLoading && overviewQuery.errorMessage ? (
        <>
          <EmptyState
            title={t('unavailable')}
            description={overviewQuery.errorMessage}
          />
          <button
            type="button"
            className="button button-accent"
            onClick={() => overviewQuery.refresh()}
          >
            {tCommon('retry')}
          </button>
        </>
      ) : null}

      {!overviewQuery.isLoading && !overviewQuery.errorMessage && overviewQuery.data ? (
        <section className="compensation-layout" aria-label={t('overviewAriaLabel')}>
          <article className="metric-grid">
            <article className="metric-card">
              <p className="metric-label">{t('clockStatus')}</p>
              <p className="metric-value numeric">{activeEntry ? t('onShift') : t('offShift')}</p>
              <p className="metric-description">
                {activeEntry
                  ? t('startedAgo', { time: formatRelativeTime(activeEntry.clockIn, locale) })
                  : t('noActiveEntry')}
              </p>
            </article>

            <article className="metric-card">
              <p className="metric-label">{t('workedToday')}</p>
              <p className="metric-value numeric">
                {tCommon('hoursValue', { value: formatHoursFromMinutes(overviewQuery.data.totals.workedMinutesToday) })}
              </p>
              <p className="metric-description numeric">
                {t('breaks', { hours: formatHoursFromMinutes(overviewQuery.data.totals.breakMinutesToday) })}
              </p>
            </article>

            <article className="metric-card">
              <p className="metric-label">{t('weekTotal')}</p>
              <p className="metric-value numeric">
                {tCommon('hoursValue', { value: formatHoursFromMinutes(overviewQuery.data.totals.workedMinutesThisWeek) })}
              </p>
              <p className="metric-description numeric">
                {t('overtime', { hours: formatHoursFromMinutes(overviewQuery.data.totals.overtimeMinutesThisWeek) })}
              </p>
            </article>

            <article className="metric-card">
              <p className="metric-label">{t('pendingTimesheets')}</p>
              <p className="metric-value numeric">{overviewQuery.data.totals.pendingTimesheetCount}</p>
              <p className="metric-description">{t('pendingTimesheetsDescription')}</p>
            </article>
          </article>

          <article className="metric-card">
            <div>
              <h2 className="section-title">{t('currentShift')}</h2>
              <p className="settings-card-description">
                {t('liveClockState', { name: overviewQuery.data.profile.fullName })}
              </p>
            </div>
            {activeEntry ? (
              <StatusBadge tone="processing">{t('clockedIn')}</StatusBadge>
            ) : (
              <StatusBadge tone="draft">{t('clockedOut')}</StatusBadge>
            )}
          </article>

          {activeEntry ? (
            <article className="settings-card">
              <header className="announcement-item-header">
                <div>
                  <h2 className="section-title">{t('activeTimeEntry')}</h2>
                  <p className="settings-card-description">
                    {t('activeTimeEntryDescription', { time: formatRelativeTime(activeEntry.clockIn, locale), method: formatTimeEntryMethod(activeEntry.clockInMethod) })}
                  </p>
                </div>
                <StatusBadge tone="processing">{t('inProgress')}</StatusBadge>
              </header>
              <div className="documents-cell-copy">
                <span className="numeric" title={formatInTimezone(activeEntry.clockIn, overviewQuery.data.profile.timezone ?? FALLBACK_TIMEZONE)}>
                  {formatInTimezone(activeEntry.clockIn, overviewQuery.data.profile.timezone ?? FALLBACK_TIMEZONE)}
                </span>
                <span className="settings-card-description country-chip">
                  <span>{countryFlagFromCode(overviewQuery.data.profile.countryCode)}</span>
                  <span>{countryNameFromCode(overviewQuery.data.profile.countryCode, locale)}</span>
                </span>
              </div>
            </article>
          ) : null}

          <article className="compensation-section">
            <header className="announcements-section-header">
              <div>
                <h2 className="section-title">{t('recentTimeEntries')}</h2>
                <p className="settings-card-description">
                  {t('recentTimeEntriesDescription')}
                </p>
              </div>
            </header>

            {sortedEntries.length === 0 ? (
              <EmptyState
                title={t('noTimeEntries')}
                description={t('noTimeEntriesDescription')}
              />
            ) : (
              <div className="data-table-container">
                <table className="data-table" aria-label={t('recentAriaLabel')}>
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
                          {t('colClockIn')}
                          <span className="numeric">{sortDirection === "asc" ? "↑" : "↓"}</span>
                        </button>
                      </th>
                      <th>{t('colClockOut')}</th>
                      <th>{t('colWorked')}</th>
                      <th>{t('colBreak')}</th>
                      <th>{t('colMethod')}</th>
                      <th>{t('colStatus')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedEntries.map((entry) => {
                      const tz = entry.employeeTimezone ?? overviewQuery.data?.profile.timezone ?? FALLBACK_TIMEZONE;

                      return (
                      <tr key={entry.id} className="data-table-row">
                        <td>
                          <span title={formatInTimezone(entry.clockIn, tz)}>
                            {formatTimeInTimezone(entry.clockIn, tz)}
                          </span>
                        </td>
                        <td>
                          {entry.clockOut ? (
                            <span title={formatInTimezone(entry.clockOut, tz)}>
                              {formatTimeInTimezone(entry.clockOut, tz)}
                            </span>
                          ) : (
                            "--"
                          )}
                        </td>
                        <td className="numeric">{tCommon('hoursValue', { value: formatHoursFromMinutes(entry.totalMinutes) })}</td>
                        <td className="numeric">{tCommon('hoursValue', { value: formatHoursFromMinutes(entry.breakMinutes) })}</td>
                        <td>{formatTimeEntryMethod(entry.clockInMethod)}</td>
                        <td>
                          <StatusBadge tone={entry.clockOut ? "success" : "processing"}>
                            {entry.clockOut ? t('statusClosed') : t('statusOpen')}
                          </StatusBadge>
                        </td>
                      </tr>
                      );
                    })}
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
