"use client";

import { useCallback, useMemo, useState } from "react";

import { SlidePanel } from "../shared/slide-panel";
import type { ScheduleTrack } from "../../types/scheduling";
import { TrackSelector } from "./track-selector";
import { PeriodPicker, getDefaultMonth } from "./period-picker";
import { RosterSelector, type RosterEmployee, type RosterSelection } from "./roster-selector";
import { ScheduleReview } from "./schedule-review";

type WizardStep = "track" | "period" | "roster" | "review";

const STEPS: WizardStep[] = ["track", "period", "roster", "review"];

const STEP_TITLES: Record<WizardStep, string> = {
  track: "Schedule Type",
  period: "Time Period",
  roster: "Team Members",
  review: "Review & Create"
};

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
  const [step, setStep] = useState<WizardStep>("track");
  const [track, setTrack] = useState<ScheduleTrack | null>(null);
  const [month, setMonth] = useState(getDefaultMonth);
  const [months, setMonths] = useState(1);
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

  const canProceed = useMemo(() => {
    switch (step) {
      case "track": return track !== null;
      case "period": return month.length > 0;
      case "roster": return rosterSelected.size > 0;
      case "review": return previewData !== null && !isGenerating;
      default: return false;
    }
  }, [step, track, month, rosterSelected.size, previewData, isGenerating]);

  const computedDateRange = useMemo(() => {
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
  }, [month, months]);

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
            month,
            months,
            name: `${track === "weekend" ? "Weekend" : "Weekday"} Schedule`,
            roster: rosterEntries.map((r) => ({
              employeeId: r.employeeId,
              weekendHours: track === "weekend" ? r.weekendHours : undefined
            }))
          })
        });

        if (!createRes.ok) {
          const err = await createRes.json().catch(() => null);
          throw new Error(err?.error?.message ?? "Failed to create schedule");
        }

        const createData = await createRes.json();
        const scheduleId = createData?.data?.schedule?.id;

        if (!scheduleId) {
          throw new Error("Schedule creation did not return an ID");
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
          throw new Error(err?.error?.message ?? "Failed to generate shifts");
        }

        const genData = await genRes.json();
        const assignments = genData?.data?.assignments ?? [];
        const genWarnings = genData?.data?.warnings ?? [];

        // Confirm (save) the generated assignments
        if (assignments.length > 0) {
          await fetch(`/api/v1/scheduling/schedules/${scheduleId}/auto-generate`, {
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
        }

        // Count warnings about employees on leave
        const leaveWarnings: Array<{ message: string }> = [];
        if (genWarnings.length > 0) {
          // Summarize rather than list all unfilled slots
          const uniqueDates = new Set(genWarnings.map((w: string) => w.split(":")[0]));
          leaveWarnings.push({
            message: `${uniqueDates.size} day(s) have unfilled shifts due to limited availability.`
          });
        }

        setPreviewData({
          estimatedShifts: assignments.length,
          warnings: leaveWarnings,
          shiftDetails: assignments.map((a: Record<string, string>) => ({
            employeeName: a.employeeName ?? "Unknown",
            shiftDate: a.shiftDate,
            slotName: a.slotName,
            startTime: a.startTime,
            endTime: a.endTime
          }))
        });
      } catch (err) {
        setPreviewData({
          estimatedShifts: 0,
          warnings: [{ message: err instanceof Error ? err.message : "Failed to generate schedule." }],
          shiftDetails: []
        });
      } finally {
        setIsGenerating(false);
      }

      return;
    }

    setStep(nextStep);
  }, [currentStepIndex, track, rosterSelected, computedDateRange, month, months]);

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
      setRosterSelected(new Map());
      setPreviewData(null);
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
    setRosterSelected(new Map());
    setPreviewData(null);
    onClose();
  }, [onClose]);

  return (
    <SlidePanel
      isOpen={isOpen}
      title="New Schedule"
      description={STEP_TITLES[step]}
      onClose={handleCloseWizard}
    >
      <div className="schedule-wizard">
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
              onMonthChange={setMonth}
              onMonthsChange={setMonths}
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
              Back
            </button>
          ) : (
            <div />
          )}

          {step === "review" ? (
            <button
              type="button"
              className="button button-primary"
              onClick={handleCreate}
              disabled={!canProceed || isSubmitting}
            >
              {isSubmitting ? "Finishing..." : "Done"}
            </button>
          ) : (
            <button
              type="button"
              className="button button-primary"
              onClick={handleNext}
              disabled={!canProceed}
            >
              Next
            </button>
          )}
        </div>
      </div>
    </SlidePanel>
  );
}
