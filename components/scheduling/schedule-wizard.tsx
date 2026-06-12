"use client";

import { useCallback, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { SlidePanel } from "../shared/slide-panel";
import type { ScheduleTrack } from "../../types/scheduling";
import { TrackSelector } from "./track-selector";
import { PeriodPicker, getDefaultMonth, getDefaultCustomStart, getDefaultCustomEnd } from "./period-picker";
import { RosterSelector, type RosterEmployee, type RosterSelection } from "./roster-selector";
import { ScheduleReview } from "./schedule-review";
import {
  ShiftSlotsSelector,
  type ShiftSlotSelection
} from "./shift-slots-selector";

type WizardStep = "track" | "period" | "slots" | "roster" | "review";

const STEPS: WizardStep[] = ["track", "period", "slots", "roster", "review"];

const SLOT_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

const DEFAULT_WEEKDAY_SLOTS: ShiftSlotSelection[] = [
  { name: "Morning Shift", startTime: "08:00", endTime: "16:00" },
  { name: "Afternoon Shift", startTime: "16:00", endTime: "00:00" }
];

const DEFAULT_WEEKEND_SLOTS: ShiftSlotSelection[] = [
  { name: "Weekend Day Shift", startTime: "08:00", endTime: "16:00" },
  { name: "Weekend Evening Shift", startTime: "16:00", endTime: "00:00" }
];

function defaultSlotsForTrack(track: ScheduleTrack | null): ShiftSlotSelection[] {
  if (track === "weekend") {
    return DEFAULT_WEEKEND_SLOTS.map((slot) => ({ ...slot }));
  }

  return DEFAULT_WEEKDAY_SLOTS.map((slot) => ({ ...slot }));
}

function isValidSlot(slot: ShiftSlotSelection): boolean {
  const name = slot.name.trim();
  if (name.length === 0) {
    return false;
  }

  if (
    !SLOT_TIME_PATTERN.test(slot.startTime) ||
    !SLOT_TIME_PATTERN.test(slot.endTime)
  ) {
    return false;
  }

  return slot.startTime !== slot.endTime;
}

export type ScheduleWizardResult = {
  /** Whether the schedule itself was created (generation may still have failed). */
  scheduleCreated: boolean;
  /** Whether the "generate automatically" toggle was on. */
  autoGenerateEnabled: boolean;
  /** Number of shifts saved by auto-generation (0 when off, skipped, or failed). */
  generatedCount: number;
  /** True when the schedule was created but auto-generation failed — the grid is empty. */
  generationFailed: boolean;
};

type ScheduleWizardProps = {
  isOpen: boolean;
  onClose: () => void;
  employees: RosterEmployee[];
  onSubmit: (result: ScheduleWizardResult) => Promise<void>;
};

export function ScheduleWizard({ isOpen, onClose, employees, onSubmit }: ScheduleWizardProps) {
  const t = useTranslations("scheduling");
  const tc = useTranslations("common");

  const stepTitles: Record<WizardStep, string> = {
    track: t("wizard.stepTrack"),
    period: t("wizard.stepPeriod"),
    slots: t("wizard.stepSlots"),
    roster: t("wizard.stepRoster"),
    review: t("wizard.stepReview")
  };

  const [step, setStep] = useState<WizardStep>("track");
  const [track, setTrack] = useState<ScheduleTrack | null>(null);
  const [month, setMonth] = useState(getDefaultMonth);
  const [months, setMonths] = useState(1);
  const [slots, setSlots] = useState<ShiftSlotSelection[]>(() =>
    defaultSlotsForTrack(null)
  );
  const [customStartDate, setCustomStartDate] = useState(getDefaultCustomStart);
  const [customEndDate, setCustomEndDate] = useState(getDefaultCustomEnd);
  const [rosterSelected, setRosterSelected] = useState<Map<string, RosterSelection>>(new Map());
  const [autoGenerate, setAutoGenerate] = useState(true);
  const [wizardResult, setWizardResult] = useState<ScheduleWizardResult | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [previewData, setPreviewData] = useState<{
    estimatedShifts: number;
    warnings: Array<{ message: string }>;
    shiftDetails: Array<{
      employeeName: string;
      shiftDate: string;
      slotName: string;
      startTime: string;
      endTime: string;
    }>;
  } | null>(null);

  const currentStepIndex = STEPS.indexOf(step);
  const isCustomPeriod = months === 0;

  // Auto-select the pilot department's members the first time the roster step appears.
  // Scheduling is piloted by the Customer Success team (the crew that runs shift coverage).
  const [pilotAutoSelected, setPilotAutoSelected] = useState(false);

  if (step === "roster" && !pilotAutoSelected && rosterSelected.size === 0 && employees.length > 0) {
    const pilotDept = "customer success";
    const preselected = new Map<string, RosterSelection>();
    for (const emp of employees) {
      if (emp.department?.toLowerCase() === pilotDept) {
        preselected.set(emp.id, { employeeId: emp.id, weekendHours: emp.weekendShiftHours });
      }
    }
    if (preselected.size > 0) {
      setRosterSelected(preselected);
    }
    setPilotAutoSelected(true);
  }

  const canProceed = useMemo(() => {
    switch (step) {
      case "track": return track !== null;
      case "period":
        if (isCustomPeriod) {
          return customStartDate.length > 0 && customEndDate.length > 0 && customEndDate >= customStartDate;
        }
        return month.length > 0;
      case "slots":
        return slots.length >= 2 && slots.every((slot) => isValidSlot(slot));
      case "roster": return rosterSelected.size > 0;
      case "review": return previewData !== null && !isGenerating;
      default: return false;
    }
  }, [
    step,
    track,
    month,
    isCustomPeriod,
    customStartDate,
    customEndDate,
    slots,
    rosterSelected.size,
    previewData,
    isGenerating
  ]);

  const handleTrackChange = useCallback((nextTrack: ScheduleTrack) => {
    setTrack(nextTrack);
    setSlots(defaultSlotsForTrack(nextTrack));
  }, []);

  const computedDateRange = useMemo(() => {
    if (isCustomPeriod) {
      return { startDate: customStartDate, endDate: customEndDate };
    }

    const [yearStr, monthStr] = month.split("-");
    const year = Number(yearStr);
    const mon = Number(monthStr);

    const startDate = `${year}-${String(mon).padStart(2, "0")}-01`;
    const endMonth = mon + months - 1;
    const endYear = year + Math.floor((endMonth - 1) / 12);
    const endMon = ((endMonth - 1) % 12) + 1;
    const lastDay = new Date(Date.UTC(endYear, endMon, 0)).getUTCDate();
    const endDate = `${endYear}-${String(endMon).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

    return { startDate, endDate };
  }, [month, months, isCustomPeriod, customStartDate, customEndDate]);

  const selectedDepartment = useMemo(() => {
    if (rosterSelected.size === 0) {
      return undefined;
    }

    const employeeById = new Map(employees.map((employee) => [employee.id, employee] as const));
    const departments = new Set<string>();

    for (const selection of rosterSelected.values()) {
      const department = employeeById.get(selection.employeeId)?.department?.trim();
      if (department) {
        departments.add(department);
      }
    }

    return departments.size === 1 ? [...departments][0] : undefined;
  }, [employees, rosterSelected]);

  const handleNext = useCallback(async () => {
    const nextIndex = currentStepIndex + 1;
    if (nextIndex >= STEPS.length) return;

    const nextStep = STEPS[nextIndex]!;

    // When moving to review, create the schedule and (optionally) auto-generate
    if (nextStep === "review" && track) {
      setIsGenerating(true);
      setPreviewData(null);
      setWizardResult(null);
      setStep(nextStep);

      try {
        const rosterEntries = [...rosterSelected.values()];
        const { startDate, endDate } = computedDateRange;

        // First create the schedule
        const createRes = await fetch("/api/v1/scheduling/schedules", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            scheduleTrack: track,
            month: isCustomPeriod ? undefined : month,
            months: isCustomPeriod ? undefined : months,
            startDate: isCustomPeriod ? startDate : undefined,
            endDate: isCustomPeriod ? endDate : undefined,
            name: `${track === "weekend" ? t("track.weekendSchedule") : t("track.weekdaySchedule")}`,
            department: selectedDepartment,
            roster: rosterEntries.map((r) => ({
              employeeId: r.employeeId,
              weekendHours: track === "weekend" ? r.weekendHours : undefined
            }))
          })
        });

        if (!createRes.ok) {
          const err = await createRes.json().catch(() => null);
          throw new Error(err?.error?.message ?? t("wizard.failedCreate"));
        }

        const createData = await createRes.json();
        const scheduleId = createData?.data?.schedule?.id;

        if (!scheduleId) {
          throw new Error(t("wizard.noScheduleId"));
        }

        // Auto-generation is opt-out: when off, the schedule starts empty and
        // assignments are composed manually in the grid.
        if (!autoGenerate) {
          setWizardResult({
            scheduleCreated: true,
            autoGenerateEnabled: false,
            generatedCount: 0,
            generationFailed: false
          });
          setPreviewData({
            estimatedShifts: 0,
            warnings: [{ message: t("wizard.autoGenerateOffNote") }],
            shiftDetails: []
          });
          return;
        }

        // Generation failures are non-fatal: the schedule already exists, so
        // surface a warning and leave the grid empty instead of erroring out.
        try {
          const genRes = await fetch(`/api/v1/scheduling/schedules/${scheduleId}/auto-generate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              scheduleType: track,
              // The user hand-picked this roster, so every selected member is eligible
              // regardless of their profile schedule_type. Without this, weekday-typed
              // crew get filtered out of a weekend schedule and produce no shifts.
              respectEmployeeScheduleType: false,
              slots: slots.map((slot) => ({
                name: slot.name.trim(),
                startTime: slot.startTime,
                endTime: slot.endTime
              }))
            })
          });

          if (!genRes.ok) {
            const err = await genRes.json().catch(() => null);
            throw new Error(err?.error?.message ?? t("wizard.failedGenerate"));
          }

          const genData = await genRes.json();
          const assignments = genData?.data?.assignments ?? [];
          const genWarnings = genData?.data?.warnings ?? [];

          // Confirm (save) the generated assignments
          if (assignments.length > 0) {
            const saveRes = await fetch(`/api/v1/scheduling/schedules/${scheduleId}/auto-generate`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                confirm: true,
                assignments: assignments.map((a: Record<string, string>) => ({
                  employeeId: a.employeeId,
                  shiftDate: a.shiftDate,
                  slotName: a.slotName,
                  startTime: a.startTime,
                  endTime: a.endTime
                }))
              })
            });

            if (!saveRes.ok) {
              const err = await saveRes.json().catch(() => null);
              throw new Error(err?.error?.message ?? t("wizard.failedGenerate"));
            }
          }

          // Count warnings about employees on leave
          const leaveWarnings: Array<{ message: string }> = [];
          if (genWarnings.length > 0) {
            const uniqueDates = new Set(genWarnings.map((w: string) => w.split(":")[0]));
            leaveWarnings.push({
              message: t("wizard.warningUnfilledShifts", { count: uniqueDates.size })
            });
          }

          setWizardResult({
            scheduleCreated: true,
            autoGenerateEnabled: true,
            generatedCount: assignments.length,
            generationFailed: false
          });
          setPreviewData({
            estimatedShifts: assignments.length,
            warnings: leaveWarnings,
            shiftDetails: assignments.map((a: Record<string, string>) => ({
              employeeName: a.employeeName ?? t("wizard.unknownEmployee"),
              shiftDate: a.shiftDate,
              slotName: a.slotName,
              startTime: a.startTime,
              endTime: a.endTime
            }))
          });
        } catch {
          setWizardResult({
            scheduleCreated: true,
            autoGenerateEnabled: true,
            generatedCount: 0,
            generationFailed: true
          });
          setPreviewData({
            estimatedShifts: 0,
            warnings: [{ message: t("wizard.warningGenerationFailed") }],
            shiftDetails: []
          });
        }
      } catch (err) {
        setWizardResult({
          scheduleCreated: false,
          autoGenerateEnabled: autoGenerate,
          generatedCount: 0,
          generationFailed: false
        });
        setPreviewData({
          estimatedShifts: 0,
          warnings: [{ message: err instanceof Error ? err.message : t("wizard.failedGenerateSchedule") }],
          shiftDetails: []
        });
      } finally {
        setIsGenerating(false);
      }

      return;
    }

    setStep(nextStep);
  }, [
    currentStepIndex,
    track,
    rosterSelected,
    computedDateRange,
    month,
    months,
    isCustomPeriod,
    selectedDepartment,
    slots,
    autoGenerate,
    t
  ]);

  const handleBack = useCallback(() => {
    const prevIndex = currentStepIndex - 1;
    if (prevIndex < 0) return;
    setStep(STEPS[prevIndex]!);
  }, [currentStepIndex]);

  const handleCreate = useCallback(async () => {
    if (!track || isSubmitting) return;
    setIsSubmitting(true);

    try {
      await onSubmit(
        wizardResult ?? {
          scheduleCreated: false,
          autoGenerateEnabled: autoGenerate,
          generatedCount: 0,
          generationFailed: false
        }
      );

      // Reset wizard state
      setStep("track");
      setTrack(null);
      setMonth(getDefaultMonth());
      setMonths(1);
      setSlots(defaultSlotsForTrack(null));
      setCustomStartDate(getDefaultCustomStart());
      setCustomEndDate(getDefaultCustomEnd());
      setRosterSelected(new Map());
      setAutoGenerate(true);
      setWizardResult(null);
      setPreviewData(null);
      setPilotAutoSelected(false);
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  }, [track, isSubmitting, onSubmit, onClose, wizardResult, autoGenerate]);

  const handleCloseWizard = useCallback(() => {
    setStep("track");
    setTrack(null);
    setMonth(getDefaultMonth());
    setMonths(1);
    setSlots(defaultSlotsForTrack(null));
    setCustomStartDate(getDefaultCustomStart());
    setCustomEndDate(getDefaultCustomEnd());
    setRosterSelected(new Map());
    setAutoGenerate(true);
    setWizardResult(null);
    setPreviewData(null);
    setPilotAutoSelected(false);
    onClose();
  }, [onClose]);

  return (
    <SlidePanel
      isOpen={isOpen}
      title={t("wizard.newSchedule")}
      description={stepTitles[step]}
      onClose={handleCloseWizard}
    >
      {/* Wrap in a form with preventDefault to block Enter-key page navigation */}
      <form
        className="schedule-wizard"
        onSubmit={(e) => {
          e.preventDefault();
          // If user presses Enter, treat it as clicking Next / Done
          if (step === "review") {
            if (canProceed && !isSubmitting) void handleCreate();
          } else {
            if (canProceed) void handleNext();
          }
        }}
      >
        {/* Step indicators */}
        <div className="schedule-wizard-steps">
          {STEPS.map((s, i) => (
            <div
              key={s}
              className={`schedule-wizard-step-dot ${i <= currentStepIndex ? "schedule-wizard-step-dot-active" : ""} ${i === currentStepIndex ? "schedule-wizard-step-dot-current" : ""}`}
            />
          ))}
        </div>

        {/* Step content */}
        <div className="schedule-wizard-content">
          {step === "track" ? (
            <TrackSelector value={track} onChange={handleTrackChange} />
          ) : null}

          {step === "period" ? (
            <PeriodPicker
              month={month}
              months={months}
              customStartDate={customStartDate}
              customEndDate={customEndDate}
              onMonthChange={setMonth}
              onMonthsChange={setMonths}
              onCustomStartChange={setCustomStartDate}
              onCustomEndChange={setCustomEndDate}
            />
          ) : null}

          {step === "slots" ? (
            <ShiftSlotsSelector
              slots={slots}
              onChange={setSlots}
            />
          ) : null}

          {step === "roster" && track ? (
            <>
              <RosterSelector
                employees={employees}
                track={track}
                selected={rosterSelected}
                onChange={setRosterSelected}
              />
              <label className="settings-checkbox schedule-wizard-autogen">
                <input
                  type="checkbox"
                  checked={autoGenerate}
                  onChange={(event) => setAutoGenerate(event.target.checked)}
                />
                <span>{t("wizard.autoGenerateLabel")}</span>
              </label>
            </>
          ) : null}

          {step === "review" && track ? (
            <ScheduleReview
              track={track}
              month={month}
              months={months}
              startDate={computedDateRange.startDate}
              endDate={computedDateRange.endDate}
              employeeCount={rosterSelected.size}
              estimatedShifts={previewData?.estimatedShifts ?? 0}
              warnings={previewData?.warnings ?? []}
              shiftDetails={previewData?.shiftDetails}
              isGenerating={isGenerating}
            />
          ) : null}
        </div>

        {/* Navigation buttons */}
        <div className="schedule-wizard-footer">
          {currentStepIndex > 0 ? (
            <button type="button" className="button button-ghost" onClick={handleBack} disabled={isSubmitting || isGenerating}>
              {tc("back")}
            </button>
          ) : (
            <div />
          )}

          {step === "review" ? (
            <button
              type="submit"
              className="button button-primary"
              disabled={!canProceed || isSubmitting}
            >
              {isSubmitting ? tc("finishing") : tc("done")}
            </button>
          ) : (
            <button
              type="submit"
              className="button button-primary"
              disabled={!canProceed}
            >
              {tc("next")}
            </button>
          )}
        </div>
      </form>
    </SlidePanel>
  );
}
