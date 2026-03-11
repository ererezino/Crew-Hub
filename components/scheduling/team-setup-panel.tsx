"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import type { WeekendHourOption } from "../../types/scheduling";
import type { PersonRecord } from "../../types/people";

type TeamSetupType = "weekday" | "weekend_primary";

type RowDraft = {
  scheduleType: TeamSetupType;
  weekendShiftHours: WeekendHourOption;
};

type TeamSetupPanelProps = {
  members: PersonRecord[];
  isLoading: boolean;
  onMemberUpdated: (params: {
    personId: string;
    scheduleType: string;
    weekendShiftHours: string | null;
  }) => void;
  onToast: (type: "success" | "error" | "info", text: string) => void;
};

const WEEKEND_HOURS_OPTIONS: WeekendHourOption[] = ["8", "4", "3", "2"];

function normalizeTeamSetupType(
  scheduleType: string | null | undefined
): TeamSetupType {
  if (
    scheduleType === "weekend_primary" ||
    scheduleType === "weekend_rotation"
  ) {
    return "weekend_primary";
  }

  return "weekday";
}

function normalizeWeekendHours(
  weekendShiftHours: string | null | undefined
): WeekendHourOption {
  if (
    weekendShiftHours === "8" ||
    weekendShiftHours === "4" ||
    weekendShiftHours === "3" ||
    weekendShiftHours === "2"
  ) {
    return weekendShiftHours;
  }

  return "8";
}

