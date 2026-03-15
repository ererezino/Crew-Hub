"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import type { ShiftRecord } from "../../types/scheduling";
import { formatDateWithWeekday } from "../../lib/datetime";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SwapScope = "day" | "week" | "month" | "custom";

type ShiftSwapModalProps = {
  isOpen: boolean;
  /** The shift the user clicked on — the "anchor" for the swap. */
  anchorShift: ShiftRecord | null;
  /** All of the user's shifts (so we can resolve week/month ranges). */
  allShifts: ShiftRecord[];
  onClose: () => void;
  onSubmit: (shiftIds: string[], reason: string) => Promise<void>;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isoToDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y!, m! - 1, d!);
}

function formatDate(iso: string): string {
  return formatDateWithWeekday(iso);
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
  return minutes === 0 ? `${h12} ${suffix}` : `${h12}:${String(minutes).padStart(2, "0")} ${suffix}`;
}

/** Get the Monday of the week containing `dateStr`. */
function getWeekStart(dateStr: string): Date {
  const d = isoToDate(dateStr);
  const day = d.getDay(); // 0=Sun
  const diff = day === 0 ? -6 : 1 - day; // Monday
  d.setDate(d.getDate() + diff);
  return d;
}

function getWeekEnd(dateStr: string): Date {
  const mon = getWeekStart(dateStr);
  mon.setDate(mon.getDate() + 6); // Sunday
  return mon;
}

function toISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function getMonthRange(dateStr: string): [string, string] {
  const d = isoToDate(dateStr);
  const start = new Date(d.getFullYear(), d.getMonth(), 1);
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return [toISO(start), toISO(end)];
}

function shiftsInRange(
  shifts: ShiftRecord[],
  from: string,
  to: string
): ShiftRecord[] {
  return shifts.filter((s) => s.shiftDate >= from && s.shiftDate <= to && s.status === "scheduled");
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ShiftSwapModal({
  isOpen,
  anchorShift,
  allShifts,
  onClose,
  onSubmit
}: ShiftSwapModalProps) {
  const t = useTranslations("scheduling");
  const tc = useTranslations("common");
  const [scope, setScope] = useState<SwapScope>("day");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [reason, setReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset state when the modal opens with a new shift
  useEffect(() => {
    if (isOpen && anchorShift) {
      setScope("day");
      setCustomFrom(anchorShift.shiftDate);
      setCustomTo(anchorShift.shiftDate);
      setReason("");
      setError(null);
    }
  }, [isOpen, anchorShift]);

  // Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isSubmitting) onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, isSubmitting, onClose]);

  const resolvedShifts = useCallback((): ShiftRecord[] => {
    if (!anchorShift) return [];

    switch (scope) {
      case "day":
        return [anchorShift];
      case "week": {
        const ws = toISO(getWeekStart(anchorShift.shiftDate));
        const we = toISO(getWeekEnd(anchorShift.shiftDate));
        return shiftsInRange(allShifts, ws, we);
      }
      case "month": {
        const [ms, me] = getMonthRange(anchorShift.shiftDate);
        return shiftsInRange(allShifts, ms, me);
      }
      case "custom":
        return customFrom && customTo ? shiftsInRange(allShifts, customFrom, customTo) : [];
      default:
        return [];
    }
  }, [scope, anchorShift, allShifts, customFrom, customTo]);

  const affected = resolvedShifts();

  const handleSubmit = useCallback(async () => {
    if (affected.length === 0 || isSubmitting) return;
    setIsSubmitting(true);
    setError(null);
    try {
      await onSubmit(
        affected.map((s) => s.id),
        reason
      );
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("swapModal.failedSwap"));
    } finally {
      setIsSubmitting(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- t is a stable ref from useTranslations
  }, [affected, reason, isSubmitting, onSubmit, onClose]);

  if (!isOpen || !anchorShift) return null;

  return (
    <div className="modal-overlay" onClick={() => { if (!isSubmitting) onClose(); }}>
      <section
        className="modal-dialog swap-modal"
        role="dialog"
        aria-modal="true"
        aria-label={t("swapModal.ariaLabel")}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <h2 className="modal-title">{t("swapModal.title")}</h2>
        <p className="settings-card-description">
          {formatDate(anchorShift.shiftDate)} &middot; {formatTime(anchorShift.startTime)} – {formatTime(anchorShift.endTime)}
        </p>

        {/* Scope selector */}
        <fieldset className="swap-scope-fieldset">
          <legend className="swap-scope-legend">{t("swapModal.scopeLabel")}</legend>
          <div className="swap-scope-options">
            {([
              ["day", t("swapModal.scopeDay")],
              ["week", t("swapModal.scopeWeek")],
              ["month", t("swapModal.scopeMonth")],
              ["custom", t("swapModal.scopeCustom")]
            ] as [SwapScope, string][]).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={`swap-scope-chip ${scope === value ? "swap-scope-chip-active" : ""}`}
                onClick={() => setScope(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </fieldset>

        {/* Custom date pickers */}
        {scope === "custom" ? (
          <div className="swap-custom-range">
            <label className="form-label">
              {t("swapModal.from")}
              <input
                type="date"
                className="form-input"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
              />
            </label>
            <label className="form-label">
              {t("swapModal.to")}
              <input
                type="date"
                className="form-input"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
              />
            </label>
          </div>
        ) : null}

        {/* Affected shifts preview */}
        <div className="swap-affected">
          <p className="swap-affected-count">
            {affected.length === 1
              ? t("swapModal.affectedSingular")
              : t("swapModal.affectedPlural", { count: affected.length })}
          </p>
          {affected.length > 0 && affected.length <= 10 ? (
            <ul className="swap-affected-list">
              {affected.map((s) => (
                <li key={s.id}>
                  {formatDate(s.shiftDate)} &middot; {formatTime(s.startTime)} – {formatTime(s.endTime)}
                </li>
              ))}
            </ul>
          ) : null}
          {affected.length > 10 ? (
            <p className="swap-affected-overflow">
              {t("swapModal.overflowRange", { startDate: formatDate(affected[0]!.shiftDate), endDate: formatDate(affected[affected.length - 1]!.shiftDate) })}
            </p>
          ) : null}
        </div>

        {/* Reason */}
        <label className="form-label">
          {t("swapModal.reason")} <span className="form-label-optional">{t("swapModal.optional")}</span>
          <textarea
            className="form-input swap-reason"
            rows={2}
            placeholder={t("swapModal.reasonPlaceholder")}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>

        {error ? <p className="swap-error">{error}</p> : null}

        {/* Actions */}
        <div className="modal-actions">
          <button
            type="button"
            className="button button-subtle"
            onClick={onClose}
            disabled={isSubmitting}
          >
            {tc("cancel")}
          </button>
          <button
            type="button"
            className="button button-accent"
            onClick={handleSubmit}
            disabled={affected.length === 0 || isSubmitting}
          >
            {isSubmitting ? tc("requesting") : t("swapModal.submit")}
          </button>
        </div>
      </section>
    </div>
  );
}
