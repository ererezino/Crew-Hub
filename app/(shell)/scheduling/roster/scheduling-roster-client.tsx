"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../../components/ui/select";
import { EmptyState } from "../../../../components/shared/empty-state";
import { useSchedulingSchedules, useSchedulingShifts } from "../../../../hooks/use-scheduling";
import {
  buildCells,
  buildSlots,
  buildWeeks,
  gridShortDate
} from "../../../../lib/scheduling/week-grid";
import type { ScheduleRecord } from "../../../../types/scheduling";

const DAY_LETTERS = ["M", "T", "W", "T", "F", "S", "S"]; // Mon..Sun

/**
 * Read-only team roster for ALL crew: the full published team schedule — who works each
 * shift, week by week. Mobile-first (stacked list, full names, no truncation), so teammates
 * can finally see who they're working with.
 */
export function SchedulingRosterClient({ currentUserId = "" }: { currentUserId?: string }) {
  const t = useTranslations("scheduling");
  const locale = useLocale();

  const schedulesQuery = useSchedulingSchedules({ scope: "team", status: "published" });
  const schedules = useMemo(() => schedulesQuery.data?.schedules ?? [], [schedulesQuery.data]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const activeSchedule: ScheduleRecord | null = useMemo(() => {
    if (schedules.length === 0) return null;
    return schedules.find((s) => s.id === selectedId) ?? schedules[0] ?? null;
  }, [schedules, selectedId]);

  const shiftsQuery = useSchedulingShifts(
    activeSchedule
      ? {
          scope: "team",
          scheduleId: activeSchedule.id,
          startDate: activeSchedule.startDate,
          endDate: activeSchedule.endDate,
          limit: 2000
        }
      : {}
  );
  const shifts = useMemo(() => shiftsQuery.data?.shifts ?? [], [shiftsQuery.data]);

  const weeks = useMemo(
    () => (activeSchedule ? buildWeeks(activeSchedule.startDate, activeSchedule.endDate, locale) : []),
    [activeSchedule, locale]
  );
  const slots = useMemo(() => buildSlots(shifts), [shifts]);
  const crewFallback = t("calendar.crewMemberFallback");
  const cells = useMemo(
    () => buildCells(shifts, weeks, crewFallback),
    [shifts, weeks, crewFallback]
  );

  if (schedulesQuery.isLoading) {
    return (
      <section className="compensation-layout">
        <div className="table-skeleton">
          <div className="table-skeleton-header" />
          <div className="table-skeleton-row" />
          <div className="table-skeleton-row" />
        </div>
      </section>
    );
  }

  if (schedules.length === 0) {
    return (
      <EmptyState title={t("roster.noPublishedTitle")} description={t("roster.noPublishedDesc")} />
    );
  }

  return (
    <section className="compensation-layout roster-layout">
      <div className="schedule-grid-controls">
        <span className="form-label">{t("roster.scheduleLabel")}</span>
        <Select value={activeSchedule?.id ?? ""} onValueChange={(value) => setSelectedId(value)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {schedules.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {(s.name ?? t("roster.untitled")) +
                  ` · ${gridShortDate(s.startDate, locale)} – ${gridShortDate(s.endDate, locale)}`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <p className="settings-card-description">{t("roster.helpText")}</p>

      {shiftsQuery.isLoading ? (
        <div className="table-skeleton">
          <div className="table-skeleton-header" />
          <div className="table-skeleton-row" />
        </div>
      ) : (
        <div className="roster-weeks">
          {weeks.map((week) => {
            const slotsWithPeople = slots
              .map((slot) => ({ slot, people: cells.get(`${week.index}:${slot.key}`) }))
              .filter((entry) => entry.people && entry.people.size > 0);

            return (
              <section key={week.index} className="roster-week">
                <h3 className="roster-week-title">{week.label}</h3>
                {slotsWithPeople.length === 0 ? (
                  <p className="settings-card-description roster-empty-week">{t("roster.noOneScheduled")}</p>
                ) : (
                  slotsWithPeople.map(({ slot, people }) => (
                    <div key={slot.key} className="roster-slot">
                      <div className="roster-slot-head">
                        <span className="roster-slot-name">{slot.name}</span>
                        <span className="roster-slot-time">
                          {slot.startTime}–{slot.endTime}
                        </span>
                      </div>
                      <ul className="roster-people">
                        {[...people!.values()].map((person) => {
                          const isYou = person.employeeId === currentUserId;
                          return (
                            <li key={person.employeeId} className={`roster-person${isYou ? " is-you" : ""}`}>
                              <span className="roster-person-name">
                                {person.name}
                                {isYou ? <span className="roster-you-tag">{t("roster.youTag")}</span> : null}
                              </span>
                              <span className="roster-days" aria-hidden="true">
                                {week.rangeWeekdays.map((wd) => (
                                  <span
                                    key={wd}
                                    className={`roster-day${person.weekdays.has(wd) ? " is-on" : ""}`}
                                  >
                                    {DAY_LETTERS[wd]}
                                  </span>
                                ))}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ))
                )}
              </section>
            );
          })}
        </div>
      )}
    </section>
  );
}
