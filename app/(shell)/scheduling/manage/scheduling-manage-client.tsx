"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { ConfirmDialog } from "../../../../components/shared/confirm-dialog";
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
import { DEPARTMENTS } from "../../../../lib/departments";
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
  slotName: string;
  startTime: string;
  endTime: string;
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
  department: "Customer Success",
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
  const [autoGenScheduleType, setAutoGenScheduleType] = useState<"weekday" | "weekend">("weekday");
  const [isAutoGenerating, setIsAutoGenerating] = useState(false);
  const [autoGenPreview, setAutoGenPreview] = useState<AutoGenerateAssignment[] | null>(null);
  const [isApplyingAutoGen, setIsApplyingAutoGen] = useState(false);

  // Crew selection for auto-generate
  const [autoGenCrewSelection, setAutoGenCrewSelection] = useState<Set<string> | null>(null);
  const [autoGenTargetScheduleId, setAutoGenTargetScheduleId] = useState<string | null>(null);

  // Confirmation dialog state
  const [publishConfirmScheduleId, setPublishConfirmScheduleId] = useState<string | null>(null);
  const [deleteConfirmScheduleId, setDeleteConfirmScheduleId] = useState<string | null>(null);
  const [cancelConfirmShiftId, setCancelConfirmShiftId] = useState<string | null>(null);
  const [isCancellingShift, setIsCancellingShift] = useState(false);
  const [isDeletingSchedule, setIsDeletingSchedule] = useState(false);

  // Shift editing state
  const [editingShiftId, setEditingShiftId] = useState<string | null>(null);

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
          setPeopleError(payload.error?.message ?? "Unable to load crew members.");
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
        setPeopleError(error instanceof Error ? error.message : "Unable to load crew members.");
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

  function openCrewSelection(scheduleId: string) {
    const schedule = sortedSchedules.find((s) => s.id === scheduleId);
    const scheduleDepartment = schedule?.department ?? null;

    const initialSelection = new Set<string>(
      people
        .filter((person) =>
          scheduleDepartment
            ? person.department?.toLowerCase() === scheduleDepartment.toLowerCase()
            : true
        )
        .map((person) => person.id)
    );

    setAutoGenTargetScheduleId(scheduleId);
    setAutoGenCrewSelection(initialSelection);
  }

  function closeCrewSelection() {
    setAutoGenCrewSelection(null);
    setAutoGenTargetScheduleId(null);
  }

  function toggleCrewMember(personId: string) {
    setAutoGenCrewSelection((current) => {
      if (!current) return current;
      const next = new Set(current);
      if (next.has(personId)) {
        next.delete(personId);
      } else {
        next.add(personId);
      }
      return next;
    });
  }

  function toggleDepartment(department: string) {
    setAutoGenCrewSelection((current) => {
      if (!current) return current;
      const deptPeople = people.filter(
        (person) => person.department?.toLowerCase() === department.toLowerCase()
      );
      const allSelected = deptPeople.every((person) => current.has(person.id));
      const next = new Set(current);

      for (const person of deptPeople) {
        if (allSelected) {
          next.delete(person.id);
        } else {
          next.add(person.id);
        }
      }

      return next;
    });
  }

  function selectAllCrew() {
    setAutoGenCrewSelection(new Set(people.map((person) => person.id)));
  }

  function deselectAllCrew() {
    setAutoGenCrewSelection(new Set());
  }

  async function handleAutoGenerate(scheduleId: string) {
    const templates = templatesQuery.data?.templates ?? [];

    if (templates.length === 0) {
      addToast("error", "Create at least one shift template before auto-generating.");
      return;
    }

    const selectedCrewIds = autoGenCrewSelection ? Array.from(autoGenCrewSelection) : undefined;

    // Close crew selection panel
    setAutoGenCrewSelection(null);
    setAutoGenTargetScheduleId(null);

    setAutoGenScheduleId(scheduleId);
    setIsAutoGenerating(true);
    setAutoGenPreview(null);

    try {
      const slots = templates.map((t) => ({
        name: t.name,
        startTime: t.startTime,
        endTime: t.endTime
      }));

      const response = await fetch(`/api/v1/scheduling/schedules/${scheduleId}/auto-generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slots,
          scheduleType: autoGenScheduleType,
          ...(selectedCrewIds && selectedCrewIds.length > 0 ? { employeeIds: selectedCrewIds } : {})
        })
      });
      const payload = (await response.json()) as {
        data: { assignments: AutoGenerateAssignment[]; warnings?: string[] } | null;
        error: { message?: string } | null;
      };

      if (!response.ok || !payload.data) {
        addToast("error", payload.error?.message ?? "Unable to auto-generate assignments.");
        setAutoGenScheduleId(null);
        return;
      }

      setAutoGenPreview(payload.data.assignments);

      const warningCount = payload.data.warnings?.length ?? 0;
      const warningNote = warningCount > 0 ? ` (${warningCount} slot(s) unfilled)` : "";
      addToast("info", `Generated ${payload.data.assignments.length} assignment(s).${warningNote} Review and apply.`);
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
      setAutoGenScheduleType("weekday");
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
    setAutoGenScheduleType("weekday");
    addToast("info", "Auto-generated assignments discarded.");
  }

  // --- Shift cancel handler ---

  async function handleCancelShift(shiftId: string) {
    setIsCancellingShift(true);

    try {
      const response = await fetch(`/api/v1/scheduling/shifts/${shiftId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "cancelled" })
      });
      const payload = (await response.json()) as {
        data: unknown;
        error: { message?: string } | null;
      };

      if (!response.ok) {
        addToast("error", payload.error?.message ?? "Unable to cancel shift.");
        return;
      }

      addToast("success", "Shift cancelled.");
      shiftsQuery.refresh();
      schedulesQuery.refresh();
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : "Unable to cancel shift.");
    } finally {
      setIsCancellingShift(false);
      setCancelConfirmShiftId(null);
    }
  }

  // --- Schedule delete handler ---

  async function handleDeleteSchedule(scheduleId: string) {
    setIsDeletingSchedule(true);

    try {
      const response = await fetch(`/api/v1/scheduling/schedules/${scheduleId}`, {
        method: "DELETE"
      });
      const payload = (await response.json()) as {
        data: unknown;
        error: { message?: string } | null;
      };

      if (!response.ok) {
        addToast("error", payload.error?.message ?? "Unable to delete schedule.");
        return;
      }

      addToast("success", "Draft schedule deleted.");
      schedulesQuery.refresh();
      shiftsQuery.refresh();
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : "Unable to delete schedule.");
    } finally {
      setIsDeletingSchedule(false);
      setDeleteConfirmScheduleId(null);
    }
  }

  // --- Shift edit helpers ---

  function startEditingShift(shift: {
    id: string;
    scheduleId: string;
    templateId: string | null;
    employeeId: string | null;
    shiftDate: string;
    startTime: string;
    endTime: string;
    breakMinutes: number;
    notes: string | null;
  }) {
    setEditingShiftId(shift.id);
    setShiftForm({
      scheduleId: shift.scheduleId,
      templateId: shift.templateId ?? "",
      employeeId: shift.employeeId ?? "",
      shiftDate: shift.shiftDate,
      startTime: shift.startTime.slice(0, 5),
      endTime: shift.endTime.slice(0, 5),
      breakMinutes: String(shift.breakMinutes),
      notes: shift.notes ?? ""
    });
    setShiftFormError(null);
  }

  function cancelEditingShift() {
    setEditingShiftId(null);
    setShiftForm(defaultShiftForm);
    setShiftFormError(null);
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

  async function handleSubmitShift(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setShiftFormError(null);
    setSubmitMessage(null);

    if (!shiftForm.scheduleId || !shiftForm.shiftDate || !shiftForm.startTime || !shiftForm.endTime) {
      setShiftFormError("Schedule, date, start time, and end time are required.");
      return;
    }

    setIsSubmittingShift(true);

    const shiftPayload = {
      scheduleId: shiftForm.scheduleId,
      templateId: shiftForm.templateId || undefined,
      employeeId: shiftForm.employeeId || undefined,
      shiftDate: shiftForm.shiftDate,
      startTime: shiftForm.startTime,
      endTime: shiftForm.endTime,
      breakMinutes: Number.parseInt(shiftForm.breakMinutes || "0", 10),
      notes: shiftForm.notes || undefined
    };

    try {
      const url = editingShiftId
        ? `/api/v1/scheduling/shifts/${editingShiftId}`
        : "/api/v1/scheduling/shifts";
      const method = editingShiftId ? "PUT" : "POST";

      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(shiftPayload)
      });
      const payload = (await response.json()) as {
        data: unknown;
        error: { message?: string } | null;
      };

      if (!response.ok) {
        setShiftFormError(
          payload.error?.message ?? (editingShiftId ? "Unable to update shift." : "Unable to create shift.")
        );
        return;
      }

      setShiftForm(defaultShiftForm);
      setEditingShiftId(null);
      setSubmitMessage(editingShiftId ? "Shift updated." : "Shift created.");
      shiftsQuery.refresh();
      schedulesQuery.refresh();
    } catch (error) {
      setShiftFormError(
        error instanceof Error ? error.message : (editingShiftId ? "Unable to update shift." : "Unable to create shift.")
      );
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
        addToast("error", payload.error?.message ?? "Unable to publish schedule.");
        return;
      }

      addToast("success", "Schedule published.");
      schedulesQuery.refresh();
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : "Unable to publish schedule.");
    } finally {
      setIsPublishingScheduleId(null);
      setPublishConfirmScheduleId(null);
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
          <form className="settings-form" onSubmit={handleCreateSchedule}>
            <div>
              <label className="form-label" htmlFor="schedule-name">Schedule name</label>
              <input
                id="schedule-name"
                className="form-input"
                value={scheduleForm.name}
                onChange={(event) =>
                  setScheduleForm((currentValue) => ({ ...currentValue, name: event.target.value }))
                }
                placeholder="Engineering Week 10"
              />
            </div>
            <div>
              <label className="form-label" htmlFor="schedule-department">Department</label>
              <select
                id="schedule-department"
                className="form-input"
                value={scheduleForm.department}
                onChange={(event) =>
                  setScheduleForm((currentValue) => ({ ...currentValue, department: event.target.value }))
                }
              >
                <option value="">All departments</option>
                {DEPARTMENTS.map((dept) => (
                  <option key={dept} value={dept}>{dept}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="form-label" htmlFor="schedule-week-start">Week start</label>
              <input
                id="schedule-week-start"
                type="date"
                className="form-input"
                value={scheduleForm.weekStart}
                onChange={(event) =>
                  setScheduleForm((currentValue) => ({ ...currentValue, weekStart: event.target.value }))
                }
              />
            </div>
            <div>
              <label className="form-label" htmlFor="schedule-week-end">Week end (optional)</label>
              <input
                id="schedule-week-end"
                type="date"
                className="form-input"
                value={scheduleForm.weekEnd}
                onChange={(event) =>
                  setScheduleForm((currentValue) => ({ ...currentValue, weekEnd: event.target.value }))
                }
              />
            </div>
            {scheduleFormError ? <p className="form-field-error">{scheduleFormError}</p> : null}
            <div className="settings-actions">
              <button type="submit" className="button button-primary" disabled={isSubmittingSchedule}>
                {isSubmittingSchedule ? "Creating..." : "Create schedule"}
              </button>
            </div>
          </form>
        </article>

        <article className="settings-card">
          <header className="announcement-item-header">
            <div>
              <h2 className="section-title">{editingShiftId ? "Edit shift" : "Create shift"}</h2>
              <p className="settings-card-description">
                {editingShiftId
                  ? "Update shift details. Cancel to discard changes."
                  : "Assign a crew member or leave blank for open shifts."}
              </p>
            </div>
            {editingShiftId ? (
              <button type="button" className="button button-ghost" onClick={cancelEditingShift}>
                Cancel edit
              </button>
            ) : null}
          </header>
          <form className="settings-form" onSubmit={handleSubmitShift}>
            <div>
              <label className="form-label" htmlFor="shift-schedule">Schedule</label>
              <select
                id="shift-schedule"
                className="form-input"
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
            </div>
            <div>
              <label className="form-label" htmlFor="shift-template">Template</label>
              <select
                id="shift-template"
                className="form-input"
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
            </div>
            <div>
              <label className="form-label" htmlFor="shift-employee">Crew member</label>
              <select
                id="shift-employee"
                className="form-input"
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
            </div>
            <div>
              <label className="form-label" htmlFor="shift-date">Shift date</label>
              <input
                id="shift-date"
                type="date"
                className="form-input"
                value={shiftForm.shiftDate}
                onChange={(event) =>
                  setShiftForm((currentValue) => ({ ...currentValue, shiftDate: event.target.value }))
                }
              />
            </div>
            <div>
              <label className="form-label" htmlFor="shift-start">Start</label>
              <input
                id="shift-start"
                type="time"
                className="form-input"
                value={shiftForm.startTime}
                onChange={(event) =>
                  setShiftForm((currentValue) => ({ ...currentValue, startTime: event.target.value }))
                }
              />
            </div>
            <div>
              <label className="form-label" htmlFor="shift-end">End</label>
              <input
                id="shift-end"
                type="time"
                className="form-input"
                value={shiftForm.endTime}
                onChange={(event) =>
                  setShiftForm((currentValue) => ({ ...currentValue, endTime: event.target.value }))
                }
              />
            </div>
            <div>
              <label className="form-label" htmlFor="shift-break">Break minutes</label>
              <input
                id="shift-break"
                type="number"
                min={0}
                max={240}
                className="form-input numeric"
                value={shiftForm.breakMinutes}
                onChange={(event) =>
                  setShiftForm((currentValue) => ({ ...currentValue, breakMinutes: event.target.value }))
                }
              />
            </div>
            <div>
              <label className="form-label" htmlFor="shift-notes">Notes (optional)</label>
              <input
                id="shift-notes"
                className="form-input"
                value={shiftForm.notes}
                onChange={(event) =>
                  setShiftForm((currentValue) => ({ ...currentValue, notes: event.target.value }))
                }
                placeholder="Coverage for product launch"
              />
            </div>
            {shiftFormError ? <p className="form-field-error">{shiftFormError}</p> : null}
            <div className="settings-actions">
              <button type="submit" className="button button-primary" disabled={isSubmittingShift}>
                {isSubmittingShift
                  ? (editingShiftId ? "Saving..." : "Creating...")
                  : (editingShiftId ? "Save changes" : "Create shift")}
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
                                onClick={() => setPublishConfirmScheduleId(schedule.id)}
                                disabled={isPublishingScheduleId === schedule.id}
                              >
                                {isPublishingScheduleId === schedule.id ? "Publishing..." : "Publish"}
                              </button>
                              <select
                                className="table-row-action-select"
                                value={autoGenScheduleType}
                                onChange={(event) =>
                                  setAutoGenScheduleType(event.target.value as "weekday" | "weekend")
                                }
                              >
                                <option value="weekday">Weekday</option>
                                <option value="weekend">Weekend</option>
                              </select>
                              <button
                                type="button"
                                className="table-row-action"
                                onClick={() => openCrewSelection(schedule.id)}
                                disabled={isAutoGenerating && autoGenScheduleId === schedule.id}
                              >
                                {isAutoGenerating && autoGenScheduleId === schedule.id
                                  ? "Generating..."
                                  : "Auto-generate"}
                              </button>
                              <button
                                type="button"
                                className="table-row-action table-row-action-danger"
                                onClick={() => setDeleteConfirmScheduleId(schedule.id)}
                              >
                                Delete
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

        {autoGenCrewSelection !== null && autoGenTargetScheduleId ? (
          <article className="settings-card autogen-crew-panel" aria-label="Select crew for auto-generate">
            <header className="announcement-item-header">
              <div>
                <h2 className="section-title">Select crew for auto-generate</h2>
                <p className="settings-card-description">
                  {autoGenCrewSelection.size} of {people.length} crew members selected
                </p>
              </div>
              <div className="autogen-crew-header-actions">
                <button
                  type="button"
                  className="button button-primary"
                  onClick={() => void handleAutoGenerate(autoGenTargetScheduleId)}
                  disabled={autoGenCrewSelection.size === 0}
                >
                  Generate
                </button>
                <button
                  type="button"
                  className="button button-ghost"
                  onClick={closeCrewSelection}
                >
                  Cancel
                </button>
              </div>
            </header>

            <div className="autogen-dept-chips">
              <button
                type="button"
                className={`autogen-dept-chip${autoGenCrewSelection.size === people.length ? " autogen-dept-chip-active" : ""}`}
                onClick={selectAllCrew}
              >
                All
              </button>
              <button
                type="button"
                className={`autogen-dept-chip${autoGenCrewSelection.size === 0 ? " autogen-dept-chip-active" : ""}`}
                onClick={deselectAllCrew}
              >
                None
              </button>
              {DEPARTMENTS.map((dept) => {
                const deptPeople = people.filter(
                  (person) => person.department?.toLowerCase() === dept.toLowerCase()
                );
                if (deptPeople.length === 0) return null;
                const allSelected = deptPeople.every((person) => autoGenCrewSelection.has(person.id));
                return (
                  <button
                    key={dept}
                    type="button"
                    className={`autogen-dept-chip${allSelected ? " autogen-dept-chip-active" : ""}`}
                    onClick={() => toggleDepartment(dept)}
                  >
                    {dept}
                  </button>
                );
              })}
            </div>

            <div className="autogen-crew-list">
              {(() => {
                const targetSchedule = sortedSchedules.find((s) => s.id === autoGenTargetScheduleId);
                const scheduleDept = targetSchedule?.department?.toLowerCase() ?? null;

                const sorted = [...people].sort((a, b) => {
                  const aInDept = scheduleDept && a.department?.toLowerCase() === scheduleDept ? 0 : 1;
                  const bInDept = scheduleDept && b.department?.toLowerCase() === scheduleDept ? 0 : 1;
                  if (aInDept !== bInDept) return aInDept - bInDept;
                  return a.fullName.localeCompare(b.fullName);
                });

                return sorted.map((person) => (
                  <label key={person.id} className="autogen-crew-row">
                    <input
                      type="checkbox"
                      checked={autoGenCrewSelection.has(person.id)}
                      onChange={() => toggleCrewMember(person.id)}
                    />
                    <span className="autogen-crew-name">{person.fullName}</span>
                    <span className="autogen-crew-dept">{person.department ?? "--"}</span>
                    {person.countryCode ? (
                      <span className="autogen-crew-flag">{countryFlagFromCode(person.countryCode)}</span>
                    ) : null}
                  </label>
                ));
              })()}
            </div>
          </article>
        ) : null}

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
                  className="button button-primary"
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
                      <th>Crew member</th>
                      <th>Date</th>
                      <th>Slot</th>
                      <th>Start</th>
                      <th>End</th>
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
                        <td>{assignment.slotName}</td>
                        <td className="numeric">{assignment.startTime}</td>
                        <td className="numeric">{assignment.endTime}</td>
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
                const start = new Date(`${schedule.weekStart}T00:00:00Z`);
                const end = new Date(`${schedule.weekEnd}T00:00:00Z`);
                const dates: string[] = [];

                for (
                  let d = new Date(start);
                  d <= end;
                  d.setUTCDate(d.getUTCDate() + 1)
                ) {
                  dates.push(d.toISOString().slice(0, 10));
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
                              className="form-input"
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
                          {shift.status === "scheduled" ? (
                            <>
                              <button
                                type="button"
                                className="table-row-action"
                                onClick={() =>
                                  startEditingShift({
                                    id: shift.id,
                                    scheduleId: shift.scheduleId,
                                    templateId: shift.templateId,
                                    employeeId: shift.employeeId,
                                    shiftDate: shift.shiftDate,
                                    startTime: shift.startTime,
                                    endTime: shift.endTime,
                                    breakMinutes: shift.breakMinutes,
                                    notes: shift.notes
                                  })
                                }
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                className="table-row-action"
                                style={{ color: "var(--color-danger)" }}
                                onClick={() => setCancelConfirmShiftId(shift.id)}
                              >
                                Cancel
                              </button>
                            </>
                          ) : shift.status === "swap_requested" ? (
                            <button
                              type="button"
                              className="table-row-action"
                              style={{ color: "var(--color-danger)" }}
                              onClick={() => setCancelConfirmShiftId(shift.id)}
                            >
                              Cancel
                            </button>
                          ) : (
                            <span style={{ fontSize: "var(--font-size-sm)", color: "var(--color-text-muted)" }}>--</span>
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
      </section>

      <ConfirmDialog
        isOpen={publishConfirmScheduleId !== null}
        title="Publish schedule?"
        description="This will notify all assigned crew members. Draft shifts become final."
        confirmLabel="Publish"
        tone="default"
        isConfirming={isPublishingScheduleId !== null}
        onConfirm={() => {
          if (publishConfirmScheduleId) {
            void handlePublishSchedule(publishConfirmScheduleId);
          }
        }}
        onCancel={() => setPublishConfirmScheduleId(null)}
      />

      <ConfirmDialog
        isOpen={deleteConfirmScheduleId !== null}
        title="Delete draft schedule?"
        description="All shifts in this schedule will also be deleted. This cannot be undone."
        confirmLabel="Delete"
        tone="danger"
        isConfirming={isDeletingSchedule}
        onConfirm={() => {
          if (deleteConfirmScheduleId) {
            void handleDeleteSchedule(deleteConfirmScheduleId);
          }
        }}
        onCancel={() => setDeleteConfirmScheduleId(null)}
      />

      <ConfirmDialog
        isOpen={cancelConfirmShiftId !== null}
        title="Cancel shift?"
        description="This will remove the crew member's assignment. The shift status will be set to cancelled."
        confirmLabel="Cancel shift"
        tone="danger"
        isConfirming={isCancellingShift}
        onConfirm={() => {
          if (cancelConfirmShiftId) {
            void handleCancelShift(cancelConfirmShiftId);
          }
        }}
        onCancel={() => setCancelConfirmShiftId(null)}
      />

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
