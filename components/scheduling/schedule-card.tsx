"use client";

import type { ScheduleRecord } from "../../types/scheduling";

type ScheduleCardProps = {
  schedule: ScheduleRecord;
  onPublish: (id: string) => void;
  onDelete: (id: string) => void;
  onViewShifts: (id: string) => void;
  isPublishing?: boolean;
};

function formatDateRange(start: string, end: string): string {
  const startDate = new Date(`${start}T00:00:00Z`);
  const endDate = new Date(`${end}T00:00:00Z`);

  const startLabel = startDate.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC"
  });
  const endLabel = endDate.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC"
  });

  return `${startLabel} \u2013 ${endLabel}`;
}

function statusLabel(status: string): string {
  switch (status) {
    case "draft": return "Draft";
    case "published": return "Published";
    case "locked": return "Locked";
    default: return status;
  }
}

export function ScheduleCard({ schedule, onPublish, onDelete, onViewShifts, isPublishing }: ScheduleCardProps) {
  const trackLabel = schedule.scheduleTrack === "weekend" ? "Weekend" : "Weekday";
  const canDelete = schedule.status === "draft";

  return (
    <article className="schedule-card">
      <div className="schedule-card-header">
        <div className="schedule-card-badges">
          <span className={`schedule-track-badge schedule-track-badge-${schedule.scheduleTrack}`}>
            {trackLabel}
          </span>
          <span className={`status-badge status-badge-${schedule.status}`}>
            {statusLabel(schedule.status)}
          </span>
        </div>
      </div>

      <h3 className="schedule-card-title">
        {schedule.name || formatDateRange(schedule.startDate, schedule.endDate)}
      </h3>

      <div className="schedule-card-meta">
        <span>{formatDateRange(schedule.startDate, schedule.endDate)}</span>
        <span>{schedule.shiftCount} {schedule.shiftCount === 1 ? "shift" : "shifts"}</span>
      </div>

      {schedule.department ? (
        <div className="schedule-card-dept">{schedule.department}</div>
      ) : null}

      <div className="schedule-card-actions">
        <button
          type="button"
          className="button button-ghost"
          onClick={() => onViewShifts(schedule.id)}
        >
          View Shifts
        </button>

        {schedule.status === "draft" ? (
          <button
            type="button"
            className="button button-primary"
            onClick={() => onPublish(schedule.id)}
            disabled={isPublishing || schedule.shiftCount === 0}
          >
            {isPublishing ? "Publishing..." : "Publish"}
          </button>
        ) : null}
        <button
          type="button"
          className={`button button-ghost schedule-card-delete ${!canDelete ? "schedule-card-delete-disabled" : ""}`}
          onClick={() => onDelete(schedule.id)}
          title={canDelete ? "Delete schedule" : "Only draft schedules can be deleted."}
          disabled={!canDelete}
          aria-label={canDelete ? "Delete schedule" : "Only draft schedules can be deleted"}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ width: 16, height: 16 }}>
            <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      </div>
    </article>
  );
}
