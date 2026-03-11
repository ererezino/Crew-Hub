"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { ConfirmDialog } from "../../../../components/shared/confirm-dialog";
import { TeamScheduleCalendar } from "../../../../components/scheduling/team-schedule-calendar";
import { useSchedulingSchedules, useSchedulingShifts } from "../../../../hooks/use-scheduling";
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

let toastCounter = 0;

function formatShiftMoveDate(isoDate: string): string {
  return formatDateShort(isoDate);
}

export function SchedulingCalendarClient({
  canManageShifts = false,
  initialScheduleId = null,
  viewerDepartment = null
}: {
  canManageShifts?: boolean;
  initialScheduleId?: string | null;
  viewerDepartment?: string | null;
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
  const visibleSchedules = useMemo(() => {
    if (canManageShifts || !viewerDepartment) {
      return schedules;
    }

    return schedules.filter((schedule) => areDepartmentsEqual(schedule.department, viewerDepartment));
  }, [canManageShifts, schedules, viewerDepartment]);

  // Default to the most recent published schedule
  const [selectedScheduleId, setSelectedScheduleId] = useState<string | null>(null);
  const [pendingMove, setPendingMove] = useState<PendingMove | null>(null);
  const [isMovingShift, setIsMovingShift] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

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

  const shifts = shiftsQuery.data?.shifts ?? [];
  const isLoading = schedulesQuery.isLoading || shiftsQuery.isLoading;

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
                {s.name ?? t("calendar.scheduleLabel")} &mdash; {s.startDate} to {s.endDate}
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
              {activeSchedule.name ?? t("calendar.publishedSchedule")} &middot;{" "}
              {activeSchedule.scheduleTrack === "weekend" ? t("track.weekend") : t("track.weekday")} {t("track.trackSuffix")}
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
