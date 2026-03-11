"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight, Move } from "lucide-react";

import { EmptyState } from "../shared/empty-state";
import { formatMonth } from "../../lib/datetime";
import type { ShiftRecord } from "../../types/scheduling";

type CalendarDay = {
  date: string;
  dayOfMonth: number;
  isCurrentMonth: boolean;
  isToday: boolean;
  isInScheduleRange: boolean;
  shifts: ShiftRecord[];
};

type TeamScheduleCalendarProps = {
  shifts: ShiftRecord[];
  scheduleStartDate: string;
  scheduleEndDate: string;
  canManage: boolean;
  onRequestMove: (shift: ShiftRecord, targetDate: string) => void;
  onShiftSelect?: (shift: ShiftRecord) => void;
};

// DAY_NAMES moved inside component for i18n

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function toISO(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function todayISO(): string {
  return toISO(new Date());
}

function monthKey(year: number, month: number): number {
  return year * 12 + month;
}

function formatTime(iso: string): string {
  let hours: number;
  let minutes: number;

  if (iso.includes("T")) {
    const d = new Date(iso);
    hours = d.getUTCHours();
    minutes = d.getUTCMinutes();
  } else {
    const parts = iso.split(":");
    hours = Number(parts[0]);
    minutes = Number(parts[1]);
  }

  const suffix = hours >= 12 ? "PM" : "AM";
  const h12 = hours % 12 || 12;
  return minutes === 0 ? `${h12}${suffix}` : `${h12}:${pad2(minutes)}${suffix}`;
}

function shiftSortKey(shift: ShiftRecord): string {
  const employee = shift.employeeName?.toLowerCase() ?? "zzzzzz";
  return `${shift.startTime}-${employee}-${shift.id}`;
}

function buildCalendarDays({
  year,
  month,
  shifts,
  scheduleStartDate,
  scheduleEndDate
}: {
  year: number;
  month: number;
  shifts: ShiftRecord[];
  scheduleStartDate: string;
  scheduleEndDate: string;
}): CalendarDay[] {
  const today = todayISO();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);

  // Monday-based: 0=Mon, 6=Sun
  let startDow = firstDay.getDay() - 1;
  if (startDow < 0) startDow = 6;

  const shiftsByDate = new Map<string, ShiftRecord[]>();
  for (const shift of shifts) {
    const existing = shiftsByDate.get(shift.shiftDate) ?? [];
    existing.push(shift);
    shiftsByDate.set(shift.shiftDate, existing);
  }

  for (const [date, dayShifts] of shiftsByDate.entries()) {
    shiftsByDate.set(
      date,
      [...dayShifts].sort((a, b) => shiftSortKey(a).localeCompare(shiftSortKey(b)))
    );
  }

  const days: CalendarDay[] = [];

  // Leading days from previous month
  const prevMonthLast = new Date(year, month, 0);
  for (let i = startDow - 1; i >= 0; i--) {
    const d = new Date(prevMonthLast);
    d.setDate(prevMonthLast.getDate() - i);
    const iso = toISO(d);
    days.push({
      date: iso,
      dayOfMonth: d.getDate(),
      isCurrentMonth: false,
      isToday: iso === today,
      isInScheduleRange: iso >= scheduleStartDate && iso <= scheduleEndDate,
      shifts: shiftsByDate.get(iso) ?? []
    });
  }

  // Current month days
  for (let d = 1; d <= lastDay.getDate(); d++) {
    const iso = `${year}-${pad2(month + 1)}-${pad2(d)}`;
    days.push({
      date: iso,
      dayOfMonth: d,
      isCurrentMonth: true,
      isToday: iso === today,
      isInScheduleRange: iso >= scheduleStartDate && iso <= scheduleEndDate,
      shifts: shiftsByDate.get(iso) ?? []
    });
  }

  // Trailing days
  const remaining = 7 - (days.length % 7);
  if (remaining < 7) {
    for (let i = 1; i <= remaining; i++) {
      const d = new Date(year, month + 1, i);
      const iso = toISO(d);
      days.push({
        date: iso,
        dayOfMonth: d.getDate(),
        isCurrentMonth: false,
        isToday: iso === today,
        isInScheduleRange: iso >= scheduleStartDate && iso <= scheduleEndDate,
        shifts: shiftsByDate.get(iso) ?? []
      });
    }
  }

  return days;
}

