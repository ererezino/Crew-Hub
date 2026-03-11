"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { ConfirmDialog } from "../../../../components/shared/confirm-dialog";
import { ShiftEditModal } from "../../../../components/scheduling/shift-edit-modal";
import { TeamScheduleCalendar } from "../../../../components/scheduling/team-schedule-calendar";
import { useSchedulingSchedules, useSchedulingShifts } from "../../../../hooks/use-scheduling";
import { usePeople } from "../../../../hooks/use-people";
import { areDepartmentsEqual } from "../../../../lib/department";
import { formatDateShort, formatMonth } from "../../../../lib/datetime";
import type { ShiftRecord } from "../../../../types/scheduling";

type ToastMessage = {
  id: number;
  type: "success" | "error" | "info";
  text: string;
};

type PendingMove = {
  shift: ShiftRecord;
  targetDate: string;
};

type ShiftEditFormValues = {
  employeeId: string | null;
  shiftDate: string;
  startTime: string;
  endTime: string;
};

let toastCounter = 0;
const SHIFT_EDIT_TOAST_SUCCESS = "Shift updated successfully.";
const SHIFT_EDIT_TOAST_ERROR = "Unable to update shift.";

function formatShiftMoveDate(isoDate: string): string {
  return formatDateShort(isoDate);
}

