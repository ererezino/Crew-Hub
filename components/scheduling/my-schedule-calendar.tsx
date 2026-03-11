"use client";

import { useCallback, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import type { ShiftRecord, ShiftStatus } from "../../types/scheduling";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CalendarDay = {
  date: string; // YYYY-MM-DD
  dayOfMonth: number;
  isCurrentMonth: boolean;
  isToday: boolean;
  shifts: ShiftRecord[];
};

type MyScheduleCalendarProps = {
  shifts: ShiftRecord[];
  onShiftClick: (shift: ShiftRecord) => void;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function toISO(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function todayISO(): string {
  return toISO(new Date());
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

function statusIndicatorClass(status: ShiftStatus): string {
  switch (status) {
    case "scheduled":
      return "mycal-shift-scheduled";
    case "swap_requested":
      return "mycal-shift-swap-requested";
    case "swapped":
      return "mycal-shift-swapped";
    case "cancelled":
      return "mycal-shift-cancelled";
    default:
      return "";
  }
}

function buildCalendarDays(year: number, month: number, shifts: ShiftRecord[]): CalendarDay[] {
  const today = todayISO();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);

  // Monday-based: 0=Mon, 6=Sun
  let startDow = firstDay.getDay() - 1;
  if (startDow < 0) startDow = 6;

  // Build shift lookup
  const shiftsByDate = new Map<string, ShiftRecord[]>();
  for (const s of shifts) {
    const existing = shiftsByDate.get(s.shiftDate) ?? [];
    existing.push(s);
    shiftsByDate.set(s.shiftDate, existing);
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
      shifts: shiftsByDate.get(iso) ?? []
    });
  }

  // Trailing days to fill last week
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
        shifts: shiftsByDate.get(iso) ?? []
      });
    }
  }

  return days;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function MyScheduleCalendar({ shifts, onShiftClick }: MyScheduleCalendarProps) {
  const now = new Date();
  const [viewYear, setViewYear] = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth()); // 0-indexed

  const calendarDays = useMemo(
    () => buildCalendarDays(viewYear, viewMonth, shifts),
    [viewYear, viewMonth, shifts]
  );

  const monthLabel = useMemo(() => {
    const d = new Date(viewYear, viewMonth, 1);
    return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  }, [viewYear, viewMonth]);

  const goToPrevMonth = useCallback(() => {
    setViewMonth((m) => {
      if (m === 0) { setViewYear((y) => y - 1); return 11; }
      return m - 1;
    });
  }, []);

  const goToNextMonth = useCallback(() => {
    setViewMonth((m) => {
      if (m === 11) { setViewYear((y) => y + 1); return 0; }
      return m + 1;
    });
  }, []);

  const goToToday = useCallback(() => {
    const t = new Date();
    setViewYear(t.getFullYear());
    setViewMonth(t.getMonth());
  }, []);

  const weeks: CalendarDay[][] = [];
  for (let i = 0; i < calendarDays.length; i += 7) {
    weeks.push(calendarDays.slice(i, i + 7));
  }

  return (
    <div className="mycal">
      {/* Navigation */}
      <div className="mycal-nav">
        <button type="button" className="icon-button" onClick={goToPrevMonth} aria-label="Previous month">
          <ChevronLeft size={18} />
        </button>
        <h3 className="mycal-month-label">{monthLabel}</h3>
        <button type="button" className="icon-button" onClick={goToNextMonth} aria-label="Next month">
          <ChevronRight size={18} />
        </button>
        <button type="button" className="button button-ghost mycal-today-btn" onClick={goToToday}>
          Today
        </button>
      </div>

      {/* Day names */}
      <div className="mycal-grid mycal-day-names">
        {DAY_NAMES.map((name) => (
          <div key={name} className="mycal-day-name">{name}</div>
        ))}
      </div>

      {/* Weeks */}
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
                  day.shifts.length > 0 && "mycal-cell-has-shift"
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                <span className="mycal-date-number">{day.dayOfMonth}</span>

                {day.shifts.map((shift) => (
                  <button
                    key={shift.id}
                    type="button"
                    className={`mycal-shift ${statusIndicatorClass(shift.status)}`}
                    onClick={() => onShiftClick(shift)}
                    title={`${formatTime(shift.startTime)} – ${formatTime(shift.endTime)} (${shift.status})`}
                  >
                    <span className="mycal-shift-time">
                      {formatTime(shift.startTime)} – {formatTime(shift.endTime)}
                    </span>
                    {shift.status === "swap_requested" ? (
                      <span className="mycal-shift-badge">Swap pending</span>
                    ) : null}
                  </button>
                ))}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