export function TeamSetupPanel({
  members,
  isLoading,
  onMemberUpdated,
  onToast
}: TeamSetupPanelProps) {
  const t = useTranslations("scheduling");
  const tc = useTranslations("common");
  const [searchQuery, setSearchQuery] = useState("");
  const [draftsById, setDraftsById] = useState<Record<string, RowDraft>>({});
  const [savingById, setSavingById] = useState<Record<string, boolean>>({});

  const visibleMembers = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();

    const base = members.filter(
      (member) => member.status === "active" || member.status === "onboarding"
    );

    if (normalizedQuery.length === 0) {
      return base;
    }

    return base.filter((member) => {
      const nameMatch = member.fullName.toLowerCase().includes(normalizedQuery);
      const deptMatch =
        member.department?.toLowerCase().includes(normalizedQuery) ?? false;
      return nameMatch || deptMatch;
    });
  }, [members, searchQuery]);

  const resolveCurrentDraft = (member: PersonRecord): RowDraft => {
    const existing = draftsById[member.id];
    if (existing) {
      return existing;
    }

    return {
      scheduleType: normalizeTeamSetupType(member.scheduleType),
      weekendShiftHours: normalizeWeekendHours(member.weekendShiftHours)
    };
  };

  const updateDraft = (
    member: PersonRecord,
    patch: Partial<RowDraft>
  ) => {
    setDraftsById((current) => {
      const prior = current[member.id] ?? resolveCurrentDraft(member);
      return {
        ...current,
        [member.id]: {
          ...prior,
          ...patch
        }
      };
    });
  };

  const isDirty = (member: PersonRecord, draft: RowDraft): boolean => {
    const baselineType = normalizeTeamSetupType(member.scheduleType);
    const baselineHours = normalizeWeekendHours(member.weekendShiftHours);

    if (draft.scheduleType !== baselineType) {
      return true;
    }

    if (draft.scheduleType === "weekend_primary") {
      return draft.weekendShiftHours !== baselineHours;
    }

    return false;
  };

  const saveRow = async (member: PersonRecord) => {
    const draft = resolveCurrentDraft(member);
    if (!isDirty(member, draft)) {
      return;
    }

    setSavingById((current) => ({ ...current, [member.id]: true }));

    try {
      const response = await fetch(`/api/v1/scheduling/team-members/${member.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          scheduleType: draft.scheduleType,
          weekendShiftHours:
            draft.scheduleType === "weekend_primary"
              ? draft.weekendShiftHours
              : null
        })
      });

      const payload = (await response.json().catch(() => null)) as
        | {
            data?: {
              personId?: string;
              scheduleType?: string;
              weekendShiftHours?: string | null;
            };
            error?: { message?: string };
          }
        | null;

      if (!response.ok || !payload?.data?.personId) {
        throw new Error(
          payload?.error?.message ?? t("teamSetup.saveFailed")
        );
      }

      onMemberUpdated({
        personId: payload.data.personId,
        scheduleType: payload.data.scheduleType ?? "weekday",
        weekendShiftHours: payload.data.weekendShiftHours ?? null
      });

      setDraftsById((current) => {
        const next = { ...current };
        delete next[member.id];
        return next;
      });

      onToast("success", t("teamSetup.saved"));
    } catch (error) {
      onToast(
        "error",
        error instanceof Error ? error.message : t("teamSetup.saveFailed")
      );
    } finally {
      setSavingById((current) => ({ ...current, [member.id]: false }));
    }
  };

  if (isLoading) {
    return (
      <div className="table-skeleton">
        <div className="table-skeleton-header" />
        <div className="table-skeleton-row" />
        <div className="table-skeleton-row" />
        <div className="table-skeleton-row" />
      </div>
    );
  }

  return (
    <section className="schedule-team-setup">
      <header className="schedule-team-setup-header">
        <div>
          <h3 className="section-title">{t("teamSetup.title")}</h3>
          <p className="settings-card-description">
            {t("teamSetup.description")}
          </p>
        </div>
        <input
          type="text"
          className="form-input schedule-team-setup-search"
          placeholder={t("teamSetup.searchPlaceholder")}
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.currentTarget.value)}
        />
      </header>

      {visibleMembers.length === 0 ? (
        <div className="schedule-empty-state">
          <h3 className="schedule-empty-title">{t("teamSetup.emptyTitle")}</h3>
          <p className="schedule-empty-desc">{t("teamSetup.emptyBody")}</p>
        </div>
      ) : (
        <div className="schedule-team-setup-list">
          {visibleMembers.map((member) => {
            const draft = resolveCurrentDraft(member);
            const saving = Boolean(savingById[member.id]);
            const dirty = isDirty(member, draft);
            const isWeekendWorker = draft.scheduleType === "weekend_primary";

            return (
              <article key={member.id} className="schedule-team-setup-row">
                <div className="schedule-team-setup-member">
                  <h4>{member.fullName}</h4>
                  <p>{member.department ?? t("teamSetup.noDepartment")}</p>
                </div>

                <div className="schedule-team-setup-controls">
                  <div className="schedule-team-setup-type-toggle">
                    <button
                      type="button"
                      className={draft.scheduleType === "weekday" ? "active" : ""}
                      onClick={() => updateDraft(member, { scheduleType: "weekday" })}
                    >
                      {t("teamSetup.weekday")}
                    </button>
                    <button
                      type="button"
                      className={isWeekendWorker ? "active" : ""}
                      onClick={() =>
                        updateDraft(member, { scheduleType: "weekend_primary" })
                      }
                    >
                      {t("teamSetup.weekend")}
                    </button>
                  </div>

                  {isWeekendWorker ? (
                    <label className="schedule-team-setup-hours">
                      <span>{t("teamSetup.weekendHours")}</span>
                      <select
                        className="form-input"
                        value={draft.weekendShiftHours}
                        onChange={(event) =>
                          updateDraft(member, {
                            weekendShiftHours:
                              event.currentTarget.value as WeekendHourOption
                          })
                        }
                      >
                        {WEEKEND_HOURS_OPTIONS.map((hours) => (
                          <option key={hours} value={hours}>
                            {t("roster.hoursLabel", { hours })}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                </div>

                <div className="schedule-team-setup-actions">
                  <button
                    type="button"
                    className="button button-primary"
                    disabled={!dirty || saving}
                    onClick={() => {
                      void saveRow(member);
                    }}
                  >
                    {saving ? tc("saving") : tc("save")}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
