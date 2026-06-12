"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import {
  WEEKLY_HOURS_SOFT_LIMIT,
  employeeWeekHours,
  isOverWeeklyLimit,
  roundHours,
  shiftDurationHours,
  weeklyHoursByEmployee
} from "../../lib/scheduling/shift-hours";

import type { ShiftRecord } from "../../types/scheduling";

type ShiftEditAssignee = {
  id: string;
  fullName: string;
};

type ShiftEditValues = {
  employeeId: string | null;
  shiftDate: string;
  startTime: string;
  endTime: string;
};

type ShiftEditModalProps = {
  isOpen: boolean;
  shift: ShiftRecord;
  assignees: ShiftEditAssignee[];
  minDate: string;
  maxDate: string;
  isSubmitting: boolean;
  isDeleting?: boolean;
  /** Already-loaded sibling shifts, used for the soft weekly-hours warning (never blocking). */
  scheduleShifts?: ShiftRecord[];
  onClose: () => void;
  onDelete?: () => void;
  onSubmit: (values: ShiftEditValues) => void;
};

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function toTimeInput(value: string): string {
  const trimmed = value.trim();

  if (/^\d{2}:\d{2}$/.test(trimmed)) {
    return trimmed;
  }

  const embeddedMatch = trimmed.match(/T(\d{2}:\d{2})/);
  if (embeddedMatch) {
    return embeddedMatch[1]!;
  }

  const parsed = new Date(trimmed);
  if (Number.isFinite(parsed.getTime())) {
    return `${pad2(parsed.getUTCHours())}:${pad2(parsed.getUTCMinutes())}`;
  }

  const parts = trimmed.split(":");
  if (parts.length >= 2) {
    const hours = Number(parts[0]);
    const minutes = Number(parts[1]);
    if (Number.isFinite(hours) && Number.isFinite(minutes)) {
      return `${pad2(hours)}:${pad2(minutes)}`;
    }
  }

  return "08:00";
}

function hasChanges({
  shift,
  employeeId,
  shiftDate,
  startTime,
  endTime
}: {
  shift: ShiftRecord;
  employeeId: string;
  shiftDate: string;
  startTime: string;
  endTime: string;
}): boolean {
  const existingEmployeeId = shift.employeeId ?? "";
  return (
    existingEmployeeId !== employeeId ||
    shift.shiftDate !== shiftDate ||
    toTimeInput(shift.startTime) !== startTime ||
    toTimeInput(shift.endTime) !== endTime
  );
}

