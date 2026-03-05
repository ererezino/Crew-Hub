"use client";

import { useEffect, useState } from "react";

import { formatDateRangeHuman } from "../../lib/datetime";
import { isIsoDate } from "../../lib/time-off";

type TeamAvailabilityMember = {
  employeeId: string;
  employeeName: string;
  leaveType: string;
  startDate: string;
  endDate: string;
};

type TeamAvailabilityData = {
  teamSize: number;
  overlapping: TeamAvailabilityMember[];
  awayCount: number;
};

type TeamAvailabilityPanelProps = {
  startDate: string;
  endDate: string;
};

export function TeamAvailabilityPanel({ startDate, endDate }: TeamAvailabilityPanelProps) {
  const [data, setData] = useState<TeamAvailabilityData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isIsoDate(startDate) || !isIsoDate(endDate) || endDate < startDate) {
      setData(null);
      setError(null);
      return;
    }

    let cancelled = false;

    async function fetchAvailability() {
      setIsLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams({ start: startDate, end: endDate });
        const response = await fetch(`/api/v1/time-off/team-availability?${params.toString()}`);
        const json = await response.json();

        if (cancelled) return;

        if (!response.ok || json.error) {
          setError(json.error?.message ?? "Unable to load team availability.");
          setData(null);
        } else {
          setData(json.data);
          setError(null);
        }
      } catch {
        if (!cancelled) {
          setError("Unable to load team availability.");
          setData(null);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    fetchAvailability();

    return () => {
      cancelled = true;
    };
  }, [startDate, endDate]);

  // Don't render anything when dates are not both set
  if (!isIsoDate(startDate) || !isIsoDate(endDate) || endDate < startDate) {
    return null;
  }

  if (isLoading) {
    return (
      <div className="team-availability-panel">
        <div className="team-availability-skeleton" />
      </div>
    );
  }

  if (error) {
    return null;
  }

  if (!data) {
    return null;
  }

  // No team members at all — nothing to show
  if (data.teamSize === 0) {
    return null;
  }

  const severity =
    data.awayCount === 0 ? "green" : data.awayCount <= 2 ? "amber" : "red";

  return (
    <div className="team-availability-panel">
      <div className={`team-availability-indicator team-availability-${severity}`}>
        {severity === "green" ? (
          <p>No team members are off during these dates</p>
        ) : severity === "red" ? (
          <>
            <p className="team-availability-warning">
              High team overlap &mdash; {data.awayCount} team member{data.awayCount === 1 ? "" : "s"} away
            </p>
            {data.overlapping.map((member) => (
              <div key={`${member.employeeId}-${member.startDate}`} className="team-availability-member">
                <span className="team-availability-member-name">{member.employeeName}</span>
                <span className="team-availability-member-detail">
                  {member.leaveType} &middot; {formatDateRangeHuman(member.startDate, member.endDate)}
                </span>
              </div>
            ))}
          </>
        ) : (
          <>
            <p>
              {data.awayCount} team member{data.awayCount === 1 ? "" : "s"} away during these dates
            </p>
            {data.overlapping.map((member) => (
              <div key={`${member.employeeId}-${member.startDate}`} className="team-availability-member">
                <span className="team-availability-member-name">{member.employeeName}</span>
                <span className="team-availability-member-detail">
                  {member.leaveType} &middot; {formatDateRangeHuman(member.startDate, member.endDate)}
                </span>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
