"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { ConfirmDialog } from "../../../../components/shared/confirm-dialog";
import { ScheduleCardGrid } from "../../../../components/scheduling/schedule-card-grid";
import { ScheduleWizard } from "../../../../components/scheduling/schedule-wizard";
import type { RosterEmployee } from "../../../../components/scheduling/roster-selector";
import { useSchedulingSchedules } from "../../../../hooks/use-scheduling";
import { usePeople } from "../../../../hooks/use-people";


type ToastMessage = {
  id: number;
  type: "success" | "error" | "info";
  text: string;
};

let toastCounter = 0;

export function SchedulingManageClient({ embedded = false }: { embedded?: boolean }) {
  const { data: schedulesData, isLoading, refresh: refreshSchedules } = useSchedulingSchedules({ scope: "team" });
  const { people } = usePeople();

  const [wizardOpen, setWizardOpen] = useState(false);
  const [publishingId, setPublishingId] = useState<string | null>(null);
  const [confirmPublish, setConfirmPublish] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  // Convert people data to roster employees
  const rosterEmployees: RosterEmployee[] = useMemo(() => {
    if (!people || people.length === 0) return [];
    return people
      .filter((p) => p.status === "active" || p.status === "onboarding")
      .map((p) => ({
        id: p.id,
        fullName: p.fullName,
        department: p.department,
        countryCode: p.countryCode,
        scheduleType: p.scheduleType ?? "weekday",
        weekendShiftHours: (p.weekendShiftHours ?? "full") as "full" | "part"
      }));
  }, [people]);

  const schedules = useMemo(() => {
    return schedulesData?.schedules ?? [];
  }, [schedulesData]);

  // Auto-dismiss toasts
  useEffect(() => {
    if (toasts.length === 0) return;
    const timer = setTimeout(() => {
      setToasts((prev) => prev.slice(1));
    }, 4000);
    return () => clearTimeout(timer);
  }, [toasts]);

  const addToast = useCallback((type: ToastMessage["type"], text: string) => {
    setToasts((prev) => [...prev, { id: ++toastCounter, type, text }]);
  }, []);

  const handlePublish = useCallback(async (scheduleId: string) => {
    setPublishingId(scheduleId);
    setConfirmPublish(null);

    try {
      const res = await fetch(`/api/v1/scheduling/schedules/${scheduleId}/publish`, {
        method: "POST"
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error?.message ?? "Failed to publish schedule.");
      }

      addToast("success", "Schedule published successfully.");
      refreshSchedules();
    } catch (err) {
      addToast("error", err instanceof Error ? err.message : "Failed to publish schedule.");
    } finally {
      setPublishingId(null);
    }
  }, [addToast, refreshSchedules]);

  const handleDelete = useCallback(async (scheduleId: string) => {
    setConfirmDelete(null);

    try {
      const res = await fetch(`/api/v1/scheduling/schedules/${scheduleId}`, {
        method: "DELETE"
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error?.message ?? "Failed to delete schedule.");
      }

      addToast("success", "Schedule deleted.");
      refreshSchedules();
    } catch (err) {
      addToast("error", err instanceof Error ? err.message : "Failed to delete schedule.");
    }
  }, [addToast, refreshSchedules]);

  const handleViewShifts = useCallback((_scheduleId: string) => {
    // For now, just show an info toast. Future: could open a shift detail panel.
    addToast("info", "Shift details are visible in the My Schedule tab after publishing.");
  }, [addToast]);

  const handleWizardSubmit = useCallback(async () => {
    // The wizard already created the schedule and generated shifts
    // Just refresh the list
    refreshSchedules();
    addToast("success", "Schedule created with auto-generated shifts.");
  }, [refreshSchedules, addToast]);

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
      {/* Header with New Schedule button */}
      <div className="schedule-manage-header">
        <div>
          <h3 className="section-title">Schedules</h3>
          <p className="settings-card-description">
            Create and manage monthly schedules for your team.
          </p>
        </div>
        <button
          type="button"
          className="button button-primary"
          onClick={() => setWizardOpen(true)}
        >
          New Schedule
        </button>
      </div>

      {/* Schedule cards grid */}
      <ScheduleCardGrid
        schedules={schedules}
        onPublish={(id) => setConfirmPublish(id)}
        onDelete={(id) => setConfirmDelete(id)}
        onViewShifts={handleViewShifts}
        onCreateNew={() => setWizardOpen(true)}
        publishingId={publishingId}
      />

      {/* Wizard slide panel */}
      <ScheduleWizard
        isOpen={wizardOpen}
        onClose={() => setWizardOpen(false)}
        employees={rosterEmployees}
        onSubmit={handleWizardSubmit}
      />

      {/* Confirm publish dialog */}
      <ConfirmDialog
        isOpen={confirmPublish !== null}
        title="Publish schedule?"
        description="Publishing will notify all assigned team members. This action cannot be undone."
        confirmLabel="Publish"
        onConfirm={() => {
          if (confirmPublish) void handlePublish(confirmPublish);
        }}
        onCancel={() => setConfirmPublish(null)}
      />

      {/* Confirm delete dialog */}
      <ConfirmDialog
        isOpen={confirmDelete !== null}
        title="Delete schedule?"
        description="This will permanently delete the draft schedule and all its shifts."
        confirmLabel="Delete"
        tone="danger"
        onConfirm={() => {
          if (confirmDelete) void handleDelete(confirmDelete);
        }}
        onCancel={() => setConfirmDelete(null)}
      />

      {/* Toast notifications */}
      {toasts.length > 0 ? (
        <section className="toast-region" aria-live="polite">
          {toasts.map((toast) => (
            <div key={toast.id} className={`toast-message toast-message-${toast.type}`}>
              <span>{toast.text}</span>
              <button
                type="button"
                className="icon-button"
                onClick={() => setToasts((prev) => prev.filter((t) => t.id !== toast.id))}
                aria-label="Dismiss"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          ))}
        </section>
      ) : null}
    </section>
  );
}
