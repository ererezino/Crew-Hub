"use client";

import { useCallback, useMemo, useState } from "react";

import { EmptyState } from "../../../../components/shared/empty-state";
import { ErrorState } from "../../../../components/shared/error-state";
import { PageHeader } from "../../../../components/shared/page-header";
import { SlidePanel } from "../../../../components/shared/slide-panel";
import { StatusBadge } from "../../../../components/shared/status-badge";
import { useTimeOffCalendar } from "../../../../hooks/use-time-off";
import { countryFlagFromCode, countryNameFromCode } from "../../../../lib/countries";
import { formatDateRangeHuman, formatDateTimeTooltip } from "../../../../lib/datetime";
import { formatLeaveStatus } from "../../../../lib/format-labels";
import type { UserRole } from "../../../../lib/navigation";
import { hasRole } from "../../../../lib/roles";
import {
  enumerateIsoDatesInRange,
  formatLeaveTypeLabel,
  getCurrentMonthKey,
  isoDateToUtcDate,
  monthToDateRange
} from "../../../../lib/time-off";
import type { AfkCalendarRecord, LeaveRequestRecord } from "../../../../types/time-off";

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
      <div className="table-skeleton">
        <div className="table-skeleton-header" />
        {Array.from({ length: 4 }, (_, index) => (
          <div key={`timeoff-calendar-row-${index}`} className="table-skeleton-row" />
        ))}
      </div>
    </section>
  );
}

