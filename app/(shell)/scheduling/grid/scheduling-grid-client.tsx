"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../../components/ui/select";
import { useSchedulingSchedules, useSchedulingShifts } from "../../../../hooks/use-scheduling";
import { usePeople } from "../../../../hooks/use-people";
import { areDepartmentsEqual } from "../../../../lib/department";
import {
  WEEKLY_HOURS_SOFT_LIMIT,
  isOverWeeklyLimit,
  roundHours,
  weeklyHoursByEmployee
} from "../../../../lib/scheduling/shift-hours";
import type { ScheduleRecord, ShiftRecord } from "../../../../types/scheduling";

type ToastMessage = { id: number; type: "success" | "error" | "info"; text: string };

type Slot = { key: string; name: string; startTime: string; endTime: string };

type CellPerson = {
  employeeId: string;
  name: string;
  weekdays: Set<number>; // 0=Mon..6=Sun
};

type WeekRow = {
  index: number;
  weekStart: string; // Monday ISO
  label: string;
  rangeDates: string[]; // in-range ISO dates for this week
  rangeWeekdays: number[]; // 0..6 indices present in range
};

let toastSeq = 0;

const DAY_LETTERS = ["M", "T", "W", "T", "F", "S", "S"]; // Mon..Sun (display only)

function isoToUtc(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}
function utcToIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function weekdayIndex(iso: string): number {
  return (isoToUtc(iso).getUTCDay() + 6) % 7; // Mon=0
}
function mondayOf(iso: string): string {
  const d = isoToUtc(iso);
  d.setUTCDate(d.getUTCDate() - weekdayIndex(iso));
  return utcToIso(d);
}
function addDays(iso: string, n: number): string {
  const d = isoToUtc(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return utcToIso(d);
}
/** "HH:MM" from an ISO timestamp or an already-HH:MM string. */
function toHHMM(value: string): string {
  const m = value.match(/T(\d{2}:\d{2})/);
  if (m) return m[1]!;
  if (/^\d{2}:\d{2}$/.test(value.trim())) return value.trim();
  const d = new Date(value);
  if (Number.isFinite(d.getTime())) {
    return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
  }
  return "00:00";
}
function shortDate(iso: string, locale: string): string {
  return isoToUtc(iso).toLocaleDateString(locale, { month: "short", day: "numeric", timeZone: "UTC" });
}
function slotKeyOf(startHHMM: string, endHHMM: string): string {
  return `${startHHMM}-${endHHMM}`;
}

const DEFAULT_SLOTS: Slot[] = [
  { key: "08:00-16:00", name: "Morning Shift", startTime: "08:00", endTime: "16:00" },
  { key: "16:00-00:00", name: "Afternoon Shift", startTime: "16:00", endTime: "00:00" }
];

export function SchedulingGridClient({ canManage }: { canManage: boolean }) {
  const t = useTranslations("scheduling");
  const tc = useTranslations("common");

  const schedulesQuery = useSchedulingSchedules({ scope: "team" });
  const schedules = useMemo(() => schedulesQuery.data?.schedules ?? [], [schedulesQuery.data]);

  const [selectedScheduleId, setSelectedScheduleId] = useState<string | null>(null);
  const activeSchedule: ScheduleRecord | null = useMemo(() => {
    if (schedules.length === 0) return null;
    return schedules.find((s) => s.id === selectedScheduleId) ?? schedules[0] ?? null;
  }, [schedules, selectedScheduleId]);

  const shiftsQuery = useSchedulingShifts(
    activeSchedule
      ? {
          scope: "team",
          scheduleId: activeSchedule.id,
          startDate: activeSchedule.startDate,
          endDate: activeSchedule.endDate,
          limit: 2000
        }
      : {}
  );
  const shifts = useMemo(() => shiftsQuery.data?.shifts ?? [], [shiftsQuery.data]);

  const peopleQuery = usePeople({ scope: "all" });
  const roster = useMemo(() => {
    const people = peopleQuery.people ?? [];
    const active = people.filter((p) => p.status === "active" || p.status === "onboarding");
    if (activeSchedule?.department) {
      const scoped = active.filter((p) => areDepartmentsEqual(p.department, activeSchedule.department));
      // Fall back to everyone if the schedule's department has no matching crew.
      return scoped.length > 0 ? scoped : active;
    }
    return active;
  }, [peopleQuery.people, activeSchedule?.department]);

  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [savingCell, setSavingCell] = useState<string | null>(null);
  const [addTarget, setAddTarget] = useState<string | null>(null); // `${weekIndex}:${slotKey}`
  const [notes, setNotes] = useState<Map<string, string>>(new Map()); // weekStart -> note
  const [copyingWeek, setCopyingWeek] = useState<string | null>(null);
  const [leaveByEmployee, setLeaveByEmployee] = useState<Map<string, Array<{ start: string; end: string }>>>(new Map());
  const [extraSlots, setExtraSlots] = useState<Slot[]>([]);
  const [addingSlot, setAddingSlot] = useState(false);
  const [newSlotName, setNewSlotName] = useState("");
  const [newSlotStart, setNewSlotStart] = useState("08:00");
  const [newSlotEnd, setNewSlotEnd] = useState("16:00");

  const addToast = useCallback((type: ToastMessage["type"], text: string) => {
    const id = ++toastSeq;
    setToasts((cur) => [...cur, { id, type, text }]);
    setTimeout(() => setToasts((cur) => cur.filter((x) => x.id !== id)), 4500);
  }, []);

  // Load per-week notes for the active schedule.
  const scheduleId = activeSchedule?.id;
  useEffect(() => {
    if (!scheduleId) {
      setNotes(new Map());
      return;
    }
    let cancelled = false;
    void fetch(`/api/v1/scheduling/schedules/${scheduleId}/week-notes`)
      .then((r) => r.json())
      .then((payload) => {
        if (cancelled) return;
        const list: Array<{ weekStart: string; note: string }> = payload?.data?.notes ?? [];
        setNotes(new Map(list.map((n) => [n.weekStart, n.note] as const)));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [scheduleId]);

  // Load approved leave across the schedule range (org-scoped to the schedule's crew),
  // so we can flag who's away that week.
  useEffect(() => {
    if (!scheduleId) {
      setLeaveByEmployee(new Map());
      return;
    }
    let cancelled = false;
    void fetch(`/api/v1/scheduling/schedules/${scheduleId}/grid`)
      .then((r) => r.json())
      .then((payload) => {
        if (cancelled) return;
        const list: Array<{ employeeId: string; start: string; end: string }> = payload?.data?.leave ?? [];
        const map = new Map<string, Array<{ start: string; end: string }>>();
        for (const item of list) {
          const arr = map.get(item.employeeId) ?? [];
          arr.push({ start: item.start, end: item.end });
          map.set(item.employeeId, arr);
        }
        setLeaveByEmployee(map);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [scheduleId, shifts]);

  const saveNote = useCallback(
    async (weekStart: string, note: string) => {
      if (!scheduleId) return;
      try {
        const res = await fetch(`/api/v1/scheduling/schedules/${scheduleId}/week-notes`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ weekStart, note })
        });
        if (!res.ok) {
          const payload = await res.json().catch(() => null);
          throw new Error(payload?.error?.message ?? t("grid.notesError"));
        }
      } catch (err) {
        addToast("error", err instanceof Error ? err.message : t("grid.notesError"));
      }
    },
    [scheduleId, addToast, t]
  );

  // ---- Derive weeks ----
  const weeks: WeekRow[] = useMemo(() => {
    if (!activeSchedule) return [];
    const out: WeekRow[] = [];
    let cursorMonday = mondayOf(activeSchedule.startDate);
    let index = 0;
    // Guard: at most 8 weeks (covers a month-plus schedule).
    while (cursorMonday <= activeSchedule.endDate && index < 8) {
      const rangeDates: string[] = [];
      const rangeWeekdays: number[] = [];
      for (let i = 0; i < 7; i += 1) {
        const iso = addDays(cursorMonday, i);
        if (iso >= activeSchedule.startDate && iso <= activeSchedule.endDate) {
          rangeDates.push(iso);
          rangeWeekdays.push(i);
        }
      }
      if (rangeDates.length > 0) {
        out.push({
          index,
          weekStart: cursorMonday,
          label: `${shortDate(rangeDates[0]!, "en")} – ${shortDate(rangeDates[rangeDates.length - 1]!, "en")}`,
          rangeDates,
          rangeWeekdays
        });
        index += 1;
      }
      cursorMonday = addDays(cursorMonday, 7);
    }
    return out;
  }, [activeSchedule]);

  // ---- Derive slots (columns) from existing shifts, else defaults ----
  const slots: Slot[] = useMemo(() => {
    const map = new Map<string, Slot>();
    for (const shift of shifts) {
      const start = toHHMM(shift.startTime);
      const end = toHHMM(shift.endTime);
      const key = slotKeyOf(start, end);
      if (!map.has(key)) {
        const name = cleanSlotName(shift) ?? `${start}–${end}`;
        map.set(key, { key, name, startTime: start, endTime: end });
      }
    }
    // Merge in any slot columns the user added manually but hasn't filled yet.
    for (const slot of extraSlots) {
      if (!map.has(slot.key)) map.set(slot.key, slot);
    }
    if (map.size === 0) return DEFAULT_SLOTS;
    return [...map.values()].sort((a, b) => a.startTime.localeCompare(b.startTime));
  }, [shifts, extraSlots]);

  const isOnLeaveWeek = useCallback(
    (employeeId: string, week: WeekRow): boolean => {
      const intervals = leaveByEmployee.get(employeeId);
      if (!intervals || week.rangeDates.length === 0) return false;
      const weekStart = week.rangeDates[0]!;
      const weekEnd = week.rangeDates[week.rangeDates.length - 1]!;
      return intervals.some((iv) => iv.start <= weekEnd && iv.end >= weekStart);
    },
    [leaveByEmployee]
  );

  // ---- Build cells: week × slot -> people with weekdays worked ----
  const cells = useMemo(() => {
    // key `${weekIndex}:${slotKey}` -> Map<employeeId, CellPerson>
    const grid = new Map<string, Map<string, CellPerson>>();
    if (weeks.length === 0) return grid;

    const weekByDate = new Map<string, WeekRow>();
    for (const w of weeks) for (const d of w.rangeDates) weekByDate.set(d, w);

    for (const shift of shifts) {
      if (!shift.employeeId || shift.status === "cancelled") continue;
      const week = weekByDate.get(shift.shiftDate);
      if (!week) continue;
      const slotKey = slotKeyOf(toHHMM(shift.startTime), toHHMM(shift.endTime));
      const cellKey = `${week.index}:${slotKey}`;
      let people = grid.get(cellKey);
      if (!people) {
        people = new Map();
        grid.set(cellKey, people);
      }
      const wd = weekdayIndex(shift.shiftDate);
      const existing = people.get(shift.employeeId);
      if (existing) {
        existing.weekdays.add(wd);
      } else {
        people.set(shift.employeeId, {
          employeeId: shift.employeeId,
          name: shift.employeeName ?? "Unknown",
          weekdays: new Set([wd])
        });
      }
    }
    return grid;
  }, [shifts, weeks]);

  const rosterById = useMemo(() => new Map(roster.map((p) => [p.id, p.fullName] as const)), [roster]);

  // Per-employee scheduled hours per ISO week (Monday start) — soft 48h guardrail, never blocking.
  const weeklyHours = useMemo(() => weeklyHoursByEmployee(shifts), [shifts]);

  const saveCell = useCallback(
    async (week: WeekRow, slot: Slot, employeeId: string, weekdays: number[]) => {
      if (!activeSchedule) return;
      const cellKey = `${week.index}:${slot.key}:${employeeId}`;
      setSavingCell(cellKey);
      try {
        const res = await fetch(`/api/v1/scheduling/schedules/${activeSchedule.id}/grid`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            employeeId,
            slot: { name: slot.name, startTime: slot.startTime, endTime: slot.endTime },
            weekStart: week.weekStart,
            weekdays
          })
        });
        const payload = await res.json().catch(() => null);
        if (!res.ok) {
          throw new Error(payload?.error?.message ?? t("grid.toastError"));
        }
        const warnings: string[] = payload?.data?.warnings ?? [];
        for (const w of warnings) addToast("info", w);
        shiftsQuery.refresh();
      } catch (err) {
        addToast("error", err instanceof Error ? err.message : t("grid.toastError"));
      } finally {
        setSavingCell(null);
      }
    },
    [activeSchedule, addToast, shiftsQuery, t]
  );

  const copyWeek = useCallback(
    async (targetWeek: WeekRow) => {
      if (!activeSchedule) return;
      const source = weeks.find((w) => w.index === targetWeek.index - 1);
      if (!source) return;

      setCopyingWeek(targetWeek.weekStart);
      try {
        let count = 0;
        const allWarnings = new Set<string>();
        for (const slot of slots) {
          const sourcePeople = cells.get(`${source.index}:${slot.key}`);
          if (!sourcePeople) continue;
          for (const person of sourcePeople.values()) {
            // Map the source person's worked weekdays onto the target week's in-range days.
            const weekdays = [...person.weekdays].filter((d) => targetWeek.rangeWeekdays.includes(d));
            if (weekdays.length === 0) continue;
            const res = await fetch(`/api/v1/scheduling/schedules/${activeSchedule.id}/grid`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                employeeId: person.employeeId,
                slot: { name: slot.name, startTime: slot.startTime, endTime: slot.endTime },
                weekStart: targetWeek.weekStart,
                weekdays
              })
            });
            const payload = await res.json().catch(() => null);
            if (res.ok) {
              count += 1;
              for (const w of payload?.data?.warnings ?? []) allWarnings.add(w);
            }
          }
        }
        shiftsQuery.refresh();
        if (count > 0) {
          addToast("success", t("grid.copyWeekDone", { count }));
          for (const w of allWarnings) addToast("info", w);
        } else {
          addToast("info", t("grid.copyWeekEmpty"));
        }
      } catch (err) {
        addToast("error", err instanceof Error ? err.message : t("grid.toastError"));
      } finally {
        setCopyingWeek(null);
      }
    },
    [activeSchedule, weeks, slots, cells, shiftsQuery, addToast, t]
  );

  const handleAddSlot = useCallback(() => {
    const name = newSlotName.trim();
    const timeOk = /^([01]\d|2[0-3]):[0-5]\d$/.test(newSlotStart) && /^([01]\d|2[0-3]):[0-5]\d$/.test(newSlotEnd);
    if (!name || !timeOk || newSlotStart === newSlotEnd) {
      addToast("error", t("grid.slotInvalid"));
      return;
    }
    const key = slotKeyOf(newSlotStart, newSlotEnd);
    if (slots.some((s) => s.key === key)) {
      addToast("info", t("grid.slotExists"));
    } else {
      setExtraSlots((cur) => [...cur, { key, name, startTime: newSlotStart, endTime: newSlotEnd }]);
    }
    setNewSlotName("");
    setAddingSlot(false);
  }, [newSlotName, newSlotStart, newSlotEnd, slots, addToast, t]);

  if (schedulesQuery.isLoading) {
    return (
      <section className="compensation-layout">
        <div className="table-skeleton">
          <div className="table-skeleton-header" />
          <div className="table-skeleton-row" />
          <div className="table-skeleton-row" />
        </div>
      </section>
    );
  }

  if (!canManage) {
    return <p className="settings-card-description">{t("grid.managerOnly")}</p>;
  }

  if (schedules.length === 0) {
    return <p className="settings-card-description">{t("grid.noSchedules")}</p>;
  }

  return (
    <section className="compensation-layout schedule-grid-layout">
      <div className="schedule-grid-controls">
        <span className="form-label">{t("grid.scheduleLabel")}</span>
        <Select
          value={activeSchedule?.id ?? ""}
          onValueChange={(value) => setSelectedScheduleId(value)}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {schedules.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {(s.name ?? t("grid.untitledSchedule")) + ` · ${shortDate(s.startDate, "en")} – ${shortDate(s.endDate, "en")}`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <p className="settings-card-description">{t("grid.helpText")}</p>

      <div className="schedule-grid-slot-add">
        {addingSlot ? (
          <div className="schedule-grid-slot-form">
            <input
              className="form-input"
              placeholder={t("grid.slotNamePlaceholder")}
              value={newSlotName}
              onChange={(e) => setNewSlotName(e.target.value)}
              maxLength={120}
            />
            <input type="time" className="form-input" value={newSlotStart} onChange={(e) => setNewSlotStart(e.target.value)} />
            <span>–</span>
            <input type="time" className="form-input" value={newSlotEnd} onChange={(e) => setNewSlotEnd(e.target.value)} />
            <button type="button" className="button button-accent button-xs" onClick={handleAddSlot}>
              {t("grid.slotAddConfirm")}
            </button>
            <button type="button" className="button button-subtle button-xs" onClick={() => setAddingSlot(false)}>
              {tc("cancel")}
            </button>
          </div>
        ) : (
          <button type="button" className="schedule-grid-add" style={{ width: "auto" }} onClick={() => setAddingSlot(true)}>
            + {t("grid.addSlot")}
          </button>
        )}
      </div>

      {shiftsQuery.isLoading ? (
        <div className="table-skeleton">
          <div className="table-skeleton-header" />
          <div className="table-skeleton-row" />
        </div>
      ) : (
        <div className="schedule-grid-scroll">
          <table className="schedule-grid-table">
            <thead>
              <tr>
                <th className="schedule-grid-week-col">{t("grid.weekColumn")}</th>
                {slots.map((slot) => (
                  <th key={slot.key}>
                    <span className="schedule-grid-slot-name">{slot.name}</span>
                    <span className="schedule-grid-slot-time">{slot.startTime}–{slot.endTime}</span>
                  </th>
                ))}
                <th className="schedule-grid-notes-col">{t("grid.notesColumn")}</th>
              </tr>
            </thead>
            <tbody>
              {weeks.map((week) => (
                <tr key={week.index}>
                  <th scope="row" className="schedule-grid-week-col">
                    <span className="schedule-grid-week-label">{week.label}</span>
                    {week.index > 0 ? (
                      <button
                        type="button"
                        className="schedule-grid-copy"
                        disabled={copyingWeek !== null || savingCell !== null}
                        onClick={() => void copyWeek(week)}
                      >
                        {copyingWeek === week.weekStart ? t("grid.copying") : t("grid.copyWeek")}
                      </button>
                    ) : null}
                  </th>
                  {slots.map((slot) => {
                    const cellKey = `${week.index}:${slot.key}`;
                    const people = cells.get(cellKey);
                    const assignedIds = new Set(people ? [...people.keys()] : []);
                    const available = roster.filter((p) => !assignedIds.has(p.id));
                    const isAdding = addTarget === cellKey;
                    return (
                      <td key={slot.key} className="schedule-grid-cell">
                        {people && people.size > 0 ? (
                          <ul className="schedule-grid-people">
                            {[...people.values()].map((person) => {
                              const onLeave = isOnLeaveWeek(person.employeeId, week);
                              const hoursThisWeek = weeklyHours.get(person.employeeId)?.get(week.weekStart) ?? 0;
                              const overLimit = isOverWeeklyLimit(hoursThisWeek);
                              return (
                              <li
                                key={person.employeeId}
                                className={`schedule-grid-chip${onLeave ? " is-on-leave" : ""}`}
                                title={onLeave ? t("grid.onLeaveTooltip") : undefined}
                              >
                                <span className="schedule-grid-chip-name">
                                  {rosterById.get(person.employeeId) ?? person.name}
                                  {onLeave ? <span className="schedule-grid-leave-tag">{t("grid.onLeaveTag")}</span> : null}
                                  {hoursThisWeek > 0 ? (
                                    <span
                                      className={`schedule-grid-hours${overLimit ? " is-over" : ""}`}
                                      title={
                                        overLimit
                                          ? t("weeklyHours.overLimit", { hours: WEEKLY_HOURS_SOFT_LIMIT })
                                          : t("weeklyHours.total", { hours: roundHours(hoursThisWeek) })
                                      }
                                    >
                                      {t("weeklyHours.badge", { hours: roundHours(hoursThisWeek) })}
                                    </span>
                                  ) : null}
                                </span>
                                <span className="schedule-grid-days">
                                  {week.rangeWeekdays.map((wd) => {
                                    const on = person.weekdays.has(wd);
                                    return (
                                      <button
                                        type="button"
                                        key={wd}
                                        className={`schedule-grid-day${on ? " is-on" : ""}`}
                                        title={t("grid.toggleDay")}
                                        disabled={savingCell !== null}
                                        onClick={() => {
                                          const next = new Set(person.weekdays);
                                          if (on) next.delete(wd);
                                          else next.add(wd);
                                          void saveCell(week, slot, person.employeeId, [...next].sort((a, b) => a - b));
                                        }}
                                      >
                                        {DAY_LETTERS[wd]}
                                      </button>
                                    );
                                  })}
                                </span>
                                <button
                                  type="button"
                                  className="schedule-grid-remove"
                                  aria-label={t("grid.removePerson")}
                                  title={t("grid.removePerson")}
                                  disabled={savingCell !== null}
                                  onClick={() => void saveCell(week, slot, person.employeeId, [])}
                                >
                                  ×
                                </button>
                              </li>
                              );
                            })}
                          </ul>
                        ) : null}

                        {isAdding ? (
                          <div className="schedule-grid-add-menu">
                            <Select
                              value=""
                              onValueChange={(value) => {
                                setAddTarget(null);
                                void saveCell(week, slot, value, week.rangeWeekdays);
                              }}
                            >
                              <SelectTrigger>
                                <SelectValue placeholder={t("grid.pickPerson")} />
                              </SelectTrigger>
                              <SelectContent>
                                {available.map((p) => (
                                  <SelectItem key={p.id} value={p.id}>
                                    {isOnLeaveWeek(p.id, week) ? `${p.fullName} · ${t("grid.onLeaveTag")}` : p.fullName}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <button
                              type="button"
                              className="button button-subtle button-xs"
                              onClick={() => setAddTarget(null)}
                            >
                              {tc("cancel")}
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            className="schedule-grid-add"
                            disabled={savingCell !== null || available.length === 0}
                            onClick={() => setAddTarget(cellKey)}
                          >
                            + {t("grid.addPerson")}
                          </button>
                        )}
                      </td>
                    );
                  })}
                  <td className="schedule-grid-notes-cell">
                    <textarea
                      className="schedule-grid-note-input"
                      rows={2}
                      placeholder={t("grid.notesPlaceholder")}
                      defaultValue={notes.get(week.weekStart) ?? ""}
                      key={`${week.weekStart}:${notes.get(week.weekStart) ?? ""}`}
                      onBlur={(event) => {
                        const next = event.currentTarget.value;
                        if (next !== (notes.get(week.weekStart) ?? "")) {
                          setNotes((cur) => {
                            const map = new Map(cur);
                            map.set(week.weekStart, next);
                            return map;
                          });
                          void saveNote(week.weekStart, next);
                        }
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {toasts.length > 0 ? (
        <section className="toast-region" aria-live="polite">
          {toasts.map((toast) => (
            <div key={toast.id} className={`toast-message toast-message-${toast.type}`}>
              <span>{toast.text}</span>
            </div>
          ))}
        </section>
      ) : null}
    </section>
  );
}

/** Display name for a slot derived from a shift's notes/template, stripping auto-gen prefixes. */
function cleanSlotName(shift: ShiftRecord): string | null {
  const raw = (shift.notes ?? shift.templateName ?? "").trim();
  if (!raw) return null;
  return raw.replace(/^Auto-generated:\s*/i, "").trim() || null;
}
