"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

import { EmptyState } from "../../../../components/shared/empty-state";
import { PageHeader } from "../../../../components/shared/page-header";
import { StatusBadge } from "../../../../components/shared/status-badge";
import {
  useSchedulingSchedules,
  useSchedulingShifts,
  useSchedulingTemplates
} from "../../../../hooks/use-scheduling";
import { countryFlagFromCode, countryNameFromCode } from "../../../../lib/countries";
import { formatDateTimeTooltip, formatRelativeTime } from "../../../../lib/datetime";
import { formatScheduleStatus, formatShiftStatus } from "../../../../lib/format-labels";
import { formatTimeRangeLabel } from "../../../../lib/scheduling";
import type { PeopleListResponse } from "../../../../types/people";
import type { ShiftStatus } from "../../../../types/scheduling";

type SortDirection = "asc" | "desc";

type PersonOption = {
  id: string;
  fullName: string;
  department: string | null;
  countryCode: string | null;
};

type ScheduleFormState = {
  name: string;
  department: string;
  weekStart: string;
  weekEnd: string;
};

type ShiftFormState = {
  scheduleId: string;
  templateId: string;
  employeeId: string;
  shiftDate: string;
  startTime: string;
  endTime: string;
  breakMinutes: string;
  notes: string;
};

function toneForShiftStatus(status: ShiftStatus) {
  switch (status) {
    case "scheduled":
      return "info" as const;
    case "swap_requested":
      return "pending" as const;
    case "swapped":
      return "success" as const;
    case "cancelled":
      return "error" as const;
    default:
      return "draft" as const;
  }
}

function toneForScheduleStatus(status: "draft" | "published" | "locked") {
  switch (status) {
    case "draft":
      return "draft" as const;
    case "published":
      return "success" as const;
    case "locked":
      return "processing" as const;
    default:
      return "draft" as const;
  }
}

function manageSkeleton() {
  return (
    <section className="timeoff-skeleton-layout" aria-hidden="true">
      <div className="table-skeleton">
        <div className="table-skeleton-header" />
        {Array.from({ length: 6 }, (_, index) => (
          <div key={`schedule-manage-skeleton-${index}`} className="table-skeleton-row" />
        ))}
      </div>
      <div className="table-skeleton">
        <div className="table-skeleton-header" />
        {Array.from({ length: 6 }, (_, index) => (
          <div key={`shift-manage-skeleton-${index}`} className="table-skeleton-row" />
        ))}
      </div>
    </section>
  );
}

const defaultScheduleForm: ScheduleFormState = {
  name: "",
  department: "",
  weekStart: "",
  weekEnd: ""
};

const defaultShiftForm: ShiftFormState = {
  scheduleId: "",
  templateId: "",
  employeeId: "",
  shiftDate: "",
  startTime: "",
  endTime: "",
  breakMinutes: "0",
  notes: ""
};

