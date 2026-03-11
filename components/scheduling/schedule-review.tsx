"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import type { ScheduleTrack } from "../../types/scheduling";
import { formatDateRange } from "../../lib/datetime";

type ReviewWarning = {
  message: string;
};

type ScheduleReviewProps = {
  track: ScheduleTrack;
  month: string;
  months: number;
  startDate: string;
  endDate: string;
  employeeCount: number;
  estimatedShifts: number;
  warnings: ReviewWarning[];
  shiftDetails?: Array<{
    employeeName: string;
    shiftDate: string;
    slotName: string;
    startTime: string;
    endTime: string;
  }>;
  isGenerating: boolean;
};


export function ScheduleReview({
  track,
  startDate,
  endDate,
  employeeCount,
  estimatedShifts,
  warnings,
  shiftDetails,
  isGenerating
}: ScheduleReviewProps) {
  const t = useTranslations("scheduling");
  const [showDetails, setShowDetails] = useState(false);

  return (
    <div className="schedule-review">
      {isGenerating ? (
        <div className="schedule-review-generating">
          <div className="schedule-review-spinner" />
          <p>{t("review.generating")}</p>
        </div>
      ) : (
        <>
          <div className="schedule-review-summary">
            <div className="schedule-review-row">
              <span className="schedule-review-label">{t("review.labelTrack")}</span>
              <span className="schedule-review-value">
                <span className={`schedule-track-badge schedule-track-badge-${track}`}>
                  {track === "weekday" ? t("track.weekday") : t("track.weekend")}
                </span>
              </span>
            </div>
            <div className="schedule-review-row">
              <span className="schedule-review-label">{t("review.labelPeriod")}</span>
              <span className="schedule-review-value">{formatDateRange(startDate, endDate)}</span>
            </div>
            <div className="schedule-review-row">
              <span className="schedule-review-label">{t("review.labelTeamMembers")}</span>
              <span className="schedule-review-value">{t("review.selectedCount", { count: employeeCount })}</span>
            </div>
            <div className="schedule-review-row">
              <span className="schedule-review-label">{t("review.labelShiftsGenerated")}</span>
              <span className="schedule-review-value">{estimatedShifts}</span>
            </div>
          </div>

          {warnings.length > 0 ? (
            <div className="schedule-review-warnings">
              <h4 className="schedule-review-warnings-title">{t("review.headsUp")}</h4>
              <ul>
                {warnings.map((w, i) => (
                  <li key={i}>{w.message}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {shiftDetails && shiftDetails.length > 0 ? (
            <div className="schedule-review-details">
              <button
                type="button"
                className="button button-ghost schedule-review-toggle"
                onClick={() => setShowDetails(!showDetails)}
              >
                {showDetails ? t("review.hideDetails") : t("review.viewDetails")}
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ width: 16, height: 16, transform: showDetails ? "rotate(180deg)" : undefined, transition: "transform 0.2s" }}>
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </button>

              {showDetails ? (
                <div className="data-table-container" style={{ maxHeight: 300, overflow: "auto" }}>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>{t("review.colEmployee")}</th>
                        <th>{t("review.colDate")}</th>
                        <th>{t("review.colShift")}</th>
                        <th>{t("review.colTime")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shiftDetails.slice(0, 100).map((shift, i) => (
                        <tr key={i}>
                          <td>{shift.employeeName}</td>
                          <td>{shift.shiftDate}</td>
                          <td>{shift.slotName}</td>
                          <td>{shift.startTime} &ndash; {shift.endTime}</td>
                        </tr>
                      ))}
                      {shiftDetails.length > 100 ? (
                        <tr>
                          <td colSpan={4} style={{ textAlign: "center", color: "#7A8A99" }}>
                            {t("review.moreShifts", { count: shiftDetails.length - 100 })}
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
