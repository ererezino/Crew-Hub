"use client";

import type { ScheduleTrack } from "../../types/scheduling";

type TrackSelectorProps = {
  value: ScheduleTrack | null;
  onChange: (track: ScheduleTrack) => void;
};

const TRACKS: Array<{
  value: ScheduleTrack;
  title: string;
  description: string;
  icon: string;
}> = [
  {
    value: "weekday",
    title: "Weekday Schedule",
    description: "Monday through Friday shifts for the team.",
    icon: "M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
  },
  {
    value: "weekend",
    title: "Weekend Schedule",
    description: "Saturday and Sunday coverage shifts.",
    icon: "M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"
  }
];

export function TrackSelector({ value, onChange }: TrackSelectorProps) {
  return (
    <div className="schedule-track-selector">
      {TRACKS.map((track) => {
        const isSelected = value === track.value;
        return (
          <button
            key={track.value}
            type="button"
            className={`schedule-track-card ${isSelected ? "schedule-track-card-selected" : ""}`}
            onClick={() => onChange(track.value)}
          >
            <div className="schedule-track-card-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d={track.icon} />
              </svg>
            </div>
            <h3 className="schedule-track-card-title">{track.title}</h3>
            <p className="schedule-track-card-desc">{track.description}</p>
            {isSelected ? (
              <div className="schedule-track-card-check">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M5 13l4 4L19 7" />
                </svg>
              </div>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
