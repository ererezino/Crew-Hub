"use client";

import { useMemo, useState } from "react";

import { EmptyState } from "../../../../components/shared/empty-state";
import { PageHeader } from "../../../../components/shared/page-header";
import { StatusBadge } from "../../../../components/shared/status-badge";
import { useTimeOffCalendar } from "../../../../hooks/use-time-off";
import { countryFlagFromCode, countryNameFromCode } from "../../../../lib/countries";
import { formatDateTimeTooltip } from "../../../../lib/datetime";
import {
  enumerateIsoDatesInRange,
  formatLeaveTypeLabel,
  getCurrentMonthKey,
  isoDateToUtcDate,
  monthToDateRange
} from "../../../../lib/time-off";

type CalendarCell = {
  dateKey: string;
  dayNumber: number;
  isCurrentMonth: boolean;
};

function shiftMonth(month: string, delta: number): string {
  const range = monthToDateRange(month);

  if (!range) {
    return getCurrentMonthKey();
  }

  const startDate = isoDateToUtcDate(range.startDate);

  if (!startDate) {
    return getCurrentMonthKey();
  }

  const nextDate = new Date(startDate.getTime());
  nextDate.setUTCMonth(nextDate.getUTCMonth() + delta);

  const year = nextDate.getUTCFullYear();
  const monthValue = String(nextDate.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${monthValue}`;
}

function monthLabel(month: string): string {
  const range = monthToDateRange(month);

  if (!range) {
    return month;
  }

  const monthStart = isoDateToUtcDate(range.startDate);

  if (!monthStart) {
    return month;
  }

  return monthStart.toLocaleString(undefined, {
    month: "long",
    year: "numeric",
    timeZone: "UTC"
  });
}

function buildCalendarCells(month: string): CalendarCell[] {
  const range = monthToDateRange(month);

  if (!range) {
    return [];
  }

  const monthStart = isoDateToUtcDate(range.startDate);
  const monthEnd = isoDateToUtcDate(range.endDate);

  if (!monthStart || !monthEnd) {
    return [];
  }

  const leadingDays = monthStart.getUTCDay();
  const trailingDays = 6 - monthEnd.getUTCDay();

  const gridStart = new Date(monthStart.getTime());
  gridStart.setUTCDate(gridStart.getUTCDate() - leadingDays);

  const gridEnd = new Date(monthEnd.getTime());
  gridEnd.setUTCDate(gridEnd.getUTCDate() + trailingDays);

  const cells: CalendarCell[] = [];
  const cursor = new Date(gridStart.getTime());

  while (cursor.getTime() <= gridEnd.getTime()) {
    const year = cursor.getUTCFullYear();
    const monthValue = String(cursor.getUTCMonth() + 1).padStart(2, "0");
    const day = String(cursor.getUTCDate()).padStart(2, "0");

    cells.push({
      dateKey: `${year}-${monthValue}-${day}`,
      dayNumber: cursor.getUTCDate(),
      isCurrentMonth: cursor.getUTCMonth() === monthStart.getUTCMonth()
    });

    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return cells;
}

function CalendarSkeleton() {
  return (
    <section className="timeoff-skeleton-layout" aria-hidden="true">
      <div className="timeoff-calendar-skeleton" />
      <div className="timeoff-table-skeleton">
        <div className="timeoff-table-skeleton-header" />
        {Array.from({ length: 4 }, (_, index) => (
          <div key={`timeoff-calendar-row-${index}`} className="timeoff-table-skeleton-row" />
        ))}
      </div>
    </section>
  );
}

export function TimeOffCalendarClient() {
  const [activeMonth, setActiveMonth] = useState(getCurrentMonthKey());
  const [selectedCountryCode, setSelectedCountryCode] = useState("");
  const [selectedDepartment, setSelectedDepartment] = useState("");

  const calendarQuery = useTimeOffCalendar({
    month: activeMonth,
    countryCode: selectedCountryCode || undefined,
    department: selectedDepartment || undefined
  });

  const calendarCells = useMemo(() => buildCalendarCells(activeMonth), [activeMonth]);

  const holidayNamesByDate = useMemo(() => {
    const map = new Map<string, string[]>();

    for (const holiday of calendarQuery.data?.holidays ?? []) {
      const existingNames = map.get(holiday.date) ?? [];
      existingNames.push(holiday.name);
      map.set(holiday.date, existingNames);
    }

    return map;
  }, [calendarQuery.data?.holidays]);

  const requestCountByDate = useMemo(() => {
    const map = new Map<string, number>();
    const monthRange = monthToDateRange(activeMonth);

    if (!monthRange) {
      return map;
    }

    for (const request of calendarQuery.data?.requests ?? []) {
      const rangeStart =
        request.startDate > monthRange.startDate ? request.startDate : monthRange.startDate;
      const rangeEnd =
        request.endDate < monthRange.endDate ? request.endDate : monthRange.endDate;

      if (rangeStart > rangeEnd) {
        continue;
      }

      for (const dateKey of enumerateIsoDatesInRange(rangeStart, rangeEnd)) {
        const currentCount = map.get(dateKey) ?? 0;
        map.set(dateKey, currentCount + 1);
      }
    }

    return map;
  }, [activeMonth, calendarQuery.data?.requests]);

  if (calendarQuery.isLoading) {
    return (
      <>
        <PageHeader
          title="Time Off Calendar"
          description="Team leave calendar with monthly view and scoped filters."
        />
        <CalendarSkeleton />
      </>
    );
  }

  if (calendarQuery.errorMessage || !calendarQuery.data) {
    return (
      <>
        <PageHeader
          title="Time Off Calendar"
          description="Team leave calendar with monthly view and scoped filters."
        />
        <EmptyState
          title="Calendar data is unavailable"
          description={calendarQuery.errorMessage ?? "Unable to load team calendar."}
          ctaLabel="Retry"
          ctaHref="/time-off/calendar"
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Time Off Calendar"
        description="Team leave calendar with monthly view and scoped filters."
      />

      <section className="settings-card" aria-label="Calendar filters">
        <header className="timeoff-section-header">
          <h2 className="section-title">Filters</h2>
          <div className="timeoff-month-controls">
            <button
              type="button"
              className="button"
              onClick={() => setActiveMonth((currentMonth) => shiftMonth(currentMonth, -1))}
            >
              Previous
            </button>
            <p className="numeric">{monthLabel(activeMonth)}</p>
            <button
              type="button"
              className="button"
              onClick={() => setActiveMonth((currentMonth) => shiftMonth(currentMonth, 1))}
            >
              Next
            </button>
          </div>
        </header>

        <div className="timeoff-filter-grid">
          <label className="form-field" htmlFor="timeoff-calendar-country">
            <span className="form-label">Country</span>
            <select
              id="timeoff-calendar-country"
              className="form-input"
              value={selectedCountryCode}
              onChange={(event) => setSelectedCountryCode(event.currentTarget.value)}
            >
              <option value="">All countries</option>
              {calendarQuery.data.filters.countries.map((countryCode) => (
                <option key={countryCode} value={countryCode}>
                  {countryNameFromCode(countryCode)}
                </option>
              ))}
            </select>
          </label>

          <label className="form-field" htmlFor="timeoff-calendar-department">
            <span className="form-label">Department</span>
            <select
              id="timeoff-calendar-department"
              className="form-input"
              value={selectedDepartment}
              onChange={(event) => setSelectedDepartment(event.currentTarget.value)}
            >
              <option value="">All departments</option>
              {calendarQuery.data.filters.departments.map((department) => (
                <option key={department} value={department}>
                  {department}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <section className="settings-card" aria-label="Monthly team calendar">
        <h2 className="section-title">Monthly View</h2>

        <div className="timeoff-mini-calendar">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((label) => (
            <p key={label} className="timeoff-calendar-weekday">
              {label}
            </p>
          ))}
          {calendarCells.map((cell) => {
            const holidayNames = holidayNamesByDate.get(cell.dateKey) ?? [];
            const requestCount = requestCountByDate.get(cell.dateKey) ?? 0;
            const className = [
              "timeoff-calendar-day",
              cell.isCurrentMonth ? "timeoff-calendar-day-current" : "timeoff-calendar-day-muted",
              requestCount > 0 ? "timeoff-calendar-day-approved" : "",
              holidayNames.length > 0 ? "timeoff-calendar-day-pending" : ""
            ]
              .filter(Boolean)
              .join(" ");

            return (
              <article key={cell.dateKey} className={className}>
                <p className="numeric">{cell.dayNumber}</p>
                {holidayNames.length > 0 ? (
                  <p className="timeoff-calendar-note" title={holidayNames.join(", ")}>
                    Holiday
                  </p>
                ) : null}
                {requestCount > 0 ? (
                  <p className="timeoff-calendar-note numeric">{requestCount} requests</p>
                ) : null}
              </article>
            );
          })}
        </div>
      </section>

      <section className="settings-card" aria-label="Monthly leave entries">
        <header className="timeoff-section-header">
          <h2 className="section-title">Entries This Month</h2>
          <StatusBadge tone="processing">
            {calendarQuery.data.requests.length} requests
          </StatusBadge>
        </header>

        {calendarQuery.data.requests.length === 0 ? (
          <EmptyState
            title="No leave entries for this month"
            description="Adjust month or filters to view more calendar entries."
            ctaLabel="Open Time Off"
            ctaHref="/time-off"
          />
        ) : (
          <ul className="timeoff-calendar-entry-list">
            {calendarQuery.data.requests.map((requestRecord) => (
              <li key={requestRecord.id} className="timeoff-calendar-entry-card">
                <div>
                  <p className="timeoff-calendar-entry-title">{requestRecord.employeeName}</p>
                  <p className="settings-card-description">
                    {requestRecord.employeeDepartment ?? "No department"} •{" "}
                    {countryFlagFromCode(requestRecord.employeeCountryCode)}{" "}
                    {countryNameFromCode(requestRecord.employeeCountryCode)}
                  </p>
                </div>
                <div className="timeoff-calendar-entry-meta">
                  <StatusBadge tone={requestRecord.status === "approved" ? "success" : "pending"}>
                    {requestRecord.status}
                  </StatusBadge>
                  <p className="settings-card-description">{formatLeaveTypeLabel(requestRecord.leaveType)}</p>
                  <p className="settings-card-description">
                    <time
                      dateTime={requestRecord.startDate}
                      title={formatDateTimeTooltip(requestRecord.startDate)}
                    >
                      {requestRecord.startDate}
                    </time>
                    {" - "}
                    <time
                      dateTime={requestRecord.endDate}
                      title={formatDateTimeTooltip(requestRecord.endDate)}
                    >
                      {requestRecord.endDate}
                    </time>
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
