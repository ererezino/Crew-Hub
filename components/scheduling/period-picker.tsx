"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";

import { formatMonth, formatDateRange } from "../../lib/datetime";

type PeriodPickerProps = {
  month: string; // YYYY-MM
  months: number; // 0 = custom, 1, 2, or 3
  customStartDate: string; // YYYY-MM-DD
  customEndDate: string; // YYYY-MM-DD
  onMonthChange: (month: string) => void;
  onMonthsChange: (months: number) => void;
  onCustomStartChange: (date: string) => void;
  onCustomEndChange: (date: string) => void;
};

function formatMonthLabel(yyyymm: string): string {
  return formatMonth(yyyymm + "-01");
}

function computeRangeLabel(month: string, months: number): string {
  const [yearStr, monthStr] = month.split("-");
  const year = Number(yearStr);
  const mon = Number(monthStr);

  const startISO = `${year}-${String(mon).padStart(2, "0")}-01`;

  const endMonth = mon + months - 1;
  const endYear = year + Math.floor((endMonth - 1) / 12);
  const endMon = ((endMonth - 1) % 12) + 1;
  const lastDay = new Date(Date.UTC(endYear, endMon, 0)).getUTCDate();
  const endISO = `${endYear}-${String(endMon).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

  return formatDateRange(startISO, endISO);
}

function formatCustomRangeLabel(start: string, end: string): string {
  if (!start || !end) return "";
  return formatDateRange(start, end);
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

function getDefaultCustomStart(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function getDefaultCustomEnd(): string {
  const now = new Date();
  const end = new Date(now);
  end.setMonth(end.getMonth() + 1);
  return `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}-${String(end.getDate()).padStart(2, "0")}`;
}

export { getDefaultMonth, getDefaultCustomStart, getDefaultCustomEnd };

export function PeriodPicker({
  month,
  months,
  customStartDate,
  customEndDate,
  onMonthChange,
  onMonthsChange,
  onCustomStartChange,
  onCustomEndChange
}: PeriodPickerProps) {
  const t = useTranslations("scheduling");

  const durationOptions = [
    { value: 1, label: t("period.oneMonth") },
    { value: 2, label: t("period.twoMonths") },
    { value: 3, label: t("period.threeMonths") },
    { value: 0, label: t("period.custom") }
  ];

  const monthOptions = useMemo(() => getMonthOptions(), []);
  const isCustom = months === 0;

  const rangeLabel = useMemo(() => {
    if (isCustom) {
      return formatCustomRangeLabel(customStartDate, customEndDate);
    }
    return computeRangeLabel(month, months);
  }, [isCustom, month, months, customStartDate, customEndDate]);

  return (
    <div className="schedule-period-picker">
      <div className="schedule-period-field">
        <label className="form-label">{t("period.duration")}</label>
        <div className="schedule-duration-options">
          {durationOptions.map((opt) => (
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

      {!isCustom ? (
        <div className="schedule-period-field">
          <label className="form-label" htmlFor="schedule-start-month">{t("period.startingMonth")}</label>
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
      ) : (
        <div className="schedule-period-custom-range">
          <div className="schedule-period-field">
            <label className="form-label" htmlFor="schedule-custom-start">{t("period.startDate")}</label>
            <input
              id="schedule-custom-start"
              type="date"
              className="form-input"
              value={customStartDate}
              onChange={(e) => onCustomStartChange(e.target.value)}
            />
          </div>
          <div className="schedule-period-field">
            <label className="form-label" htmlFor="schedule-custom-end">{t("period.endDate")}</label>
            <input
              id="schedule-custom-end"
              type="date"
              className="form-input"
              value={customEndDate}
              onChange={(e) => onCustomEndChange(e.target.value)}
            />
          </div>
        </div>
      )}

      {rangeLabel ? (
        <div className="schedule-period-summary">
          <span className="schedule-period-range">{rangeLabel}</span>
        </div>
      ) : null}
    </div>
  );
}
