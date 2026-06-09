"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";

type ShiftCreateAssignee = {
  id: string;
  fullName: string;
};

type ShiftCreateValues = {
  employeeId: string | null;
  shiftDate: string;
  startTime: string;
  endTime: string;
};

type ShiftCreateModalProps = {
  isOpen: boolean;
  assignees: ShiftCreateAssignee[];
  defaultDate: string;
  minDate: string;
  maxDate: string;
  isSubmitting: boolean;
  onClose: () => void;
  onSubmit: (values: ShiftCreateValues) => void;
};

const DEFAULT_START_TIME = "08:00";
const DEFAULT_END_TIME = "16:00";

function clampDate(value: string, minDate: string, maxDate: string): string {
  if (minDate && value < minDate) {
    return minDate;
  }
  if (maxDate && value > maxDate) {
    return maxDate;
  }
  return value;
}

export function ShiftCreateModal({
  isOpen,
  assignees,
  defaultDate,
  minDate,
  maxDate,
  isSubmitting,
  onClose,
  onSubmit
}: ShiftCreateModalProps) {
  const tc = useTranslations("common");
  const tSched = useTranslations("scheduling");

  const [employeeId, setEmployeeId] = useState("");
  const [shiftDate, setShiftDate] = useState(() => clampDate(defaultDate, minDate, maxDate));
  const [startTime, setStartTime] = useState(DEFAULT_START_TIME);
  const [endTime, setEndTime] = useState(DEFAULT_END_TIME);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isSubmitting) {
        onClose();
      }
    };

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [isOpen, isSubmitting, onClose]);

  const submitDisabled = useMemo(() => {
    if (!shiftDate || !startTime || !endTime) {
      return true;
    }

    if (startTime === endTime) {
      return true;
    }

    return false;
  }, [endTime, shiftDate, startTime]);

  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="modal-overlay"
      onClick={() => {
        if (!isSubmitting) {
          onClose();
        }
      }}
    >
      <section
        className="modal-dialog shift-edit-modal"
        role="dialog"
        aria-modal="true"
        aria-label={tSched("shiftCreateModal.title")}
        onClick={(event) => event.stopPropagation()}
        style={{
          display: "grid",
          gap: "var(--space-3)",
          width: "min(520px, 92vw)"
        }}
      >
        <h2 className="modal-title">{tSched("shiftCreateModal.title")}</h2>
        <p className="settings-card-description">{tSched("shiftCreateModal.description")}</p>

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
          <label className="form-label" htmlFor="shift-create-date">
            {tSched("shiftEditModal.date")}
          </label>
          <input
            id="shift-create-date"
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
            <label className="form-label" htmlFor="shift-create-start-time">
              {tSched("shiftEditModal.startTime")}
            </label>
            <input
              id="shift-create-start-time"
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
            <label className="form-label" htmlFor="shift-create-end-time">
              {tSched("shiftEditModal.endTime")}
            </label>
            <input
              id="shift-create-end-time"
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

        {error ? <p className="swap-error">{error}</p> : null}

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
            disabled={submitDisabled || isSubmitting}
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
            {isSubmitting ? tc("saving") : tSched("shiftCreateModal.save")}
          </button>
        </div>
      </section>
    </div>
  );
}
