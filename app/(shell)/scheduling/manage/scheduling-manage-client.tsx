"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";

import { ConfirmDialog } from "../../../../components/shared/confirm-dialog";
import { ScheduleCardGrid } from "../../../../components/scheduling/schedule-card-grid";
import { ScheduleWizard, type ScheduleWizardResult } from "../../../../components/scheduling/schedule-wizard";
import { TeamSetupPanel } from "../../../../components/scheduling/team-setup-panel";
import type { RosterEmployee } from "../../../../components/scheduling/roster-selector";
import { useSchedulingSchedules } from "../../../../hooks/use-scheduling";
import { useAllPeople } from "../../../../hooks/use-people";
import type { UserRole } from "../../../../lib/navigation";
import { hasRole } from "../../../../lib/roles";
import type { ScheduleRecord } from "../../../../types/scheduling";

function addIsoDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function isoDaysBetween(startIso: string, endIso: string): number {
  const start = new Date(`${startIso}T00:00:00.000Z`).getTime();
  const end = new Date(`${endIso}T00:00:00.000Z`).getTime();
  return Math.round((end - start) / 86_400_000);
}


type ToastMessage = {
  id: number;
  type: "success" | "error" | "info" | "warning";
  text: string;
};

let toastCounter = 0;

export function SchedulingManageClient({
  userRoles,
  userDepartment
}: {
  userRoles: UserRole[];
  userDepartment?: string | null;
}) {
  const t = useTranslations("scheduling");
  const tc = useTranslations("common");
  const router = useRouter();
  const { data: schedulesData, isLoading, refresh: refreshSchedules } = useSchedulingSchedules({ scope: "team" });
  const {
    people,
    isLoading: isPeopleLoading,
    setPeople
  } = useAllPeople();
  const isSuperAdmin = hasRole(userRoles, "SUPER_ADMIN");
  const isHrAdmin = hasRole(userRoles, "HR_ADMIN");

  const [wizardOpen, setWizardOpen] = useState(false);
  const [manageView, setManageView] = useState<"schedules" | "team-setup">(
    "schedules"
  );
  const [publishingId, setPublishingId] = useState<string | null>(null);
  const [confirmPublish, setConfirmPublish] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [duplicateSource, setDuplicateSource] = useState<ScheduleRecord | null>(null);
  const [dupName, setDupName] = useState("");
  const [dupStart, setDupStart] = useState("");
  const [dupEnd, setDupEnd] = useState("");
  const [isDuplicating, setIsDuplicating] = useState(false);
  // P1-2: one stable operation key per duplicate attempt, generated before the
  // first request and REUSED on retry so a retried duplication is idempotent
  // (the RPC returns the already-created schedule instead of a second draft).
  // Cleared on success/close so the next duplication gets a fresh key.
  const dupOpKeyRef = useRef<string | null>(null);
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

  const schedules = useMemo(() => schedulesData?.schedules ?? [], [schedulesData]);
  const teamSetupMembers = useMemo(() => {
    if (isSuperAdmin || isHrAdmin) {
      return people;
    }

    if (!userDepartment) {
      return [];
    }

    const normalizedDepartment = userDepartment.trim().toLowerCase();
    return people.filter(
      (person) =>
        person.department?.trim().toLowerCase() === normalizedDepartment
    );
  }, [isHrAdmin, isSuperAdmin, people, userDepartment]);

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

  const openDuplicate = useCallback((schedule: ScheduleRecord) => {
    // Prefill the new schedule to start the day after the source ends, with the same span.
    const span = Math.max(0, isoDaysBetween(schedule.startDate, schedule.endDate));
    const start = addIsoDays(schedule.endDate, 1);
    setDuplicateSource(schedule);
    setDupName(`${schedule.name ?? t("manage.untitledSchedule")} (copy)`);
    setDupStart(start);
    setDupEnd(addIsoDays(start, span));
  }, [t]);

  const closeDuplicate = useCallback(() => {
    setDuplicateSource(null);
    setIsDuplicating(false);
    dupOpKeyRef.current = null;
  }, []);

  const submitDuplicate = useCallback(async () => {
    if (!duplicateSource) return;
    if (!dupStart || !dupEnd || dupEnd < dupStart) {
      addToast("error", t("manage.duplicate.invalidDates"));
      return;
    }
    setIsDuplicating(true);
    // Mint the operation key once; a retry after a failure reuses the same key.
    // R3-3: the non-crypto fallback must be UNIQUE per dialog attempt (not a
    // deterministic source+range string), otherwise a later intentional
    // re-duplication of the same source/range would collide on the op key and
    // return the previous copy instead of creating a new one. It is still stored
    // in dupOpKeyRef so a retry of THIS attempt reuses it.
    if (!dupOpKeyRef.current) {
      dupOpKeyRef.current =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `dup-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e12).toString(36)}`;
    }
    try {
      const res = await fetch(`/api/v1/scheduling/schedules/${duplicateSource.id}/duplicate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: dupName.trim() || undefined,
          startDate: dupStart,
          endDate: dupEnd,
          operationKey: dupOpKeyRef.current
        })
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(payload?.error?.message ?? t("manage.duplicate.failed"));
      }
      const count = payload?.data?.schedule?.shiftCount ?? 0;
      addToast("success", t("manage.duplicate.success", { count }));
      refreshSchedules();
      closeDuplicate();
      router.replace("/scheduling?tab=build");
    } catch (err) {
      addToast("error", err instanceof Error ? err.message : t("manage.duplicate.failed"));
      setIsDuplicating(false);
    }
  }, [duplicateSource, dupName, dupStart, dupEnd, addToast, refreshSchedules, closeDuplicate, router, t]);

  const handleWizardSubmit = useCallback(async (result: ScheduleWizardResult) => {
    // The wizard already created the schedule (and generated shifts when
    // auto-generation was on) — refresh the list and report the outcome.
    refreshSchedules();

    if (!result.scheduleCreated) {
      // Creation failed; the wizard already surfaced the error in its review step.
      return;
    }

    if (result.generationFailed) {
      addToast("warning", t("manage.toastGenerationFailed"));
      return;
    }

    if (result.autoGenerateEnabled && result.generatedCount > 0) {
      addToast("success", t("manage.toastCreatedWithCount", { count: result.generatedCount }));
      return;
    }

    addToast("success", t("manage.toastCreatedEmpty"));
  }, [refreshSchedules, addToast, t]);

  const handleTeamMemberUpdated = useCallback(
    ({
      personId,
      scheduleType,
      weekendShiftHours
    }: {
      personId: string;
      scheduleType: string;
      weekendShiftHours: string | null;
    }) => {
      setPeople((current) =>
        current.map((person) =>
          person.id === personId
            ? {
                ...person,
                scheduleType,
                weekendShiftHours
              }
            : person
        )
      );
    },
    [setPeople]
  );

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
        {manageView === "schedules" ? (
          <button
            type="button"
            className="button button-primary"
            onClick={() => setWizardOpen(true)}
          >
            {t("wizard.newSchedule")}
          </button>
        ) : null}
      </div>

      <div className="schedule-manage-view-toggle" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={manageView === "schedules"}
          className={manageView === "schedules" ? "active" : ""}
          onClick={() => setManageView("schedules")}
        >
          {t("manage.viewSchedules")}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={manageView === "team-setup"}
          className={manageView === "team-setup" ? "active" : ""}
          onClick={() => setManageView("team-setup")}
        >
          {t("manage.viewTeamSetup")}
        </button>
      </div>

      {manageView === "schedules" ? (
        <ScheduleCardGrid
          schedules={schedules}
          onPublish={(id) => setConfirmPublish(id)}
          onRegenerate={handleRegenerate}
          onDelete={(id) => setConfirmDelete(id)}
          onViewShifts={handleViewShifts}
          onDuplicate={openDuplicate}
          onCreateNew={() => setWizardOpen(true)}
          publishingId={publishingId}
        />
      ) : (
        <TeamSetupPanel
          members={teamSetupMembers}
          isLoading={isPeopleLoading}
          onMemberUpdated={handleTeamMemberUpdated}
          onToast={addToast}
        />
      )}

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

      {/* Duplicate / use-as-template dialog */}
      {duplicateSource ? (
        <div className="modal-overlay" onClick={() => !isDuplicating && closeDuplicate()}>
          <section
            className="modal-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={t("manage.duplicate.title")}
            onClick={(event) => event.stopPropagation()}
            style={{ display: "grid", gap: "var(--space-3)", width: "min(480px, 92vw)" }}
          >
            <h2 className="modal-title">{t("manage.duplicate.title")}</h2>
            <p className="settings-card-description">{t("manage.duplicate.description")}</p>

            <label className="form-field">
              <span className="form-label">{t("manage.duplicate.nameLabel")}</span>
              <input
                className="form-input"
                value={dupName}
                onChange={(event) => setDupName(event.target.value)}
                maxLength={200}
                disabled={isDuplicating}
              />
            </label>

            <div className="timeoff-form-grid">
              <label className="form-field">
                <span className="form-label">{t("manage.duplicate.startLabel")}</span>
                <input
                  type="date"
                  className="form-input"
                  value={dupStart}
                  onChange={(event) => setDupStart(event.target.value)}
                  disabled={isDuplicating}
                />
              </label>
              <label className="form-field">
                <span className="form-label">{t("manage.duplicate.endLabel")}</span>
                <input
                  type="date"
                  className="form-input"
                  value={dupEnd}
                  min={dupStart}
                  onChange={(event) => setDupEnd(event.target.value)}
                  disabled={isDuplicating}
                />
              </label>
            </div>

            <p className="settings-card-description">{t("manage.duplicate.note")}</p>

            <div className="modal-actions">
              <button type="button" className="button button-subtle" onClick={closeDuplicate} disabled={isDuplicating}>
                {tc("cancel")}
              </button>
              <button
                type="button"
                className="button button-accent"
                onClick={() => void submitDuplicate()}
                disabled={isDuplicating || !dupStart || !dupEnd || dupEnd < dupStart}
              >
                {isDuplicating ? t("manage.duplicate.creating") : t("manage.duplicate.create")}
              </button>
            </div>
          </section>
        </div>
      ) : null}

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
