"use client";

import { useMemo, useState } from "react";

import { ScheduleCalendar } from "../../../../components/scheduling/schedule-calendar";
import { useSchedulingSchedules, useSchedulingShifts } from "../../../../hooks/use-scheduling";

export function SchedulingCalendarClient({ embedded = false }: { embedded?: boolean }) {
  const schedulesQuery = useSchedulingSchedules({ scope: "team", status: "published" });
  const schedules = schedulesQuery.data?.schedules ?? [];

  // Default to the most recent published schedule
  const [selectedScheduleId, setSelectedScheduleId] = useState<string | null>(null);

  const activeSchedule = useMemo(() => {
    if (schedules.length === 0) return null;
    if (selectedScheduleId) {
      return schedules.find((s) => s.id === selectedScheduleId) ?? schedules[0]!;
    }
    return schedules[0]!;
  }, [schedules, selectedScheduleId]);

  const shiftsQuery = useSchedulingShifts(
    activeSchedule
      ? { scope: "team", scheduleId: activeSchedule.id }
      : {}
  );

  const shifts = shiftsQuery.data?.shifts ?? [];
  const isLoading = schedulesQuery.isLoading || shiftsQuery.isLoading;

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
      {schedules.length > 1 ? (
        <div className="schedule-calendar-controls">
          <label className="form-label" htmlFor="schedule-selector">Schedule</label>
          <select
            id="schedule-selector"
            className="form-input"
            value={activeSchedule?.id ?? ""}
            onChange={(e) => setSelectedScheduleId(e.target.value)}
          >
            {schedules.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name ?? "Schedule"} &mdash; {s.startDate} to {s.endDate}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {activeSchedule ? (
        <>
          <div className="schedule-calendar-title">
            <h3 className="section-title">
              {new Date(activeSchedule.startDate + "T00:00:00").toLocaleDateString("en-US", {
                month: "long",
                year: "2-digit"
              })}
            </h3>
            <p className="settings-card-description">
              {activeSchedule.name ?? "Published schedule"} &middot;{" "}
              {activeSchedule.scheduleTrack === "weekend" ? "Weekend" : "Weekday"} track
            </p>
          </div>
          <ScheduleCalendar
            shifts={shifts}
            startDate={activeSchedule.startDate}
            endDate={activeSchedule.endDate}
            scheduleTrack={activeSchedule.scheduleTrack}
          />
        </>
      ) : (
        <ScheduleCalendar
          shifts={[]}
          startDate=""
          endDate=""
          scheduleTrack="weekday"
        />
      )}
    </section>
  );
}
