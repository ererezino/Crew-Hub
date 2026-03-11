"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";

import { ConfirmDialog } from "../../../../components/shared/confirm-dialog";
import { ScheduleCardGrid } from "../../../../components/scheduling/schedule-card-grid";
import { ScheduleWizard } from "../../../../components/scheduling/schedule-wizard";
import type { RosterEmployee } from "../../../../components/scheduling/roster-selector";
import { useSchedulingSchedules } from "../../../../hooks/use-scheduling";
import { usePeople } from "../../../../hooks/use-people";
import { areDepartmentsEqual } from "../../../../lib/department";


type ToastMessage = {
  id: number;
  type: "success" | "error" | "info";
  text: string;
};

let toastCounter = 0;

export function SchedulingManageClient({ viewerDepartment = null }: { viewerDepartment?: string | null }) {
  const t = useTranslations("scheduling");
  const tc = useTranslations("common");
  const router = useRouter();
  const { data: schedulesData, isLoading, refresh: refreshSchedules } = useSchedulingSchedules({ scope: "team" });
  const { people } = usePeople();

  const [wizardOpen, setWizardOpen] = useState(false);
  const [publishingId, setPublishingId] = useState<string | null>(null);
  const [confirmPublish, setConfirmPublish] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  // Convert people data to roster employees – Customer Success members first
  const CS_DEPT = "Customer Success";

  const rosterEmployees: RosterEmployee[] = useMemo(() => {
    if (!people || people.length === 0) return [];
    const mapped = people
      .filter((p) => p.status === "active" || p.status === "onboarding")
      .map((p) => ({
        id: p.id,
        fullName: p.fullName,
        department: p.department,
        countryCode: p.countryCode,
        scheduleType: p.scheduleType ?? "weekday",
        weekendShiftHours: (p.weekendShiftHours === "full" || p.weekendShiftHours === "part")
          ? (p.weekendShiftHours === "full" ? "8" : "4")
          : (p.weekendShiftHours as "2" | "3" | "4" | "8") ?? "8"
      }));

    // Sort: Customer Success first, then alphabetical within each group
    return mapped.sort((a, b) => {
      const aIsCS = a.department?.toLowerCase() === CS_DEPT.toLowerCase() ? 0 : 1;
      const bIsCS = b.department?.toLowerCase() === CS_DEPT.toLowerCase() ? 0 : 1;
      if (aIsCS !== bIsCS) return aIsCS - bIsCS;
      return a.fullName.localeCompare(b.fullName);
    });
  }, [people]);

  const schedules = useMemo(() => {
    const all = schedulesData?.schedules ?? [];

    if (!viewerDepartment) {
      return all;
    }

    return all.filter((schedule) => areDepartmentsEqual(schedule.department, viewerDepartment));
  }, [schedulesData, viewerDepartment]);

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
        throw new Error(data?.error?.message ?? t("manage.failedPublish"));
      }

      addToast("success", t("manage.toastPublished"));
      refreshSchedules();
    } catch (err) {
      addToast("error", err instanceof Error ? err.message : t("manage.failedPublish"));
    } finally {
      setPublishingId(null);
    }
  }, [addToast, refreshSchedules, t]);

  const handleRegenerate = useCallback(async (scheduleId: string) => {
    setPublishingId(scheduleId);

    try {
      const previewResponse = await fetch(`/api/v1/scheduling/schedules/${scheduleId}/auto-generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({})
      });

      const previewPayload = await previewResponse.json().catch(() => null);

      if (!previewResponse.ok) {
        throw new Error(previewPayload?.error?.message ?? t("wizard.failedGenerate"));
      }

      const assignments = (previewPayload?.data?.assignments ?? []) as Array<{
        employeeId: string;
        shiftDate: string;
        slotName: string;
        startTime: string;
        endTime: string;
      }>;

      if (assignments.length === 0) {
        throw new Error(t("wizard.failedGenerate"));
      }

      const saveResponse = await fetch(`/api/v1/scheduling/schedules/${scheduleId}/auto-generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          confirm: true,
          assignments: assignments.map((assignment) => ({
            employeeId: assignment.employeeId,
            shiftDate: assignment.shiftDate,
            slotName: assignment.slotName,
            startTime: assignment.startTime,
            endTime: assignment.endTime
          }))
        })
      });

      if (!saveResponse.ok) {
        const savePayload = await saveResponse.json().catch(() => null);
        throw new Error(savePayload?.error?.message ?? t("wizard.failedGenerate"));
      }

      addToast("success", t("manage.toastCreated"));
      refreshSchedules();
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : t("wizard.failedGenerate"));
    } finally {
      setPublishingId(null);
    }
  }, [addToast, refreshSchedules, t]);

  const handleDelete = useCallback(async (scheduleId: string) => {
    setConfirmDelete(null);

    try {
      const res = await fetch(`/api/v1/scheduling/schedules/${scheduleId}`, {
        method: "DELETE"
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error?.message ?? t("manage.failedDelete"));
      }

      addToast("success", t("manage.toastDeleted"));
      refreshSchedules();
    } catch (err) {
      addToast("error", err instanceof Error ? err.message : t("manage.failedDelete"));
    }
  }, [addToast, refreshSchedules, t]);

  const handleViewShifts = useCallback((scheduleId: string) => {
    router.replace(`/scheduling?tab=team-calendar&scheduleId=${encodeURIComponent(scheduleId)}`);
  }, [router]);

  const handleWizardSubmit = useCallback(async () => {
    // The wizard already created the schedule and generated shifts
    // Just refresh the list
    refreshSchedules();
    addToast("success", t("manage.toastCreated"));
  }, [refreshSchedules, addToast, t]);

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
          <h3 className="section-title">{t("manage.title")}</h3>
          <p className="settings-card-description">
            {t("manage.description")}
          </p>
        </div>
        <button
          type="button"
          className="button button-primary"
          onClick={() => setWizardOpen(true)}
        >
          {t("wizard.newSchedule")}
        </button>
      </div>

      {/* Schedule cards grid */}
      <ScheduleCardGrid
        schedules={schedules}
        onPublish={(id) => setConfirmPublish(id)}
        onRegenerate={handleRegenerate}
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
        title={t("manage.confirmPublishTitle")}
        description={t("manage.confirmPublishBody")}
        confirmLabel={tc("publish")}
        onConfirm={() => {
          if (confirmPublish) void handlePublish(confirmPublish);
        }}
        onCancel={() => setConfirmPublish(null)}
      />

      {/* Confirm delete dialog */}
      <ConfirmDialog
        isOpen={confirmDelete !== null}
        title={t("manage.confirmDeleteTitle")}
        description={t("manage.confirmDeleteBody")}
        confirmLabel={tc("delete")}
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
                aria-label={tc("dismiss")}
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
