"use client";

import type { ScheduleRecord } from "../../types/scheduling";
import { ScheduleCard } from "./schedule-card";

type ScheduleCardGridProps = {
  schedules: ScheduleRecord[];
  onPublish: (id: string) => void;
  onDelete: (id: string) => void;
  onViewShifts: (id: string) => void;
  onCreateNew: () => void;
  publishingId: string | null;
};

export function ScheduleCardGrid({
  schedules,
  onPublish,
  onDelete,
  onViewShifts,
  onCreateNew,
  publishingId
}: ScheduleCardGridProps) {
  if (schedules.length === 0) {
    return (
      <div className="schedule-empty-state">
        <div className="schedule-empty-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
            <path d="M12 14v4m-2-2h4" />
          </svg>
        </div>
        <h3 className="schedule-empty-title">No schedules yet</h3>
        <p className="schedule-empty-desc">
          Create your first monthly schedule in a few clicks.
        </p>
        <button type="button" className="button button-primary" onClick={onCreateNew}>
          Create Schedule
        </button>
      </div>
    );
  }

  return (
    <div className="schedule-card-grid">
      {schedules.map((schedule) => (
        <ScheduleCard
          key={schedule.id}
          schedule={schedule}
          onPublish={onPublish}
          onDelete={onDelete}
          onViewShifts={onViewShifts}
          isPublishing={publishingId === schedule.id}
        />
      ))}
    </div>
  );
}