function statusClass(status: ShiftRecord["status"]): string {
  switch (status) {
    case "swap_requested":
      return "teamcal-shift-swap-requested";
    case "swapped":
      return "teamcal-shift-swapped";
    case "cancelled":
      return "teamcal-shift-cancelled";
    default:
      return "teamcal-shift-scheduled";
  }
}

export function TeamScheduleCalendar({
  shifts,
  scheduleStartDate,
  scheduleEndDate,
  canManage,
  onRequestMove,
  onShiftSelect
}: TeamScheduleCalendarProps) {
  const t = useTranslations("scheduling");
  const scheduleStart = new Date(`${scheduleStartDate}T00:00:00`);
  const scheduleEnd = new Date(`${scheduleEndDate}T00:00:00`);

  const [viewYear, setViewYear] = useState(scheduleStart.getFullYear());
  const [viewMonth, setViewMonth] = useState(scheduleStart.getMonth());
  const [draggingShiftId, setDraggingShiftId] = useState<string | null>(null);
  const [dragTargetDate, setDragTargetDate] = useState<string | null>(null);

  const calendarDays = useMemo(
    () =>
      buildCalendarDays({
        year: viewYear,
        month: viewMonth,
        shifts,
        scheduleStartDate,
        scheduleEndDate
      }),
    [viewYear, viewMonth, shifts, scheduleStartDate, scheduleEndDate]
  );

  const dayNames = useMemo(() => [
    t("myCalendar.dayMon"), t("myCalendar.dayTue"), t("myCalendar.dayWed"),
    t("myCalendar.dayThu"), t("myCalendar.dayFri"), t("myCalendar.daySat"), t("myCalendar.daySun")
  ], [t]);

  const shiftById = useMemo(() => new Map(shifts.map((shift) => [shift.id, shift] as const)), [shifts]);

  const monthLabel = useMemo(() => {
    return formatMonth(`${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-01`);
  }, [viewYear, viewMonth]);

  const canGoPrev = monthKey(viewYear, viewMonth) > monthKey(scheduleStart.getFullYear(), scheduleStart.getMonth());
  const canGoNext = monthKey(viewYear, viewMonth) < monthKey(scheduleEnd.getFullYear(), scheduleEnd.getMonth());

  const goToPrevMonth = () => {
    if (!canGoPrev) return;
    setViewMonth((m) => {
      if (m === 0) {
        setViewYear((y) => y - 1);
        return 11;
      }
      return m - 1;
    });
  };

  const goToNextMonth = () => {
    if (!canGoNext) return;
    setViewMonth((m) => {
      if (m === 11) {
        setViewYear((y) => y + 1);
        return 0;
      }
      return m + 1;
    });
  };

  const weeks: CalendarDay[][] = [];
  for (let i = 0; i < calendarDays.length; i += 7) {
    weeks.push(calendarDays.slice(i, i + 7));
  }

  if (shifts.length === 0) {
    return (
      <EmptyState
        icon={<Move size={32} />}
        title={t("calendar.noPublishedTitle")}
        description={t("calendar.noPublishedDescription")}
        ctaLabel={t("calendar.manageSchedules")}
        ctaHref="/scheduling?tab=manage"
      />
    );
  }

  return (
    <div className="mycal teamcal">
      <div className="mycal-nav">
        <button
          type="button"
          className="icon-button"
          onClick={goToPrevMonth}
          aria-label={t("myCalendar.previousMonth")}
          disabled={!canGoPrev}
        >
          <ChevronLeft size={18} />
        </button>
        <h3 className="mycal-month-label">{monthLabel}</h3>
        <button
          type="button"
          className="icon-button"
          onClick={goToNextMonth}
          aria-label={t("myCalendar.nextMonth")}
          disabled={!canGoNext}
        >
          <ChevronRight size={18} />
        </button>
      </div>

      <div className="mycal-grid mycal-day-names">
        {dayNames.map((name) => (
          <div key={name} className="mycal-day-name">{name}</div>
        ))}
      </div>

      <div className="mycal-body">
        {weeks.map((week) => (
          <div key={week[0]!.date} className="mycal-grid mycal-week">
            {week.map((day) => (
              <div
                key={day.date}
                className={[
                  "mycal-cell",
                  !day.isCurrentMonth && "mycal-cell-muted",
                  day.isToday && "mycal-cell-today",
                  !day.isInScheduleRange && "teamcal-cell-outside-range",
                  day.shifts.length > 0 && "mycal-cell-has-shift",
                  canManage && day.isInScheduleRange && dragTargetDate === day.date && "teamcal-drop-target"
                ]
                  .filter(Boolean)
                  .join(" ")}
                onDragOver={(event) => {
                  if (!canManage || !day.isInScheduleRange || !draggingShiftId) return;
                  event.preventDefault();
                  setDragTargetDate(day.date);
                }}
                onDragLeave={() => {
                  if (dragTargetDate === day.date) {
                    setDragTargetDate(null);
                  }
                }}
                onDrop={(event) => {
                  if (!canManage || !day.isInScheduleRange || !draggingShiftId) return;
                  event.preventDefault();

                  const shift = shiftById.get(draggingShiftId);
                  if (!shift || shift.shiftDate === day.date) {
                    setDragTargetDate(null);
                    setDraggingShiftId(null);
                    return;
                  }

                  onRequestMove(shift, day.date);
                  setDragTargetDate(null);
                  setDraggingShiftId(null);
                }}
              >
                <span className="mycal-date-number">{day.dayOfMonth}</span>

                {day.shifts.map((shift) => {
                  const isDraggable = canManage && shift.status !== "cancelled";
                  const isSelectable = Boolean(onShiftSelect);
                  const shiftTimeLabel = `${formatTime(shift.startTime)} - ${formatTime(shift.endTime)}`;
                  return (
                    <article
                      key={shift.id}
                      className={`teamcal-shift ${statusClass(shift.status)} ${isDraggable ? "teamcal-shift-draggable" : ""} ${isSelectable ? "teamcal-shift-selectable" : ""}`}
                      draggable={isDraggable}
                      onDragStart={() => {
                        if (!isDraggable) return;
                        setDraggingShiftId(shift.id);
                      }}
                      onDragEnd={() => {
                        setDraggingShiftId(null);
                        setDragTargetDate(null);
                      }}
                      onClick={() => {
                        if (!onShiftSelect) return;
                        onShiftSelect(shift);
                      }}
                      onKeyDown={(event) => {
                        if (!onShiftSelect) return;
                        if (event.key !== "Enter" && event.key !== " ") return;
                        event.preventDefault();
                        onShiftSelect(shift);
                      }}
                      role={isSelectable ? "button" : undefined}
                      tabIndex={isSelectable ? 0 : undefined}
                      style={isSelectable ? { cursor: "pointer" } : undefined}
                      title={`${shift.employeeName ?? t("calendar.openShift")} · ${formatTime(shift.startTime)}–${formatTime(shift.endTime)}`}
                    >
                      <span className="teamcal-shift-name">{shift.employeeName ?? t("calendar.openShift")}</span>
                      <span className="teamcal-shift-time">
                        {shiftTimeLabel}
                      </span>
                    </article>
                  );
                })}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
