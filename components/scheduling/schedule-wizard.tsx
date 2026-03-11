"use client";

import { useCallback, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { SlidePanel } from "../shared/slide-panel";
import type { ScheduleTrack } from "../../types/scheduling";
import { TrackSelector } from "./track-selector";
import { PeriodPicker, getDefaultMonth, getDefaultCustomStart, getDefaultCustomEnd } from "./period-picker";
import { RosterSelector, type RosterEmployee, type RosterSelection } from "./roster-selector";
import { ScheduleReview } from "./schedule-review";

type WizardStep = "track" | "period" | "roster" | "review";

const STEPS: WizardStep[] = ["track", "period", "roster", "review"];

type ScheduleWizardProps = {
  isOpen: boolean;
  onClose: () => void;
  employees: RosterEmployee[];
  onSubmit: (data: {
    track: ScheduleTrack;
    month: string;
    months: number;
    roster: RosterSelection[];
  }) => Promise<void>;
};

export function ScheduleWizard({ isOpen, onClose, employees, onSubmit }: ScheduleWizardProps) {
  const t = useTranslations("scheduling");
  const tc = useTranslations("common");

  const stepTitles: Record<WizardStep, string> = {
    track: t("wizard.stepTrack"),
    period: t("wizard.stepPeriod"),
    roster: t("wizard.stepRoster"),
    review: t("wizard.stepReview")
  };

  const [step, setStep] = useState<WizardStep>("track");
  const [track, setTrack] = useState<ScheduleTrack | null>(null);
  const [month, setMonth] = useState(getDefaultMonth);
  const [months, setMonths] = useState(1);
  const [customStartDate, setCustomStartDate] = useState(getDefaultCustomStart);
  const [customEndDate, setCustomEndDate] = useState(getDefaultCustomEnd);
  const [rosterSelected, setRosterSelected] = useState<Map<string, RosterSelection>>(new Map());
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

  // Auto-select Customer Success members the first time the roster step appears
  const [csAutoSelected, setCsAutoSelected] = useState(false);

  if (step === "roster" && !csAutoSelected && rosterSelected.size === 0 && employees.length > 0) {
    const csDept = "customer success";
    const preselected = new Map<string, RosterSelection>();
    for (const emp of employees) {
      if (emp.department?.toLowerCase() === csDept) {
        preselected.set(emp.id, { employeeId: emp.id, weekendHours: emp.weekendShiftHours });
      }
    }
    if (preselected.size > 0) {
      setRosterSelected(preselected);
    }
    setCsAutoSelected(true);
  }

  const canProceed = useMemo(() => {
    switch (step) {
      case "track": return track !== null;
      case "period":
        if (isCustomPeriod) {
          return customStartDate.length > 0 && customEndDate.length > 0 && customEndDate >= customStartDate;
        }
        return month.length > 0;
      case "roster": return rosterSelected.size > 0;
      case "review": return previewData !== null && !isGenerating;
      default: return false;
    }
  }, [step, track, month, isCustomPeriod, customStartDate, customEndDate, rosterSelected.size, previewData, isGenerating]);

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

    // When moving to review, generate the preview
    if (nextStep === "review" && track) {
      setIsGenerating(true);
      setPreviewData(null);
      setStep(nextStep);

      try {
        // Create schedule + auto-generate in one flow
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

        // Auto-generate shifts
        const genRes = await fetch(`/api/v1/scheduling/schedules/${scheduleId}/auto-generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            scheduleType: track
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
      } catch (err) {
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
  }, [currentStepIndex, track, rosterSelected, computedDateRange, month, months, isCustomPeriod, selectedDepartment, t]);

  const handleBack = useCallback(() => {
    const prevIndex = currentStepIndex - 1;
    if (prevIndex < 0) return;
    setStep(STEPS[prevIndex]!);
  }, [currentStepIndex]);

  const handleCreate = useCallback(async () => {
    if (!track || isSubmitting) return;
    setIsSubmitting(true);

    try {
      await onSubmit({
        track,
        month,
        months,
        roster: [...rosterSelected.values()]
      });

      // Reset wizard state
      setStep("track");
      setTrack(null);
      setMonth(getDefaultMonth());
      setMonths(1);
      setCustomStartDate(getDefaultCustomStart());
      setCustomEndDate(getDefaultCustomEnd());
      setRosterSelected(new Map());
      setPreviewData(null);
      setCsAutoSelected(false);
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  }, [track, month, months, rosterSelected, isSubmitting, onSubmit, onClose]);

  const handleCloseWizard = useCallback(() => {
    setStep("track");
    setTrack(null);
    setMonth(getDefaultMonth());
    setMonths(1);
    setCustomStartDate(getDefaultCustomStart());
    setCustomEndDate(getDefaultCustomEnd());
    setRosterSelected(new Map());
    setPreviewData(null);
    setCsAutoSelected(false);
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
            <TrackSelector value={track} onChange={setTrack} />
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

          {step === "roster" && track ? (
            <RosterSelector
              employees={employees}
              track={track}
              selected={rosterSelected}
              onChange={setRosterSelected}
            />
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
