"use client";

import { useMemo } from "react";

type PeriodPickerProps = {
  month: string; // YYYY-MM
  months: number; // 1, 2, or 3
  onMonthChange: (month: string) => void;
  onMonthsChange: (months: number) => void;
};

function formatMonthLabel(yyyymm: string): string {
  const [year, mon] = yyyymm.split("-").map(Number);
  const date = new Date(Date.UTC(year!, mon! - 1, 1));
  return date.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

function computeDateRange(month: string, months: number): { startLabel: string; endLabel: string } {
  const [yearStr, monthStr] = month.split("-");
  const year = Number(yearStr);
  const mon = Number(monthStr);

  const startDate = new Date(Date.UTC(year, mon - 1, 1));
  const startLabel = startDate.toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });

  const endMonth = mon + months - 1;
  const endYear = year + Math.floor((endMonth - 1) / 12);
  const endMon = ((endMonth - 1) % 12) + 1;
  const lastDay = new Date(Date.UTC(endYear, endMon, 0)).getUTCDate();
  const endDate = new Date(Date.UTC(endYear, endMon - 1, lastDay));
  const endLabel = endDate.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

  return { startLabel, endLabel };
}

function getDefaultMonth(): string {
  const now = new Date();
  const day = now.getDate();
  let year = now.getFullYear();
  let month = now.getMonth() + 1; // 1-indexed

  if (day >= 15) {
    month++;
    if (month > 12) {
      month = 1;
      year++;
    }
  }

  return `${year}-${String(month).padStart(2, "0")}`;
}

function getMonthOptions(): Array<{ value: string; label: string }> {
  const options: Array<{ value: string; label: string }> = [];
  const now = new Date();
  let year = now.getFullYear();
  let month = now.getMonth() + 1;

  for (let i = 0; i < 6; i++) {
    const value = `${year}-${String(month).padStart(2, "0")}`;
    options.push({ value, label: formatMonthLabel(value) });
    month++;
    if (month > 12) {
      month = 1;
      year++;
    }
  }

  return options;
}

const DURATION_OPTIONS = [
  { value: 1, label: "1 Month" },
  { value: 2, label: "2 Months" },
  { value: 3, label: "3 Months" }
];

export { getDefaultMonth };

export function PeriodPicker({ month, months, onMonthChange, onMonthsChange }: PeriodPickerProps) {
  const monthOptions = useMemo(() => getMonthOptions(), []);
  const range = useMemo(() => computeDateRange(month, months), [month, months]);

  return (
    <div className="schedule-period-picker">
      <div className="schedule-period-field">
        <label className="form-label" htmlFor="schedule-start-month">Starting month</label>
        <select
          id="schedule-start-month"
          className="form-input"
          value={month}
          onChange={(e) => onMonthChange(e.target.value)}
        >
          {monthOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>

      <div className="schedule-period-field">
        <label className="form-label">Duration</label>
        <div className="schedule-duration-options">
          {DURATION_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`schedule-duration-btn ${months === opt.value ? "schedule-duration-btn-selected" : ""}`}
              onClick={() => onMonthsChange(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="schedule-period-summary">
        <span className="schedule-period-range">{range.startLabel} &ndash; {range.endLabel}</span>
      </div>
    </div>
  );
}
