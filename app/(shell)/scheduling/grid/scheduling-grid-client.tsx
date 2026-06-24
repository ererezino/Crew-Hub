"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../../components/ui/select";
import { useSchedulingSchedules, useSchedulingShifts } from "../../../../hooks/use-scheduling";
import { useAllPeople } from "../../../../hooks/use-people";
import { areDepartmentsEqual } from "../../../../lib/department";
import { MAX_GRID_WEEKS_RUNAWAY_GUARD } from "../../../../lib/scheduling/week-grid";
import { reportSchedulingInvariant } from "../../../../lib/scheduling/shift-display";
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

/** An optimistic cell edit awaiting / having attempted a background save (SCHED-04). */
type CellEdit = {
  cellKey: string;
  employeeId: string;
  name: string;
  weekdays: number[];
  /** Monotonic version; only the latest seq for a cell may apply its result. */
  seq: number;
  /** "saving" until acknowledged; "saved" once the server confirmed (cleared on
   *  the next reconciling refetch); "failed" surfaces an explicit retry. */
  status: "saving" | "saved" | "failed";
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
/** Default working days when adding someone, respecting the schedule's track:
 *  weekend track → Sat/Sun only; weekday track → Mon–Fri. Falls back to all in-range
 *  days if the track yields none (e.g. a partial week with no matching days). */
function defaultWeekdaysForTrack(week: WeekRow, track: string | null | undefined): number[] {
  const isWeekend = track === "weekend";
  const filtered = week.rangeWeekdays.filter((d) => (isWeekend ? d >= 5 : d <= 4));
  return filtered.length > 0 ? filtered : week.rangeWeekdays;
}
function editKey(cellKey: string, employeeId: string): string {
  return `${cellKey}__${employeeId}`;
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

  const peopleQuery = useAllPeople({ scope: "all" });
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
  // Optimistic cell edits: applied to the UI instantly, saved in the background (debounced).
  // Keyed by `${cellKey}__${employeeId}`. SCHED-04: each edit carries a
  // monotonically increasing `seq` so an out-of-order success/failure can only
  // be applied if it still matches the LATEST edit for that cell, and a `status`
  // so a failed save shows an explicit retry affordance instead of being
  // silently discarded.
  const [edits, setEdits] = useState<Map<string, CellEdit>>(new Map());
  const saveTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  // Pending (debounced, not-yet-fired) saves, so we can FLUSH them before
  // navigating to another schedule or unmounting (SCHED-04) instead of dropping
  // recent edits when their 450ms timer is cleared.
  const pendingSaves = useRef<Map<string, () => void>>(new Map());
  const editSeq = useRef(0);
  const isMounted = useRef(true);
  // Tracks the active schedule id for late save results to compare against, so a
  // response that returns after the user navigated away is ignored (SCHED-04).
  const scheduleIdRef = useRef<string | undefined>(undefined);
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

  // SCHED-04: when the active schedule changes, the prior schedule's pending
  // saves were already flushed by the navigation handler (flushPendingSaves).
  // Here we only clear any leftover timers and reset the overlay for the new
  // schedule, whose fresh fetch is authoritative. Recent edits are not dropped
  // silently — they were sent before the switch.
  useEffect(() => {
    scheduleIdRef.current = scheduleId;
    setEdits(new Map());
    saveTimers.current.forEach((timer) => clearTimeout(timer));
    saveTimers.current.clear();
    pendingSaves.current.clear();
  }, [scheduleId]);

  // Track mount state so a late save result never calls setState after unmount,
  // and flush/clear any pending saves on unmount (SCHED-04).
  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
      saveTimers.current.forEach((timer) => clearTimeout(timer));
      saveTimers.current.clear();
      // Fire any debounced-but-unsent saves so a last-moment edit isn't lost.
      const pending = [...pendingSaves.current.values()];
      pendingSaves.current.clear();
      for (const run of pending) run();
    };
  }, []);

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
    while (cursorMonday <= activeSchedule.endDate && index < MAX_GRID_WEEKS_RUNAWAY_GUARD) {
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
        const resolvedName = shift.employeeName?.trim();
        if (!resolvedName) {
          // SCHED-01: assigned shift with an unresolved name keeps its slot under
          // the defensive crew label, never "Unknown" / treated as open.
          reportSchedulingInvariant("Grid cell assigned shift is missing a resolved name.", {
            shiftId: shift.id,
            employeeId: shift.employeeId
          });
        }
        people.set(shift.employeeId, {
          employeeId: shift.employeeId,
          name: resolvedName || t("calendar.crewMemberFallback"),
          weekdays: new Set([wd])
        });
      }
    }
    return grid;
  }, [shifts, weeks, t]);

  const rosterById = useMemo(() => new Map(roster.map((p) => [p.id, p.fullName] as const)), [roster]);

  // Cells with optimistic edits applied on top of server-derived data, so toggles/add/remove
  // show instantly without waiting for (or re-fetching) the server.
  const effectiveCells = useMemo(() => {
    const grid = new Map<string, Map<string, CellPerson>>();
    for (const [cellKey, people] of cells) {
      const m = new Map<string, CellPerson>();
      for (const [eid, p] of people) {
        m.set(eid, { employeeId: p.employeeId, name: p.name, weekdays: new Set(p.weekdays) });
      }
      grid.set(cellKey, m);
    }
    for (const { cellKey, employeeId, name, weekdays } of edits.values()) {
      let m = grid.get(cellKey);
      if (!m) {
        m = new Map();
        grid.set(cellKey, m);
      }
      if (weekdays.length === 0) {
        m.delete(employeeId);
      } else {
        m.set(employeeId, { employeeId, name, weekdays: new Set(weekdays) });
      }
    }
    return grid;
  }, [cells, edits]);

  // SCHED-04: edits whose background save failed — surfaced with an explicit
  // retry rather than being silently dropped.
  const failedEdits = useMemo(
    () => [...edits.values()].filter((edit) => edit.status === "failed"),
    [edits]
  );

  // Per-employee scheduled hours per ISO week (Monday start) — soft 48h guardrail, never blocking.
  const weeklyHours = useMemo(() => weeklyHoursByEmployee(shifts), [shifts]);

  // Background save for a single cell edit. SCHED-04: the save is tagged with the
  // cell's edit `seq` and the schedule id it was dispatched for; its result is
  // applied ONLY if it still matches the latest edit for that cell on the same
  // schedule — so an out-of-order or stale response can never clobber a newer
  // optimistic value, and a failure surfaces an explicit retry instead of a
  // silent discard.
  const doSave = useCallback(
    async (
      week: WeekRow,
      slot: Slot,
      employeeId: string,
      weekdays: number[],
      seq: number,
      scheduleIdAtDispatch: string
    ) => {
      const cellKey = `${week.index}:${slot.key}`;
      const k = editKey(cellKey, employeeId);

      // Only apply a result if this is still the latest edit for the cell, the
      // component is mounted, and we're still on the schedule it was sent for.
      const stillCurrent = (cur: Map<string, CellEdit>): boolean => {
        if (!isMounted.current) return false;
        if (scheduleIdAtDispatch !== scheduleIdRef.current) return false;
        const current = cur.get(k);
        return Boolean(current && current.seq === seq);
      };

      try {
        const res = await fetch(`/api/v1/scheduling/schedules/${scheduleIdAtDispatch}/grid`, {
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
        if (!isMounted.current) return;
        for (const w of (payload?.data?.warnings ?? []) as string[]) addToast("info", w);
        // Mark acknowledged; the overlay is cleared only after the reconciling
        // refetch lands (see the [shifts] effect below) so it never flickers to
        // stale data, and only if still the latest edit.
        setEdits((cur) => {
          if (!stillCurrent(cur)) return cur;
          const next = new Map(cur);
          next.set(k, { ...cur.get(k)!, status: "saved" });
          return next;
        });
        shiftsQuery.refresh();
      } catch (err) {
        if (!isMounted.current) return;
        addToast("error", err instanceof Error ? err.message : t("grid.toastError"));
        // Keep the optimistic value visible with an explicit FAILED state +
        // retry — never silently discard. Only if still the latest edit.
        setEdits((cur) => {
          if (!stillCurrent(cur)) return cur;
          const next = new Map(cur);
          next.set(k, { ...cur.get(k)!, status: "failed" });
          return next;
        });
      }
    },
    [addToast, t, shiftsQuery]
  );

  // Apply an edit instantly to the UI and debounce the save (coalesces rapid day-toggles).
  const applyEdit = useCallback(
    (week: WeekRow, slot: Slot, employeeId: string, name: string, weekdays: number[]) => {
      if (!activeSchedule) return;
      const cellKey = `${week.index}:${slot.key}`;
      const k = editKey(cellKey, employeeId);
      const seq = (editSeq.current += 1);
      const scheduleIdAtDispatch = activeSchedule.id;
      setEdits((cur) => {
        const next = new Map(cur);
        next.set(k, { cellKey, employeeId, name, weekdays, seq, status: "saving" });
        return next;
      });
      const timers = saveTimers.current;
      const existing = timers.get(k);
      if (existing) clearTimeout(existing);
      const run = () => {
        timers.delete(k);
        pendingSaves.current.delete(k);
        void doSave(week, slot, employeeId, weekdays, seq, scheduleIdAtDispatch);
      };
      // Register the pending save so navigation/unmount can flush it.
      pendingSaves.current.set(k, run);
      timers.set(k, setTimeout(run, 450));
    },
    [activeSchedule, doSave]
  );

  // Retry a previously failed cell edit (SCHED-04).
  const retryEdit = useCallback(
    (edit: CellEdit) => {
      const [weekIndexStr, slotKey] = edit.cellKey.split(":");
      const week = weeks.find((w) => w.index === Number(weekIndexStr));
      const slot = slots.find((s) => s.key === slotKey);
      if (week && slot) {
        applyEdit(week, slot, edit.employeeId, edit.name, edit.weekdays);
      }
    },
    [weeks, slots, applyEdit]
  );

  // Flush all debounced-but-unsent saves immediately (used before switching
  // schedules so recent edits are persisted, not dropped).
  const flushPendingSaves = useCallback(() => {
    const timers = saveTimers.current;
    const runs = [...pendingSaves.current.values()];
    pendingSaves.current.clear();
    for (const [k, timer] of timers) {
      clearTimeout(timer);
      timers.delete(k);
    }
    for (const run of runs) run();
  }, []);

  // Once a reconciling refetch lands (shifts changed), drop overlay edits that
  // the server has already acknowledged ("saved") — the overlay is cleared only
  // AFTER reconciliation, never before (SCHED-04).
  useEffect(() => {
    setEdits((cur) => {
      let changed = false;
      const next = new Map(cur);
      for (const [k, edit] of cur) {
        if (edit.status === "saved") {
          next.delete(k);
          changed = true;
        }
      }
      return changed ? next : cur;
    });
  }, [shifts]);

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
          const sourcePeople = effectiveCells.get(`${source.index}:${slot.key}`);
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
        setEdits(new Map());
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
    [activeSchedule, weeks, slots, effectiveCells, shiftsQuery, addToast, t]
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
          onValueChange={(value) => {
            // SCHED-04: persist recent edits to the current schedule before
            // navigating away, instead of dropping their debounce timers.
            flushPendingSaves();
            setSelectedScheduleId(value);
          }}
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

      {failedEdits.length > 0 ? (
        <div className="schedule-grid-save-failed" role="alert">
          <span className="schedule-grid-save-failed-text">
            {t("grid.saveFailedBanner", { count: failedEdits.length })}
          </span>
          <ul className="schedule-grid-save-failed-list">
            {failedEdits.map((edit) => (
              <li key={`${edit.cellKey}__${edit.employeeId}`}>
                <span>{edit.name}</span>
                <button
                  type="button"
                  className="button button-subtle button-xs"
                  onClick={() => retryEdit(edit)}
                >
                  {t("grid.retrySave")}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

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
                        disabled={copyingWeek !== null}
                        onClick={() => void copyWeek(week)}
                      >
                        {copyingWeek === week.weekStart ? t("grid.copying") : t("grid.copyWeek")}
                      </button>
                    ) : null}
                  </th>
                  {slots.map((slot) => {
                    const cellKey = `${week.index}:${slot.key}`;
                    const people = effectiveCells.get(cellKey);
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
                                        onClick={() => {
                                          const next = new Set(person.weekdays);
                                          if (on) next.delete(wd);
                                          else next.add(wd);
                                          applyEdit(week, slot, person.employeeId, person.name, [...next].sort((a, b) => a - b));
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
                                  onClick={() => applyEdit(week, slot, person.employeeId, person.name, [])}
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
                                const picked = roster.find((r) => r.id === value);
                                applyEdit(
                                  week,
                                  slot,
                                  value,
                                  picked?.fullName ?? "",
                                  defaultWeekdaysForTrack(week, activeSchedule?.scheduleTrack)
                                );
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
                            disabled={available.length === 0}
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