export function SchedulingManageClient({ embedded = false }: { embedded?: boolean }) {
  const schedulesQuery = useSchedulingSchedules({
    scope: "team"
  });
  const shiftsQuery = useSchedulingShifts({
    scope: "team"
  });
  const templatesQuery = useSchedulingTemplates();

  const [people, setPeople] = useState<PersonOption[]>([]);
  const [isLoadingPeople, setIsLoadingPeople] = useState(true);
  const [peopleError, setPeopleError] = useState<string | null>(null);

  const [scheduleForm, setScheduleForm] = useState<ScheduleFormState>(defaultScheduleForm);
  const [shiftForm, setShiftForm] = useState<ShiftFormState>(defaultShiftForm);
  const [scheduleFormError, setScheduleFormError] = useState<string | null>(null);
  const [shiftFormError, setShiftFormError] = useState<string | null>(null);
  const [submitMessage, setSubmitMessage] = useState<string | null>(null);
  const [isSubmittingSchedule, setIsSubmittingSchedule] = useState(false);
  const [isSubmittingShift, setIsSubmittingShift] = useState(false);
  const [isPublishingScheduleId, setIsPublishingScheduleId] = useState<string | null>(null);
  const [scheduleSortDirection, setScheduleSortDirection] = useState<SortDirection>("desc");
  const [shiftSortDirection, setShiftSortDirection] = useState<SortDirection>("asc");

  useEffect(() => {
    const abortController = new AbortController();

    const run = async () => {
      setIsLoadingPeople(true);
      setPeopleError(null);

      try {
        const response = await fetch("/api/v1/people?scope=all&limit=250", {
          method: "GET",
          signal: abortController.signal
        });
        const payload = (await response.json()) as PeopleListResponse;

        if (!response.ok || !payload.data) {
          setPeople([]);
          setPeopleError(payload.error?.message ?? "Unable to load team members.");
          return;
        }

        setPeople(
          payload.data.people.map((person) => ({
            id: person.id,
            fullName: person.fullName,
            department: person.department,
            countryCode: person.countryCode
          }))
        );
      } catch (error) {
        if (abortController.signal.aborted) {
          return;
        }

        setPeople([]);
        setPeopleError(error instanceof Error ? error.message : "Unable to load team members.");
      } finally {
        if (!abortController.signal.aborted) {
          setIsLoadingPeople(false);
        }
      }
    };

    void run();

    return () => {
      abortController.abort();
    };
  }, []);

  const sortedSchedules = useMemo(() => {
    const rows = schedulesQuery.data?.schedules ?? [];

    return [...rows].sort((leftSchedule, rightSchedule) => {
      const leftValue = new Date(`${leftSchedule.weekStart}T00:00:00.000Z`).getTime();
      const rightValue = new Date(`${rightSchedule.weekStart}T00:00:00.000Z`).getTime();

      return scheduleSortDirection === "asc" ? leftValue - rightValue : rightValue - leftValue;
    });
  }, [schedulesQuery.data?.schedules, scheduleSortDirection]);

  const sortedShifts = useMemo(() => {
    const rows = shiftsQuery.data?.shifts ?? [];

    return [...rows].sort((leftShift, rightShift) => {
      const leftValue = new Date(leftShift.startTime).getTime();
      const rightValue = new Date(rightShift.startTime).getTime();

      return shiftSortDirection === "asc" ? leftValue - rightValue : rightValue - leftValue;
    });
  }, [shiftSortDirection, shiftsQuery.data?.shifts]);

  async function handleCreateSchedule(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setScheduleFormError(null);
    setSubmitMessage(null);

    if (!scheduleForm.weekStart.trim()) {
      setScheduleFormError("Week start is required.");
      return;
    }

    setIsSubmittingSchedule(true);

    try {
      const response = await fetch("/api/v1/scheduling/schedules", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          name: scheduleForm.name,
          department: scheduleForm.department || undefined,
          weekStart: scheduleForm.weekStart,
          weekEnd: scheduleForm.weekEnd || undefined
        })
      });
      const payload = (await response.json()) as {
        data: unknown;
        error: { message?: string } | null;
      };

      if (!response.ok) {
        setScheduleFormError(payload.error?.message ?? "Unable to create schedule.");
        return;
      }

      setScheduleForm(defaultScheduleForm);
      setSubmitMessage("Schedule created.");
      schedulesQuery.refresh();
    } catch (error) {
      setScheduleFormError(error instanceof Error ? error.message : "Unable to create schedule.");
    } finally {
      setIsSubmittingSchedule(false);
    }
  }

  async function handleCreateShift(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setShiftFormError(null);
    setSubmitMessage(null);

    if (!shiftForm.scheduleId || !shiftForm.shiftDate || !shiftForm.startTime || !shiftForm.endTime) {
      setShiftFormError("Schedule, date, start time, and end time are required.");
      return;
    }

    setIsSubmittingShift(true);

    try {
      const response = await fetch("/api/v1/scheduling/shifts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          scheduleId: shiftForm.scheduleId,
          templateId: shiftForm.templateId || undefined,
          employeeId: shiftForm.employeeId || undefined,
          shiftDate: shiftForm.shiftDate,
          startTime: shiftForm.startTime,
          endTime: shiftForm.endTime,
          breakMinutes: Number.parseInt(shiftForm.breakMinutes || "0", 10),
          notes: shiftForm.notes || undefined
        })
      });
      const payload = (await response.json()) as {
        data: unknown;
        error: { message?: string } | null;
      };

      if (!response.ok) {
        setShiftFormError(payload.error?.message ?? "Unable to create shift.");
        return;
      }

      setShiftForm(defaultShiftForm);
      setSubmitMessage("Shift created.");
      shiftsQuery.refresh();
      schedulesQuery.refresh();
    } catch (error) {
      setShiftFormError(error instanceof Error ? error.message : "Unable to create shift.");
    } finally {
      setIsSubmittingShift(false);
    }
  }

  async function handlePublishSchedule(scheduleId: string) {
    setIsPublishingScheduleId(scheduleId);
    setSubmitMessage(null);

    try {
      const response = await fetch(`/api/v1/scheduling/schedules/${scheduleId}/publish`, {
        method: "POST"
      });
      const payload = (await response.json()) as {
        data: unknown;
        error: { message?: string } | null;
      };

      if (!response.ok) {
        setSubmitMessage(payload.error?.message ?? "Unable to publish schedule.");
        return;
      }

      setSubmitMessage("Schedule published.");
      schedulesQuery.refresh();
    } catch (error) {
      setSubmitMessage(error instanceof Error ? error.message : "Unable to publish schedule.");
    } finally {
      setIsPublishingScheduleId(null);
    }
  }

  if (schedulesQuery.isLoading || shiftsQuery.isLoading || templatesQuery.isLoading) {
    return manageSkeleton();
  }

  if (schedulesQuery.errorMessage || shiftsQuery.errorMessage) {
    return (
      <section className="error-state">
        <EmptyState
          title="Scheduling management is unavailable"
          description={schedulesQuery.errorMessage ?? shiftsQuery.errorMessage ?? "Unable to load scheduling management data."}
          ctaLabel="Back to dashboard"
          ctaHref="/dashboard"
        />
      </section>
    );
  }

  return (
    <>
      {!embedded ? (
        <PageHeader
          title="Scheduling"
          description="Build and publish team schedules with templates, assignments, and swap oversight."
        />
      ) : null}

      <section className="compensation-layout" aria-label="Scheduling management">
        <article className="settings-card">
          <header className="announcement-item-header">
            <div>
              <h2 className="section-title">Create schedule</h2>
              <p className="settings-card-description">Set week boundaries before assigning shifts.</p>
            </div>
          </header>
          <form className="settings-form-grid" onSubmit={handleCreateSchedule}>
            <label className="settings-field">
              <span className="settings-field-label">Schedule name</span>
              <input
                className="settings-input"
                value={scheduleForm.name}
                onChange={(event) =>
                  setScheduleForm((currentValue) => ({ ...currentValue, name: event.target.value }))
                }
                placeholder="Engineering Week 10"
              />
            </label>
            <label className="settings-field">
              <span className="settings-field-label">Department</span>
              <input
                className="settings-input"
                value={scheduleForm.department}
                onChange={(event) =>
                  setScheduleForm((currentValue) => ({ ...currentValue, department: event.target.value }))
                }
                placeholder="Engineering"
              />
            </label>
            <label className="settings-field">
              <span className="settings-field-label">Week start</span>
              <input
                type="date"
                className="settings-input"
                value={scheduleForm.weekStart}
                onChange={(event) =>
                  setScheduleForm((currentValue) => ({ ...currentValue, weekStart: event.target.value }))
                }
              />
            </label>
            <label className="settings-field">
              <span className="settings-field-label">Week end (optional)</span>
              <input
                type="date"
                className="settings-input"
                value={scheduleForm.weekEnd}
                onChange={(event) =>
                  setScheduleForm((currentValue) => ({ ...currentValue, weekEnd: event.target.value }))
                }
              />
            </label>
            {scheduleFormError ? <p className="form-field-error">{scheduleFormError}</p> : null}
            <div className="settings-actions">
              <button type="submit" className="button button-accent" disabled={isSubmittingSchedule}>
                {isSubmittingSchedule ? "Creating..." : "Create schedule"}
              </button>
            </div>
          </form>
        </article>

        <article className="settings-card">
          <header className="announcement-item-header">
            <div>
              <h2 className="section-title">Create shift</h2>
              <p className="settings-card-description">Assign a team member or leave employee blank for open shifts.</p>
            </div>
          </header>
          <form className="settings-form-grid" onSubmit={handleCreateShift}>
            <label className="settings-field">
              <span className="settings-field-label">Schedule</span>
              <select
                className="settings-input"
                value={shiftForm.scheduleId}
                onChange={(event) =>
                  setShiftForm((currentValue) => ({ ...currentValue, scheduleId: event.target.value }))
                }
              >
                <option value="">Select schedule</option>
                {sortedSchedules.map((schedule) => (
                  <option key={schedule.id} value={schedule.id}>
                    {schedule.name ?? `${schedule.weekStart} to ${schedule.weekEnd}`}
                  </option>
                ))}
              </select>
            </label>
            <label className="settings-field">
              <span className="settings-field-label">Template</span>
              <select
                className="settings-input"
                value={shiftForm.templateId}
                onChange={(event) =>
                  setShiftForm((currentValue) => ({ ...currentValue, templateId: event.target.value }))
                }
              >
                <option value="">No template</option>
                {(templatesQuery.data?.templates ?? []).map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name} ({template.startTime}-{template.endTime})
                  </option>
                ))}
              </select>
            </label>
            <label className="settings-field">
              <span className="settings-field-label">Employee</span>
              <select
                className="settings-input"
                value={shiftForm.employeeId}
                onChange={(event) =>
                  setShiftForm((currentValue) => ({ ...currentValue, employeeId: event.target.value }))
                }
              >
                <option value="">Open shift</option>
                {people.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.fullName}
                  </option>
                ))}
              </select>
            </label>
            <label className="settings-field">
              <span className="settings-field-label">Shift date</span>
              <input
                type="date"
                className="settings-input"
                value={shiftForm.shiftDate}
                onChange={(event) =>
                  setShiftForm((currentValue) => ({ ...currentValue, shiftDate: event.target.value }))
                }
              />
            </label>
            <label className="settings-field">
              <span className="settings-field-label">Start</span>
              <input
                type="time"
                className="settings-input"
                value={shiftForm.startTime}
                onChange={(event) =>
                  setShiftForm((currentValue) => ({ ...currentValue, startTime: event.target.value }))
                }
              />
            </label>
            <label className="settings-field">
              <span className="settings-field-label">End</span>
              <input
                type="time"
                className="settings-input"
                value={shiftForm.endTime}
                onChange={(event) =>
                  setShiftForm((currentValue) => ({ ...currentValue, endTime: event.target.value }))
                }
              />
            </label>
            <label className="settings-field">
              <span className="settings-field-label">Break minutes</span>
              <input
                type="number"
                min={0}
                max={240}
                className="settings-input numeric"
                value={shiftForm.breakMinutes}
                onChange={(event) =>
                  setShiftForm((currentValue) => ({ ...currentValue, breakMinutes: event.target.value }))
                }
              />
            </label>
            <label className="settings-field">
              <span className="settings-field-label">Notes (optional)</span>
              <input
                className="settings-input"
                value={shiftForm.notes}
                onChange={(event) =>
                  setShiftForm((currentValue) => ({ ...currentValue, notes: event.target.value }))
                }
                placeholder="Coverage for product launch"
              />
            </label>
            {shiftFormError ? <p className="form-field-error">{shiftFormError}</p> : null}
            <div className="settings-actions">
              <button type="submit" className="button button-accent" disabled={isSubmittingShift}>
                {isSubmittingShift ? "Creating..." : "Create shift"}
              </button>
            </div>
          </form>
          {isLoadingPeople ? (
            <p className="settings-card-description">Loading team list...</p>
          ) : peopleError ? (
            <p className="form-field-error">{peopleError}</p>
          ) : null}
          {submitMessage ? <p className="settings-card-description">{submitMessage}</p> : null}
        </article>

        <article className="compensation-section">
          <header className="announcements-section-header">
            <div>
              <h2 className="section-title">Schedules</h2>
              <p className="settings-card-description">Draft schedules can be published once shifts are assigned.</p>
            </div>
          </header>

          {sortedSchedules.length === 0 ? (
            <EmptyState
              title="No schedules yet"
              description="Create a schedule to begin assigning shifts."
              ctaLabel="Create schedule"
              ctaHref="/scheduling/manage"
            />
          ) : (
            <div className="data-table-container">
              <table className="data-table" aria-label="Schedules">
                <thead>
                  <tr>
                    <th>
                      <button
                        type="button"
                        className="table-sort-trigger"
                        onClick={() =>
                          setScheduleSortDirection((currentDirection) =>
                            currentDirection === "asc" ? "desc" : "asc"
                          )
                        }
                      >
                        Week
                        <span className="numeric">{scheduleSortDirection === "asc" ? "↑" : "↓"}</span>
                      </button>
                    </th>
                    <th>Name</th>
                    <th>Department</th>
                    <th>Shifts</th>
                    <th>Status</th>
                    <th>Published</th>
                    <th className="table-action-column">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedSchedules.map((schedule) => (
                    <tr key={schedule.id} className="data-table-row">
                      <td className="numeric">
                        {schedule.weekStart} to {schedule.weekEnd}
                      </td>
                      <td>{schedule.name ?? "Untitled schedule"}</td>
                      <td>{schedule.department ?? "--"}</td>
                      <td className="numeric">{schedule.shiftCount}</td>
                      <td>
                        <StatusBadge tone={toneForScheduleStatus(schedule.status)}>
                          {formatScheduleStatus(schedule.status)}
                        </StatusBadge>
                      </td>
                      <td>
                        {schedule.publishedAt ? (
                          <span title={formatDateTimeTooltip(schedule.publishedAt)}>
                            {formatRelativeTime(schedule.publishedAt)}
                          </span>
                        ) : (
                          "--"
                        )}
                      </td>
                      <td className="table-row-action-cell">
                        <div className="timeatt-row-actions">
                          {schedule.status === "draft" ? (
                            <button
                              type="button"
                              className="table-row-action"
                              onClick={() => handlePublishSchedule(schedule.id)}
                              disabled={isPublishingScheduleId === schedule.id}
                            >
                              {isPublishingScheduleId === schedule.id ? "Publishing..." : "Publish"}
                            </button>
                          ) : (
                            <span className="table-row-action">Published</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </article>

        <article className="compensation-section">
          <header className="announcements-section-header">
            <div>
              <h2 className="section-title">Shift assignments</h2>
              <p className="settings-card-description">Team-level shifts across schedules.</p>
            </div>
          </header>

          {sortedShifts.length === 0 ? (
            <EmptyState
              title="No shifts yet"
              description="Create shifts to populate the schedule."
              ctaLabel="Create shift"
              ctaHref="/scheduling/manage"
            />
          ) : (
            <div className="data-table-container">
              <table className="data-table" aria-label="Shifts">
                <thead>
                  <tr>
                    <th>
                      <button
                        type="button"
                        className="table-sort-trigger"
                        onClick={() =>
                          setShiftSortDirection((currentDirection) =>
                            currentDirection === "asc" ? "desc" : "asc"
                          )
                        }
                      >
                        Shift
                        <span className="numeric">{shiftSortDirection === "asc" ? "↑" : "↓"}</span>
                      </button>
                    </th>
                    <th>Employee</th>
                    <th>Country</th>
                    <th>Schedule</th>
                    <th>Status</th>
                    <th className="table-action-column">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedShifts.map((shift) => (
                    <tr key={shift.id} className="data-table-row">
                      <td className="numeric">
                        {shift.shiftDate} {formatTimeRangeLabel(shift.startTime, shift.endTime)}
                      </td>
                      <td>{shift.employeeName ?? "Open shift"}</td>
                      <td>
                        {shift.employeeCountryCode ? (
                          <span className="country-chip">
                            <span>{countryFlagFromCode(shift.employeeCountryCode)}</span>
                            <span>{countryNameFromCode(shift.employeeCountryCode)}</span>
                          </span>
                        ) : (
                          "--"
                        )}
                      </td>
                      <td>{shift.scheduleName ?? "Schedule"}</td>
                      <td>
                        <StatusBadge tone={toneForShiftStatus(shift.status)}>
                          {formatShiftStatus(shift.status)}
                        </StatusBadge>
                      </td>
                      <td className="table-row-action-cell">
                        <div className="timeatt-row-actions">
                          <Link href="/scheduling?tab=swaps" className="table-row-action">
                            View swaps
                          </Link>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </article>
      </section>
    </>
  );
}