export function TimeOffCalendarClient({
  embedded = false,
  userRoles
}: {
  embedded?: boolean;
  userRoles?: UserRole[];
}) {
  const [activeMonth, setActiveMonth] = useState(getCurrentMonthKey());
  const [selectedCountryCode, setSelectedCountryCode] = useState("");
  const [selectedDepartment, setSelectedDepartment] = useState("");
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const canViewDayDetails =
    hasRole(userRoles ?? [], "SUPER_ADMIN") || hasRole(userRoles ?? [], "HR_ADMIN");

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

      if (!existingNames.includes(holiday.name)) {
        existingNames.push(holiday.name);
      }

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

  const afkCountByDate = useMemo(() => {
    const map = new Map<string, number>();

    for (const afkLog of calendarQuery.data?.afkLogs ?? []) {
      const currentCount = map.get(afkLog.date) ?? 0;
      map.set(afkLog.date, currentCount + 1);
    }

    return map;
  }, [calendarQuery.data?.afkLogs]);

  const requestsByDate = useMemo(() => {
    const map = new Map<string, LeaveRequestRecord[]>();
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
        const existing = map.get(dateKey) ?? [];
        existing.push(request);
        map.set(dateKey, existing);
      }
    }

    return map;
  }, [activeMonth, calendarQuery.data?.requests]);

  const afkByDate = useMemo(() => {
    const map = new Map<string, AfkCalendarRecord[]>();

    for (const afkLog of calendarQuery.data?.afkLogs ?? []) {
      const existing = map.get(afkLog.date) ?? [];
      existing.push(afkLog);
      map.set(afkLog.date, existing);
    }

    return map;
  }, [calendarQuery.data?.afkLogs]);

  const closePanel = useCallback(() => setSelectedDay(null), []);

  if (calendarQuery.isLoading) {
    return (
      <>
        {!embedded ? (
          <PageHeader
            title="Time Off Calendar"
            description="Team leave calendar with monthly view and scoped filters."
          />
        ) : null}
        <CalendarSkeleton />
      </>
    );
  }

  if (calendarQuery.errorMessage || !calendarQuery.data) {
    return (
      <>
        {!embedded ? (
          <PageHeader
            title="Time Off Calendar"
            description="Team leave calendar with monthly view and scoped filters."
          />
        ) : null}
        <ErrorState
          title="Calendar data is unavailable"
          message={calendarQuery.errorMessage ?? "Unable to load team calendar."}
        />
      </>
    );
  }

  const monthlyEntryCount = calendarQuery.data.requests.length + calendarQuery.data.afkLogs.length;

  return (
    <>
      {!embedded ? (
        <PageHeader
          title="Time Off Calendar"
          description="Team leave calendar with monthly view and scoped filters."
        />
      ) : null}

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
            const afkCount = afkCountByDate.get(cell.dateKey) ?? 0;
            const isHoliday = holidayNames.length > 0;
            const hasLeave = requestCount > 0;
            const hasAfk = afkCount > 0;
            const entryCount = requestCount + afkCount;
            const className = [
              "timeoff-calendar-day",
              cell.isCurrentMonth ? "timeoff-calendar-day-current" : "timeoff-calendar-day-muted",
              hasLeave ? "timeoff-calendar-day-approved" : "",
              hasAfk ? "timeoff-calendar-day-afk" : "",
              isHoliday ? "timeoff-calendar-day-holiday" : ""
            ]
              .filter(Boolean)
              .join(" ");

            const isClickable = canViewDayDetails && (hasLeave || hasAfk || isHoliday) && cell.isCurrentMonth;

            return (
              <article
                key={cell.dateKey}
                className={className + (isClickable ? " timeoff-calendar-day-clickable" : "")}
                title={isHoliday ? holidayNames.join(", ") : undefined}
                onClick={isClickable ? () => setSelectedDay(cell.dateKey) : undefined}
                role={isClickable ? "button" : undefined}
                tabIndex={isClickable ? 0 : undefined}
                onKeyDown={
                  isClickable
                    ? (e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setSelectedDay(cell.dateKey);
                        }
                      }
                    : undefined
                }
              >
                <p className="numeric">{cell.dayNumber}</p>
                <span className="timeoff-calendar-dots">
                  {hasLeave ? <span className="timeoff-calendar-badge timeoff-calendar-badge-approved" /> : null}
                  {hasAfk ? <span className="timeoff-calendar-badge timeoff-calendar-badge-afk" /> : null}
                  {isHoliday ? <span className="timeoff-calendar-badge timeoff-calendar-badge-holiday" /> : null}
                </span>
                {entryCount > 1 ? (
                  <p className="timeoff-calendar-note numeric">{entryCount}</p>
                ) : null}
              </article>
            );
          })}

          <div className="timeoff-calendar-legend">
            <div className="timeoff-calendar-legend-item">
              <span className="timeoff-calendar-badge timeoff-calendar-badge-approved" />
              <span>Leave</span>
            </div>
            <div className="timeoff-calendar-legend-item">
              <span className="timeoff-calendar-badge timeoff-calendar-badge-afk" />
              <span>AFK</span>
            </div>
            <div className="timeoff-calendar-legend-item">
              <span className="timeoff-calendar-badge timeoff-calendar-badge-holiday" />
              <span>Public holiday</span>
            </div>
          </div>
        </div>
      </section>

      <section className="settings-card" aria-label="Monthly leave and AFK entries">
        <header className="timeoff-section-header">
          <h2 className="section-title">Entries This Month</h2>
          <StatusBadge tone="processing">
            {monthlyEntryCount} {monthlyEntryCount === 1 ? "entry" : "entries"}
          </StatusBadge>
        </header>

        {monthlyEntryCount === 0 ? (
          <EmptyState
            title="No leave or AFK entries for this month"
            description="Adjust month or filters to view more calendar activity."
            ctaLabel="Open Time Off"
            ctaHref="/time-off"
          />
        ) : (
          <>
            {calendarQuery.data.requests.length > 0 ? (
              <ul className="timeoff-calendar-entry-list">
                {calendarQuery.data.requests.map((requestRecord) => (
                  <li key={requestRecord.id} className="timeoff-calendar-entry-card">
                    <div>
                      <p className="timeoff-calendar-entry-title">{requestRecord.employeeName}</p>
                      <p className="settings-card-description">
                        {requestRecord.employeeDepartment ?? ""} •{" "}
                        {countryFlagFromCode(requestRecord.employeeCountryCode)}{" "}
                        {countryNameFromCode(requestRecord.employeeCountryCode)}
                      </p>
                    </div>
                    <div className="timeoff-calendar-entry-meta">
                      <StatusBadge tone={requestRecord.status === "approved" ? "success" : "pending"}>
                        {formatLeaveStatus(requestRecord.status)}
                      </StatusBadge>
                      <p className="settings-card-description">{formatLeaveTypeLabel(requestRecord.leaveType)}</p>
                      <p className="settings-card-description">
                        <time
                          dateTime={requestRecord.startDate}
                          title={formatDateTimeTooltip(requestRecord.startDate)}
                        >
                          {formatDateRangeHuman(requestRecord.startDate, requestRecord.endDate)}
                        </time>
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}

            {calendarQuery.data.afkLogs.length > 0 ? (
              <ul className="timeoff-calendar-entry-list">
                {calendarQuery.data.afkLogs.map((afkLog) => (
                  <li key={afkLog.id} className="timeoff-calendar-entry-card">
                    <div>
                      <p className="timeoff-calendar-entry-title">{afkLog.employeeName}</p>
                      <p className="settings-card-description">
                        {afkLog.employeeDepartment ?? ""} •{" "}
                        {countryFlagFromCode(afkLog.employeeCountryCode)}{" "}
                        {countryNameFromCode(afkLog.employeeCountryCode)}
                      </p>
                    </div>
                    <div className="timeoff-calendar-entry-meta">
                      <StatusBadge tone="info">AFK</StatusBadge>
                      <p className="settings-card-description">
                        <time dateTime={afkLog.date} title={formatDateTimeTooltip(afkLog.date)}>
                          {formatDateRangeHuman(afkLog.date, afkLog.date)}
                        </time>{" "}
                        · {afkLog.startTime}-{afkLog.endTime}
                      </p>
                      <p className="settings-card-description numeric">{afkLog.durationMinutes} min</p>
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        )}
      </section>

      {selectedDay ? (
        <SlidePanel
          isOpen={Boolean(selectedDay)}
          title={new Date(selectedDay + "T00:00:00Z").toLocaleDateString("en-US", {
            weekday: "long",
            month: "long",
            day: "numeric",
            timeZone: "UTC"
          })}
          description="Who's away or AFK this day"
          onClose={closePanel}
        >
          {(holidayNamesByDate.get(selectedDay) ?? []).length > 0 ? (
            <div className="timeoff-panel-holidays">
              {(holidayNamesByDate.get(selectedDay) ?? []).map((name, i) => (
                <div key={i} className="timeoff-panel-holiday-badge">
                  <span className="timeoff-calendar-badge timeoff-calendar-badge-holiday" />
                  <span>{name}</span>
                </div>
              ))}
            </div>
          ) : null}

          {(requestsByDate.get(selectedDay) ?? []).length > 0 ? (
            <ul className="timeoff-calendar-entry-list">
              {(requestsByDate.get(selectedDay) ?? []).map((req) => (
                <li key={req.id} className="timeoff-calendar-entry-card">
                  <div>
                    <p className="timeoff-calendar-entry-title">{req.employeeName}</p>
                    <p className="settings-card-description">
                      {req.employeeDepartment ?? ""} •{" "}
                      {countryFlagFromCode(req.employeeCountryCode)}{" "}
                      {countryNameFromCode(req.employeeCountryCode)}
                    </p>
                  </div>
                  <div className="timeoff-calendar-entry-meta">
                    <StatusBadge tone={req.status === "approved" ? "success" : "pending"}>
                      {formatLeaveTypeLabel(req.leaveType)}
                    </StatusBadge>
                    <p className="settings-card-description">
                      <time dateTime={req.startDate} title={formatDateTimeTooltip(req.startDate)}>
                        {formatDateRangeHuman(req.startDate, req.endDate)}
                      </time>
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}

          {(afkByDate.get(selectedDay) ?? []).length > 0 ? (
            <ul className="timeoff-calendar-entry-list">
              {(afkByDate.get(selectedDay) ?? []).map((afkLog) => (
                <li key={afkLog.id} className="timeoff-calendar-entry-card">
                  <div>
                    <p className="timeoff-calendar-entry-title">{afkLog.employeeName}</p>
                    <p className="settings-card-description">
                      {afkLog.employeeDepartment ?? ""} •{" "}
                      {countryFlagFromCode(afkLog.employeeCountryCode)}{" "}
                      {countryNameFromCode(afkLog.employeeCountryCode)}
                    </p>
                  </div>
                  <div className="timeoff-calendar-entry-meta">
                    <StatusBadge tone="info">AFK</StatusBadge>
                    <p className="settings-card-description">
                      <time dateTime={afkLog.date} title={formatDateTimeTooltip(afkLog.date)}>
                        {formatDateRangeHuman(afkLog.date, afkLog.date)}
                      </time>{" "}
                      · {afkLog.startTime}-{afkLog.endTime}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}

          {(requestsByDate.get(selectedDay) ?? []).length === 0 &&
          (afkByDate.get(selectedDay) ?? []).length === 0 ? (
            <p className="settings-card-description">No leave or AFK entries on this day.</p>
          ) : null}
        </SlidePanel>
      ) : null}
    </>
  );
}
