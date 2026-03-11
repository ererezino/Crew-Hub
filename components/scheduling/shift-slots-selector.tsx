"use client";

import { useCallback } from "react";
import { useTranslations } from "next-intl";

export type ShiftSlotSelection = {
  name: string;
  startTime: string;
  endTime: string;
};

type ShiftSlotsSelectorProps = {
  slots: ShiftSlotSelection[];
  onChange: (slots: ShiftSlotSelection[]) => void;
};

const SLOT_PRESETS: ShiftSlotSelection[] = [
  { name: "Morning Shift", startTime: "08:00", endTime: "16:00" },
  { name: "Afternoon Shift", startTime: "16:00", endTime: "00:00" },
  { name: "Support Shift", startTime: "09:00", endTime: "17:00" },
  { name: "Late Shift", startTime: "12:00", endTime: "20:00" }
];

function buildDefaultSlot(index: number): ShiftSlotSelection {
  const preset = SLOT_PRESETS[index];
  if (preset) {
    return { ...preset };
  }

  return {
    name: `Shift ${index + 1}`,
    startTime: "08:00",
    endTime: "16:00"
  };
}

export function ShiftSlotsSelector({ slots, onChange }: ShiftSlotsSelectorProps) {
  const t = useTranslations("scheduling");

  const updateSlot = useCallback(
    (index: number, patch: Partial<ShiftSlotSelection>) => {
      const next = [...slots];
      const current = next[index];
      if (!current) {
        return;
      }

      next[index] = {
        ...current,
        ...patch
      };
      onChange(next);
    },
    [onChange, slots]
  );

  const addSlot = useCallback(() => {
    onChange([...slots, buildDefaultSlot(slots.length)]);
  }, [onChange, slots]);

  const removeSlot = useCallback(
    (index: number) => {
      if (slots.length <= 2) {
        return;
      }

      onChange(slots.filter((_, slotIndex) => slotIndex !== index));
    },
    [onChange, slots]
  );

  return (
    <div className="schedule-slot-selector">
      <div className="schedule-slot-header">
        <p className="schedule-roster-count">
          {t("slots.minimumHint")}
        </p>
        <button
          type="button"
          className="button button-ghost"
          onClick={addSlot}
        >
          {t("slots.addShift")}
        </button>
      </div>

      <div className="schedule-slot-list">
        {slots.map((slot, index) => (
          <div key={`${index}-${slot.name}`} className="schedule-slot-row">
            <div className="schedule-slot-name-field">
              <label className="form-label" htmlFor={`schedule-slot-name-${index}`}>
                {t("slots.shiftName")}
              </label>
              <input
                id={`schedule-slot-name-${index}`}
                type="text"
                className="form-input"
                value={slot.name}
                onChange={(event) => updateSlot(index, { name: event.currentTarget.value })}
              />
            </div>

            <div className="schedule-slot-time-fields">
              <div>
                <label className="form-label" htmlFor={`schedule-slot-start-${index}`}>
                  {t("slots.startTime")}
                </label>
                <input
                  id={`schedule-slot-start-${index}`}
                  type="time"
                  className="form-input"
                  value={slot.startTime}
                  onChange={(event) => updateSlot(index, { startTime: event.currentTarget.value })}
                />
              </div>
              <div>
                <label className="form-label" htmlFor={`schedule-slot-end-${index}`}>
                  {t("slots.endTime")}
                </label>
                <input
                  id={`schedule-slot-end-${index}`}
                  type="time"
                  className="form-input"
                  value={slot.endTime}
                  onChange={(event) => updateSlot(index, { endTime: event.currentTarget.value })}
                />
              </div>
            </div>

            <button
              type="button"
              className="button button-ghost"
              onClick={() => removeSlot(index)}
              disabled={slots.length <= 2}
            >
              {t("slots.remove")}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