export function SchedulingCalendarClient({
  canManageShifts = false,
  initialScheduleId = null
}: {
  canManageShifts?: boolean;
  initialScheduleId?: string | null;
}) {
  const t = useTranslations("scheduling");
  const tc = useTranslations("common");
  const includeUnpublishedSchedule = canManageShifts && Boolean(initialScheduleId);
  const schedulesQuery = useSchedulingSchedules({
    scope: "team",
    status: includeUnpublishedSchedule ? undefined : "published"
  });
  const schedulesData = schedulesQuery.data;
  const schedules = useMemo(() => schedulesData?.schedules ?? [], [schedulesData]);
  const visibleSchedules = schedules;

  // Default to the most recent published schedule
  const [selectedScheduleId, setSelectedScheduleId] = useState<string | null>(null);
  const [pendingMove, setPendingMove] = useState<PendingMove | null>(null);
  const [editingShift, setEditingShift] = useState<ShiftRecord | null>(null);
  const [isMovingShift, setIsMovingShift] = useState(false);
  const [isSavingShiftEdit, setIsSavingShiftEdit] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const peopleQuery = usePeople({ scope: "all", enabled: canManageShifts });

  const activeSchedule = useMemo(() => {
    if (visibleSchedules.length === 0) return null;
    if (selectedScheduleId) {
      return visibleSchedules.find((s) => s.id === selectedScheduleId) ?? visibleSchedules[0]!;
    }
    return visibleSchedules[0]!;
  }, [visibleSchedules, selectedScheduleId]);

  const shiftsQuery = useSchedulingShifts(
    activeSchedule
      ? { scope: "team", scheduleId: activeSchedule.id }
      : {}
  );

  const shifts = useMemo(() => shiftsQuery.data?.shifts ?? [], [shiftsQuery.data]);
  const isLoading = schedulesQuery.isLoading || shiftsQuery.isLoading;
  const activeScheduleMembers = useMemo(() => {
    const byId = new Map<string, { id: string; fullName: string; department: string | null }>();

    for (const person of peopleQuery.people) {
      if (person.status !== "active" && person.status !== "onboarding") {
        continue;
      }

      byId.set(person.id, {
        id: person.id,
        fullName: person.fullName,
        department: person.department
      });
    }

    for (const shift of shifts) {
      if (!shift.employeeId || !shift.employeeName) {
        continue;
      }

      if (!byId.has(shift.employeeId)) {
        byId.set(shift.employeeId, {
          id: shift.employeeId,
          fullName: shift.employeeName,
          department: shift.employeeDepartment
        });
      }
    }

    let members = [...byId.values()];

    if (activeSchedule?.department && activeSchedule.department.trim().length > 0) {
      members = members.filter((member) =>
        areDepartmentsEqual(member.department, activeSchedule.department)
      );
    }

    return members
      .map((member) => ({ id: member.id, fullName: member.fullName }))
      .sort((left, right) => left.fullName.localeCompare(right.fullName));
  }, [activeSchedule?.department, peopleQuery.people, shifts]);

  useEffect(() => {
    if (!initialScheduleId) {
      return;
    }

    setSelectedScheduleId((current) => current ?? initialScheduleId);
  }, [initialScheduleId]);

  useEffect(() => {
    if (toasts.length === 0) return;
    const timer = setTimeout(() => {
      setToasts((current) => current.slice(1));
    }, 4000);
    return () => clearTimeout(timer);
  }, [toasts]);

  const addToast = useCallback((type: ToastMessage["type"], text: string) => {
    setToasts((current) => [...current, { id: ++toastCounter, type, text }]);
  }, []);

  const scheduleTrackLabel = activeSchedule
    ? activeSchedule.scheduleTrack === "weekend"
      ? t("track.weekend")
      : t("track.weekday")
    : "";
  const scheduleSummary = activeSchedule
    ? `${activeSchedule.name ?? t("calendar.publishedSchedule")} · ${scheduleTrackLabel} ${t("track.trackSuffix")}`
    : "";

  const handleRequestMove = useCallback((shift: ShiftRecord, targetDate: string) => {
    setPendingMove({ shift, targetDate });
  }, []);

  const handleConfirmMove = useCallback(async () => {
    if (!pendingMove) return;

    setIsMovingShift(true);
    try {
      const response = await fetch(`/api/v1/scheduling/shifts/${pendingMove.shift.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          shiftDate: pendingMove.targetDate
        })
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error?.message ?? t("shiftMove.toastError"));
      }

      addToast("success", t("shiftMove.toastSuccess"));
      shiftsQuery.refresh();
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : t("shiftMove.toastError"));
    } finally {
      setIsMovingShift(false);
      setPendingMove(null);
    }
  }, [addToast, pendingMove, shiftsQuery, t]);

  const handleSaveShiftEdit = useCallback(async (values: ShiftEditFormValues) => {
    if (!editingShift) {
      return;
    }

    setIsSavingShiftEdit(true);

    try {
      const response = await fetch(`/api/v1/scheduling/shifts/${editingShift.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          employeeId: values.employeeId,
          shiftDate: values.shiftDate,
          startTime: values.startTime,
          endTime: values.endTime
        })
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error?.message ?? SHIFT_EDIT_TOAST_ERROR);
      }

      addToast("success", SHIFT_EDIT_TOAST_SUCCESS);
      setEditingShift(null);
      shiftsQuery.refresh();
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : SHIFT_EDIT_TOAST_ERROR);
    } finally {
      setIsSavingShiftEdit(false);
    }
  }, [addToast, editingShift, shiftsQuery]);

  if (isLoading) {
    return (
      <section className="compensation-layout">
        <div className="table-skeleton">
          <div className="table-skeleton-header" />
          <div className="table-skeleton-row" />
          <div className="table-skeleton-row" />
          <div className="table-skeleton-row" />
        </div>
      </section>
    );
  }

  return (
    <section className="compensation-layout">
      {/* Schedule selector */}
      {visibleSchedules.length > 1 ? (
        <div className="schedule-calendar-controls">
          <label className="form-label" htmlFor="schedule-selector">{t("calendar.scheduleLabel")}</label>
          <select
            id="schedule-selector"
            className="form-input"
            value={activeSchedule?.id ?? ""}
            onChange={(e) => setSelectedScheduleId(e.target.value)}
          >
            {visibleSchedules.map((s) => (
              <option key={s.id} value={s.id}>
                {t("calendar.scheduleDateRange", { name: s.name ?? t("calendar.scheduleLabel"), startDate: s.startDate, endDate: s.endDate })}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {activeSchedule ? (
        <>
          <div className="schedule-calendar-title">
            <h3 className="section-title">
              {formatMonth(activeSchedule.startDate)}
            </h3>
            <p className="settings-card-description">
              {scheduleSummary}
            </p>
            {canManageShifts ? (
              <p className="teamcal-helper-text">
                {t("calendar.dragHelper")}
              </p>
            ) : null}
          </div>
          <TeamScheduleCalendar
            shifts={shifts}
            scheduleStartDate={activeSchedule.startDate}
            scheduleEndDate={activeSchedule.endDate}
            canManage={canManageShifts}
            onRequestMove={handleRequestMove}
            onShiftSelect={canManageShifts ? setEditingShift : undefined}
          />
        </>
      ) : (
        <TeamScheduleCalendar
          shifts={[]}
          scheduleStartDate={new Date().toISOString().slice(0, 10)}
          scheduleEndDate={new Date().toISOString().slice(0, 10)}
          canManage={false}
          onRequestMove={() => {
            // no-op for empty state
          }}
          onShiftSelect={undefined}
        />
      )}

      <ConfirmDialog
        isOpen={pendingMove !== null}
        title={t("shiftMove.confirmTitle")}
        description={
          pendingMove
            ? t("shiftMove.confirmBody", {
                employeeName: pendingMove.shift.employeeName ?? t("shiftMove.crewMember"),
                fromDate: formatShiftMoveDate(pendingMove.shift.shiftDate),
                toDate: formatShiftMoveDate(pendingMove.targetDate)
              })
            : undefined
        }
        confirmLabel={t("shiftMove.confirmButton")}
        onConfirm={() => {
          void handleConfirmMove();
        }}
        onCancel={() => setPendingMove(null)}
        isConfirming={isMovingShift}
      />

      {editingShift ? (
        <ShiftEditModal
          key={`${editingShift.id}:${editingShift.updatedAt}`}
          isOpen
          shift={editingShift}
          assignees={activeScheduleMembers}
          minDate={activeSchedule?.startDate ?? new Date().toISOString().slice(0, 10)}
          maxDate={activeSchedule?.endDate ?? new Date().toISOString().slice(0, 10)}
          isSubmitting={isSavingShiftEdit}
          onClose={() => setEditingShift(null)}
          onSubmit={(values) => {
            void handleSaveShiftEdit(values);
          }}
        />
      ) : null}

      {toasts.length > 0 ? (
        <section className="toast-region" aria-live="polite">
          {toasts.map((toast) => (
            <div key={toast.id} className={`toast-message toast-message-${toast.type}`}>
              <span>{toast.text}</span>
              <button
                type="button"
                className="icon-button"
                onClick={() => setToasts((current) => current.filter((entry) => entry.id !== toast.id))}
                aria-label={tc("dismiss")}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          ))}
        </section>
      ) : null}
    </section>
  );
}