export function ShiftEditModal({
  isOpen,
  shift,
  assignees,
  minDate,
  maxDate,
  isSubmitting,
  isDeleting = false,
  scheduleShifts,
  onClose,
  onDelete,
  onSubmit
}: ShiftEditModalProps) {
  const tc = useTranslations("common");
  const tSched = useTranslations("scheduling");

  const [employeeId, setEmployeeId] = useState(() => shift.employeeId ?? "");
  const [shiftDate, setShiftDate] = useState(() => shift.shiftDate);
  const [startTime, setStartTime] = useState(() => toTimeInput(shift.startTime));
  const [endTime, setEndTime] = useState(() => toTimeInput(shift.endTime));
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const busy = isSubmitting || isDeleting;

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) {
        onClose();
      }
    };

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [isOpen, busy, onClose]);

  const submitDisabled = useMemo(() => {
    if (!shiftDate || !startTime || !endTime) {
      return true;
    }

    if (startTime === endTime) {
      return true;
    }

    if (
      !hasChanges({
        shift,
        employeeId,
        shiftDate,
        startTime,
        endTime
      })
    ) {
      return true;
    }

    return false;
  }, [employeeId, endTime, shift, shiftDate, startTime]);

  // Soft weekly-hours guardrail: warn (never block) when the edited assignment
  // would push the employee past 48h in the shift's ISO week. Uses only the
  // sibling shifts already loaded by the parent — no extra API calls. The shift
  // being edited is excluded so its proposed times replace its saved ones.
  const projectedWeekHours = useMemo(() => {
    if (!employeeId || !scheduleShifts || !shiftDate || !startTime || !endTime || startTime === endTime) {
      return null;
    }

    const siblingShifts = scheduleShifts.filter((record) => record.id !== shift.id);
    const existing = employeeWeekHours(weeklyHoursByEmployee(siblingShifts), employeeId, shiftDate);
    return existing + shiftDurationHours(startTime, endTime, shift.breakMinutes);
  }, [employeeId, scheduleShifts, shift.breakMinutes, shift.id, shiftDate, startTime, endTime]);

  const showWeeklyHoursWarning = projectedWeekHours !== null && isOverWeeklyLimit(projectedWeekHours);

  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="modal-overlay"
      onClick={() => {
        if (!busy) {
          onClose();
        }
      }}
    >
      <section
        className="modal-dialog shift-edit-modal"
        role="dialog"
        aria-modal="true"
        aria-label={tSched("shiftEditModal.title")}
        onClick={(event) => event.stopPropagation()}
        style={{
          display: "grid",
          gap: "var(--space-3)",
          width: "min(520px, 92vw)"
        }}
      >
        <h2 className="modal-title">{tSched("shiftEditModal.title")}</h2>
        <p className="settings-card-description">{tSched("shiftEditModal.description")}</p>

        <span className="form-label">
          {tSched("shiftEditModal.assignee")}
        </span>
        <Select
          value={employeeId || "__none__"}
          onValueChange={(value) => {
            setEmployeeId(value === "__none__" ? "" : value);
            setError(null);
          }}
          disabled={isSubmitting}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">{tSched("shiftEditModal.openShiftOption")}</SelectItem>
            {assignees.map((assignee) => (
              <SelectItem key={assignee.id} value={assignee.id}>
                {assignee.fullName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div
          className="shift-edit-grid"
          style={{
            display: "grid",
            gap: "var(--space-2)"
          }}
        >
          <label className="form-label" htmlFor="shift-edit-date">
            {tSched("shiftEditModal.date")}
          </label>
          <input
            id="shift-edit-date"
            type="date"
            className="form-input"
            value={shiftDate}
            min={minDate}
            max={maxDate}
            onChange={(event) => {
              setShiftDate(event.target.value);
              setError(null);
            }}
            disabled={isSubmitting}
          />
        </div>

        <div
          className="shift-edit-grid shift-edit-grid-split"
          style={{
            display: "grid",
            gap: "var(--space-3)",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))"
          }}
        >
          <div style={{ minWidth: 0 }}>
            <label className="form-label" htmlFor="shift-edit-start-time">
              {tSched("shiftEditModal.startTime")}
            </label>
            <input
              id="shift-edit-start-time"
              type="time"
              className="form-input"
              value={startTime}
              onChange={(event) => {
                setStartTime(event.target.value);
                setError(null);
              }}
              disabled={isSubmitting}
            />
          </div>
          <div style={{ minWidth: 0 }}>
            <label className="form-label" htmlFor="shift-edit-end-time">
              {tSched("shiftEditModal.endTime")}
            </label>
            <input
              id="shift-edit-end-time"
              type="time"
              className="form-input"
              value={endTime}
              onChange={(event) => {
                setEndTime(event.target.value);
                setError(null);
              }}
              disabled={isSubmitting}
            />
          </div>
        </div>

        {showWeeklyHoursWarning && projectedWeekHours !== null ? (
          <p className="shift-modal-hours-warning" role="status">
            {tSched("weeklyHours.overLimit", { hours: WEEKLY_HOURS_SOFT_LIMIT })}
            {" · "}
            {tSched("weeklyHours.total", { hours: roundHours(projectedWeekHours) })}
          </p>
        ) : null}

        {error ? <p className="swap-error">{error}</p> : null}

        <div
          className="modal-actions"
          style={{ justifyContent: onDelete ? "space-between" : undefined }}
        >
          {onDelete ? (
            confirmingDelete ? (
              <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center" }}>
                <span className="settings-card-description">{tSched("shiftEditModal.removePrompt")}</span>
                <button
                  type="button"
                  className="button button-subtle"
                  onClick={() => setConfirmingDelete(false)}
                  disabled={busy}
                >
                  {tSched("shiftEditModal.keep")}
                </button>
                <button
                  type="button"
                  className="button button-danger"
                  onClick={() => onDelete()}
                  disabled={busy}
                >
                  {isDeleting ? tSched("shiftEditModal.removing") : tSched("shiftEditModal.removeConfirm")}
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="button button-danger-outline"
                onClick={() => setConfirmingDelete(true)}
                disabled={busy}
              >
                {tSched("shiftEditModal.remove")}
              </button>
            )
          ) : (
            <span />
          )}

          <div style={{ display: "flex", gap: "var(--space-2)" }}>
          <button
            type="button"
            className="button button-subtle"
            onClick={onClose}
            disabled={busy}
          >
            {tc("cancel")}
          </button>
          <button
            type="button"
            className="button button-accent"
            disabled={submitDisabled || busy}
            onClick={() => {
              if (!shiftDate || !startTime || !endTime) {
                setError(tSched("shiftEditModal.validationRequired"));
                return;
              }
              if (startTime === endTime) {
                setError(tSched("shiftEditModal.validationTimeRange"));
                return;
              }
              onSubmit({
                employeeId: employeeId.length > 0 ? employeeId : null,
                shiftDate,
                startTime,
                endTime
              });
            }}
          >
            {isSubmitting ? tc("saving") : tSched("shiftEditModal.save")}
          </button>
          </div>
        </div>
      </section>
    </div>
  );
}
