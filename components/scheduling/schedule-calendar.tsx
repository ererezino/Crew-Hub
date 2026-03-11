"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { CalendarClock } from "lucide-react";

import { EmptyState } from "../shared/empty-state";
import { formatDate } from "../../lib/datetime";
import type { ShiftRecord } from "../../types/scheduling";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type WeekRow = {
  label: string; // "March 2, 2026 → March 6, 2026"
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  slotAssignments: Map<string, ShiftRecord[]>; // slotKey → shifts
  notes: string[]; // OOO or other notes
};

type ScheduleCalendarProps = {
  shifts: ShiftRecord[];
  startDate: string; // YYYY-MM-DD  of the schedule
  endDate: string; // YYYY-MM-DD  of the schedule
  scheduleTrack: "weekday" | "weekend";
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isoToDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y!, m! - 1, d!);
}

function formatMonthDay(iso: string): string {
  return formatDate(iso);
}

/** Group shifts into week-long rows (Mon–Fri for weekday, Sat–Sun for weekend). */
function buildWeekRows(
  shifts: ShiftRecord[],
  startDate: string,
  endDate: string,
  track: "weekday" | "weekend"
): WeekRow[] {
  const start = isoToDate(startDate);
  const end = isoToDate(endDate);
  const rows: WeekRow[] = [];

  // Advance to the first relevant day
  let cursor = new Date(start);

  while (cursor <= end) {
    const dayOfWeek = cursor.getDay(); // 0=Sun, 1=Mon, …, 6=Sat

    if (track === "weekday") {
      // Jump to next Monday if we're on a weekend
      if (dayOfWeek === 0) { cursor.setDate(cursor.getDate() + 1); continue; }
      if (dayOfWeek === 6) { cursor.setDate(cursor.getDate() + 2); continue; }

      // Find start of this work week (Monday)
      const weekStart = new Date(cursor);
      weekStart.setDate(weekStart.getDate() - (dayOfWeek - 1));
      if (weekStart < start) weekStart.setTime(start.getTime());

      // Find end of this work week (Friday)
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + (4 - (weekStart.getDay() - 1)));
      if (weekEnd > end) weekEnd.setTime(end.getTime());

      const wsISO = weekStart.toISOString().slice(0, 10);
      const weISO = weekEnd.toISOString().slice(0, 10);

      rows.push({
        label: `${formatMonthDay(wsISO)} → ${formatMonthDay(weISO)}`,
        startDate: wsISO,
        endDate: weISO,
        slotAssignments: new Map(),
        notes: []
      });

      // Jump past this week
      cursor = new Date(weekEnd);
      cursor.setDate(cursor.getDate() + 1);
    } else {
      // Weekend: find Sat–Sun pair
      if (dayOfWeek >= 1 && dayOfWeek <= 5) {
        // Skip to Saturday
        cursor.setDate(cursor.getDate() + (6 - dayOfWeek));
        continue;
      }

      const weekStart = new Date(cursor);
      if (dayOfWeek === 0) weekStart.setDate(weekStart.getDate() - 1); // backtrack to Sat

      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 1);
      if (weekEnd > end) weekEnd.setTime(end.getTime());

      const wsISO = weekStart.toISOString().slice(0, 10);
      const weISO = weekEnd.toISOString().slice(0, 10);

      rows.push({
        label: `${formatMonthDay(wsISO)} → ${formatMonthDay(weISO)}`,
        startDate: wsISO,
        endDate: weISO,
        slotAssignments: new Map(),
        notes: []
      });

      cursor = new Date(weekEnd);
      cursor.setDate(cursor.getDate() + 1);
    }
  }

  // Distribute shifts into week rows
  for (const shift of shifts) {
    const shiftDate = shift.shiftDate;
    for (const row of rows) {
      if (shiftDate >= row.startDate && shiftDate <= row.endDate) {
        const slotKey = formatSlotKey(shift.startTime, shift.endTime);
        const existing = row.slotAssignments.get(slotKey) ?? [];
        // Avoid duplicate names in same slot for the same week row
        if (!existing.some((s) => s.employeeId === shift.employeeId)) {
          existing.push(shift);
        }
        row.slotAssignments.set(slotKey, existing);
        break;
      }
    }
  }

  return rows;
}

