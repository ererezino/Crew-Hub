"use client";

import { useTranslations } from "next-intl";

import type { ScheduleRecord } from "../../types/scheduling";
import { formatDateRange } from "../../lib/datetime";
import { formatScheduleStatus } from "../../lib/format-labels";

type ScheduleCardProps = {
  schedule: ScheduleRecord;
  onPublish: (id: string) => void;
  onRegenerate: (id: string) => void;
  onDelete: (id: string) => void;
  onViewShifts: (id: string) => void;
  isPublishing?: boolean;
};


export function ScheduleCard({
  schedule,
  onPublish,
  onRegenerate,
  onDelete,
  onViewShifts,
  isPublishing
}: ScheduleCardProps) {
  const t = useTranslations("scheduling");
  const tc = useTranslations("common");
  const trackLabel = schedule.scheduleTrack === "weekend" ? t("track.weekend") : t("track.weekday");
  const canDelete = schedule.status !== "locked";
  const primaryActionLabel = schedule.status === "draft" ? tc("edit") : t("card.viewShifts");

  return (
    <article className="schedule-card">
      <div className="schedule-card-header">
        <div className="schedule-card-badges">
          <span className={`schedule-track-badge schedule-track-badge-${schedule.scheduleTrack}`}>
            {trackLabel}
          </span>
          <span className={`status-badge status-badge-${schedule.status}`}>
            {formatScheduleStatus(schedule.status)}
          </span>
        </div>
      </div>

      <h3 className="schedule-card-title">
        {schedule.name || formatDateRange(schedule.startDate, schedule.endDate)}
      </h3>

      <div className="schedule-card-meta">
        <span>{formatDateRange(schedule.startDate, schedule.endDate)}</span>
        <span>{t("card.shiftCount", { count: schedule.shiftCount })}</span>
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
          {primaryActionLabel}
        </button>

        {schedule.status === "draft" ? (
          <button
            type="button"
            className="button button-ghost"
            onClick={() => onRegenerate(schedule.id)}
            disabled={isPublishing}
          >
            {tc("retry")}
          </button>
        ) : null}

        {schedule.status === "draft" ? (
          <button
            type="button"
            className="button button-primary"
            onClick={() => onPublish(schedule.id)}
            disabled={isPublishing || schedule.shiftCount === 0}
          >
            {isPublishing ? tc("publishing") : tc("publish")}
          </button>
        ) : null}
        <button
          type="button"
          className={`button button-ghost schedule-card-delete ${!canDelete ? "schedule-card-delete-disabled" : ""}`}
          onClick={() => onDelete(schedule.id)}
          title={canDelete ? t("card.deleteSchedule") : t("card.deleteDisabled")}
          disabled={!canDelete}
          aria-label={canDelete ? t("card.deleteSchedule") : t("card.deleteDisabled")}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ width: 16, height: 16 }}>
            <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
          <span>{tc("delete")}</span>
        </button>
      </div>
    </article>
  );
}
