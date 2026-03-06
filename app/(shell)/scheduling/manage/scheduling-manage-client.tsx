"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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

type ToastVariant = "success" | "error" | "info";

type ToastMessage = {
  id: string;
  message: string;
  variant: ToastVariant;
};

type AutoGenerateAssignment = {
  employeeId: string;
  employeeName: string;
  shiftDate: string;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  templateId?: string;
};

type DayNote = {
  noteDate: string;
  content: string;
};

function createToastId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `toast-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

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

  // Toast state
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  // Auto-generate state
  const [autoGenScheduleId, setAutoGenScheduleId] = useState<string | null>(null);
  const [isAutoGenerating, setIsAutoGenerating] = useState(false);
  const [autoGenPreview, setAutoGenPreview] = useState<AutoGenerateAssignment[] | null>(null);
  const [isApplyingAutoGen, setIsApplyingAutoGen] = useState(false);

  // Day notes state
  const [dayNotes, setDayNotes] = useState<Record<string, DayNote[]>>({});
  const [dayNotesLoading, setDayNotesLoading] = useState<Record<string, boolean>>({});
  const [savingNoteKey, setSavingNoteKey] = useState<string | null>(null);

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

  const addToast = useCallback((variant: ToastVariant, message: string) => {
    const id = createToastId();
    setToasts((currentToasts) => [...currentToasts, { id, variant, message }]);
    window.setTimeout(() => {
      setToasts((currentToasts) => currentToasts.filter((toast) => toast.id !== id));
    }, 4000);
  }, []);

  // --- Auto-generate handlers ---

  async function handleAutoGenerate(scheduleId: string) {
    setAutoGenScheduleId(scheduleId);
    setIsAutoGenerating(true);
    setAutoGenPreview(null);

    try {
      const response = await fetch(`/api/v1/scheduling/schedules/${scheduleId}/auto-generate`, {
        method: "POST"
      });
      const payload = (await response.json()) as {
        data: { assignments: AutoGenerateAssignment[] } | null;
        error: { message?: string } | null;
      };

      if (!response.ok || !payload.data) {
        addToast("error", payload.error?.message ?? "Unable to auto-generate assignments.");
        setAutoGenScheduleId(null);
        return;
      }

      setAutoGenPreview(payload.data.assignments);
      addToast("info", `Generated ${payload.data.assignments.length} assignment(s). Review and apply.`);
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : "Auto-generate failed.");
      setAutoGenScheduleId(null);
    } finally {
      setIsAutoGenerating(false);
    }
  }

  async function handleApplyAutoGen() {
    if (!autoGenScheduleId || !autoGenPreview) {
      return;
    }

    setIsApplyingAutoGen(true);

    try {
      const response = await fetch(
        `/api/v1/scheduling/schedules/${autoGenScheduleId}/auto-generate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirm: true, assignments: autoGenPreview })
        }
      );
      const payload = (await response.json()) as {
        data: unknown;
        error: { message?: string } | null;
      };

      if (!response.ok) {
        addToast("error", payload.error?.message ?? "Unable to apply assignments.");
        return;
      }

      addToast("success", "Auto-generated assignments applied.");
      setAutoGenPreview(null);
      setAutoGenScheduleId(null);
      shiftsQuery.refresh();
      schedulesQuery.refresh();
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : "Apply failed.");
    } finally {
      setIsApplyingAutoGen(false);
    }
  }

  function handleDiscardAutoGen() {
    setAutoGenPreview(null);
    setAutoGenScheduleId(null);
    addToast("info", "Auto-generated assignments discarded.");
  }

  // --- Day notes handlers ---

  const loadDayNotes = useCallback(async (scheduleId: string) => {
    setDayNotesLoading((current) => ({ ...current, [scheduleId]: true }));

    try {
      const response = await fetch(`/api/v1/scheduling/schedules/${scheduleId}/notes`);
      const payload = (await response.json()) as {
        data: { notes: DayNote[] } | null;
        error: { message?: string } | null;
      };

      if (response.ok && payload.data) {
        setDayNotes((current) => ({ ...current, [scheduleId]: payload.data!.notes }));
      }
    } catch {
      // Silently fail — notes are non-critical
    } finally {
      setDayNotesLoading((current) => ({ ...current, [scheduleId]: false }));
    }
  }, []);

  async function handleSaveDayNote(scheduleId: string, noteDate: string, content: string) {
    const noteKey = `${scheduleId}:${noteDate}`;
    setSavingNoteKey(noteKey);

    try {
      const response = await fetch(`/api/v1/scheduling/schedules/${scheduleId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ noteDate, content })
      });
      const payload = (await response.json()) as {
        data: unknown;
        error: { message?: string } | null;
      };

      if (!response.ok) {
        addToast("error", payload.error?.message ?? "Unable to save note.");
        return;
      }

      // Update local state
      setDayNotes((current) => {
        const existing = current[scheduleId] ?? [];
        const noteIndex = existing.findIndex((note) => note.noteDate === noteDate);

        if (noteIndex >= 0) {
          const updated = [...existing];
          updated[noteIndex] = { noteDate, content };
          return { ...current, [scheduleId]: updated };
        }

        return { ...current, [scheduleId]: [...existing, { noteDate, content }] };
      });
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : "Unable to save note.");
    } finally {
      setSavingNoteKey(null);
    }
  }

  // Load day notes when schedules are available
  useEffect(() => {
    const schedules = schedulesQuery.data?.schedules ?? [];

    for (const schedule of schedules) {
      if (!dayNotes[schedule.id] && !dayNotesLoading[schedule.id]) {
        void loadDayNotes(schedule.id);
      }
    }
  }, [schedulesQuery.data?.schedules, dayNotes, dayNotesLoading, loadDayNotes]);

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
      <>
        <EmptyState
          title="Scheduling management is unavailable"
          description={schedulesQuery.errorMessage ?? shiftsQuery.errorMessage ?? "Unable to load scheduling management data."}
        />
      </>
    );
  }

  return (
    <>
      {!embedded ? (
        <PageHeader
          title="Scheduling"
          description="Build, publish, and manage team shift schedules."
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
                            <>
                              <button
                                type="button"
                                className="table-row-action"
                                onClick={() => handlePublishSchedule(schedule.id)}
                                disabled={isPublishingScheduleId === schedule.id}
                              >
                                {isPublishingScheduleId === schedule.id ? "Publishing..." : "Publish"}
                              </button>
                              <button
                                type="button"
                                className="button button-accent"
                                style={{ fontSize: "var(--font-size-sm)", padding: "var(--space-1) var(--space-3)" }}
                                onClick={() => handleAutoGenerate(schedule.id)}
                                disabled={isAutoGenerating && autoGenScheduleId === schedule.id}
                              >
                                {isAutoGenerating && autoGenScheduleId === schedule.id
                                  ? "Generating..."
                                  : "Auto-Generate"}
                              </button>
                            </>
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

        {autoGenPreview !== null && autoGenScheduleId ? (
          <article className="settings-card" aria-label="Auto-generate preview">
            <header className="announcement-item-header">
              <div>
                <h2 className="section-title">Auto-generated assignments preview</h2>
                <p className="settings-card-description">
                  {autoGenPreview.length} assignment{autoGenPreview.length === 1 ? "" : "s"} generated.
                  Review and apply or discard.
                </p>
              </div>
              <div style={{ display: "flex", gap: "var(--space-2)" }}>
                <button
                  type="button"
                  className="button button-accent"
                  onClick={handleApplyAutoGen}
                  disabled={isApplyingAutoGen}
                >
                  {isApplyingAutoGen ? "Applying..." : "Apply"}
                </button>
                <button
                  type="button"
                  className="button button-ghost"
                  onClick={handleDiscardAutoGen}
                  disabled={isApplyingAutoGen}
                >
                  Discard
                </button>
              </div>
            </header>

            {autoGenPreview.length === 0 ? (
              <p className="settings-card-description" style={{ padding: "var(--space-4)" }}>
                No assignments could be generated for this schedule.
              </p>
            ) : (
              <div className="data-table-container">
                <table className="data-table" aria-label="Auto-generated assignments">
                  <thead>
                    <tr>
                      <th>Employee</th>
                      <th>Date</th>
                      <th>Start</th>
                      <th>End</th>
                      <th>Break (min)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {autoGenPreview.map((assignment, index) => (
                      <tr
                        key={`autogen-${assignment.employeeId}-${assignment.shiftDate}-${index}`}
                        className="data-table-row"
                      >
                        <td>{assignment.employeeName}</td>
                        <td className="numeric">{assignment.shiftDate}</td>
                        <td className="numeric">{assignment.startTime}</td>
                        <td className="numeric">{assignment.endTime}</td>
                        <td className="numeric">{assignment.breakMinutes}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </article>
        ) : null}

        {sortedSchedules.length > 0 ? (
          <article className="settings-card" aria-label="Day notes">
            <header className="announcement-item-header">
              <div>
                <h2 className="section-title">Day notes</h2>
                <p className="settings-card-description">
                  Add notes to specific dates in a schedule. Notes save automatically on blur.
                </p>
              </div>
            </header>

            <div style={{ padding: "var(--space-4)", display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
              {sortedSchedules.map((schedule) => {
                const start = new Date(`${schedule.weekStart}T00:00:00`);
                const end = new Date(`${schedule.weekEnd}T00:00:00`);
                const dates: string[] = [];

                for (
                  let d = new Date(start);
                  d <= end;
                  d.setDate(d.getDate() + 1)
                ) {
                  dates.push(d.toISOString().split("T")[0]);
                }

                const notes = dayNotes[schedule.id] ?? [];

                return (
                  <div key={`daynotes-${schedule.id}`}>
                    <h3
                      className="section-title"
                      style={{ fontSize: "var(--font-size-sm)", marginBottom: "var(--space-2)" }}
                    >
                      {schedule.name ?? `${schedule.weekStart} to ${schedule.weekEnd}`}
                    </h3>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "auto 1fr",
                        gap: "var(--space-2)",
                        alignItems: "center"
                      }}
                    >
                      {dates.map((dateStr) => {
                        const existingNote = notes.find((note) => note.noteDate === dateStr);
                        const noteKey = `${schedule.id}:${dateStr}`;
                        const isSaving = savingNoteKey === noteKey;

                        return (
                          <div
                            key={`note-row-${schedule.id}-${dateStr}`}
                            style={{ display: "contents" }}
                          >
                            <span
                              className="numeric"
                              style={{
                                fontSize: "var(--font-size-sm)",
                                color: "var(--color-text-secondary)",
                                whiteSpace: "nowrap"
                              }}
                            >
                              {dateStr}
                            </span>
                            <input
                              className="settings-input"
                              style={{
                                fontSize: "var(--font-size-sm)",
                                opacity: isSaving ? 0.6 : 1
                              }}
                              defaultValue={existingNote?.content ?? ""}
                              placeholder="Add a note for this day..."
                              disabled={isSaving}
                              onBlur={(event) => {
                                const value = event.target.value.trim();
                                const previous = existingNote?.content ?? "";

                                if (value !== previous) {
                                  void handleSaveDayNote(schedule.id, dateStr, value);
                                }
                              }}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </article>
        ) : null}

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

      {toasts.length > 0 ? (
        <section className="toast-region" aria-live="polite">
          {toasts.map((toast) => (
            <article
              key={toast.id}
              className={`toast-message ${
                toast.variant === "success"
                  ? "toast-message-success"
                  : toast.variant === "error"
                    ? "toast-message-error"
                    : "toast-message-info"
              }`}
            >
              <p>{toast.message}</p>
              <button
                type="button"
                className="toast-dismiss"
                aria-label="Dismiss notification"
                onClick={() =>
                  setToasts((currentToasts) =>
                    currentToasts.filter((entry) => entry.id !== toast.id)
                  )
                }
              >
                &times;
              </button>
            </article>
          ))}
        </section>
      ) : null}
    </>
  );
}