function formatSlotKey(startTime: string, endTime: string): string {
  return `${formatTimeLabel(startTime)} - ${formatTimeLabel(endTime)}`;
}

function formatTimeLabel(iso: string): string {
  // Handle both "HH:MM" and full ISO timestamps
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
  return minutes === 0 ? `${h12} ${suffix}` : `${h12}:${String(minutes).padStart(2, "0")} ${suffix}`;
}

function getInitial(name: string): string {
  return name.charAt(0).toUpperCase();
}

/** Deterministic color from name string */
function avatarColor(name: string): string {
  const colors = [
    "#8B6914", "#5B7553", "#7B5EA7", "#C75B39",
    "#3B7A9E", "#6B4C3B", "#2D6A4F", "#9B5DE5",
    "#E07A5F", "#3D405B", "#457B9D", "#BC6C25"
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length]!;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ScheduleCalendar({
  shifts,
  startDate,
  endDate,
  scheduleTrack
}: ScheduleCalendarProps) {
  const t = useTranslations("scheduling");
  const weekRows = useMemo(
    () => buildWeekRows(shifts, startDate, endDate, scheduleTrack),
    [shifts, startDate, endDate, scheduleTrack]
  );

  // Collect all unique slot keys across all rows, sorted by start time
  const slotKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const row of weekRows) {
      for (const key of row.slotAssignments.keys()) {
        keys.add(key);
      }
    }
    return [...keys].sort((a, b) => a.localeCompare(b));
  }, [weekRows]);

  if (shifts.length === 0) {
    return (
      <EmptyState
        icon={<CalendarClock size={32} />}
        title={t("calendar.noShiftsTitle")}
        description={t("calendar.noShiftsDescription")}
        ctaLabel={t("calendar.manageSchedules")}
        ctaHref="/scheduling?tab=manage"
      />
    );
  }

  return (
    <div className="schedule-calendar-wrapper">
      <div
        className="schedule-calendar"
        style={{ "--slot-count": slotKeys.length || 1 } as React.CSSProperties}
      >
        {/* Header row */}
        <div className="schedule-calendar-header">
          <div className="schedule-calendar-date-col">
            <span className="schedule-calendar-col-icon">&#128197;</span> {t("calendar.dateColumn")}
          </div>
          {slotKeys.map((key) => (
            <div key={key} className="schedule-calendar-slot-col">
              <span className="schedule-calendar-col-icon">&#128101;</span> {key}
            </div>
          ))}
          <div className="schedule-calendar-notes-col">
            {/* eslint-disable-next-line i18next/no-literal-string */}
            <span className="schedule-calendar-col-icon">Aa</span>
          </div>
        </div>

        {/* Week rows */}
        {weekRows.map((row) => (
          <div key={row.startDate} className="schedule-calendar-row">
            <div className="schedule-calendar-date-cell">
              <span className="schedule-calendar-date-range">{row.label}</span>
            </div>

            {slotKeys.map((slotKey) => {
              const employees = row.slotAssignments.get(slotKey) ?? [];
              // Deduplicate by employeeId, keep unique names
              const uniqueMap = new Map<string, ShiftRecord>();
              for (const emp of employees) {
                if (emp.employeeId && !uniqueMap.has(emp.employeeId)) {
                  uniqueMap.set(emp.employeeId, emp);
                }
              }
              const unique = [...uniqueMap.values()];

              return (
                <div key={slotKey} className="schedule-calendar-slot-cell">
                  {unique.map((shift) => (
                    <div key={shift.id} className="schedule-calendar-person">
                      <span
                        className="schedule-calendar-avatar"
                        style={{ backgroundColor: avatarColor(shift.employeeName ?? "?") }}
                      >
                        {getInitial(shift.employeeName ?? "?")}
                      </span>
                      <span className="schedule-calendar-person-name">
                        {shift.employeeName ?? t("calendar.unassigned")}
                      </span>
                    </div>
                  ))}
                </div>
              );
            })}

            <div className="schedule-calendar-notes-cell">
              {row.notes.length > 0
                ? row.notes.map((note, i) => (
                    <div key={`note-${row.startDate}-${i}`} className="schedule-calendar-note">{note}</div>
                  ))
                : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
