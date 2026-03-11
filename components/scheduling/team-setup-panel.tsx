"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import type { WeekendHourOption } from "../../types/scheduling";
import type { PersonRecord } from "../../types/people";

type TeamSetupType = "weekday" | "weekend";

type RowDraft = {
  scheduleType: TeamSetupType;
  weekendShiftHours: WeekendHourOption;
  alternateWeekends: boolean;
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
const CUSTOMER_SUCCESS_DEPARTMENTS = new Set([
  "customer success",
  "customer support"
]);

function isCustomerSuccessDepartment(department: string | null | undefined): boolean {
  if (!department) {
    return false;
  }

  return CUSTOMER_SUCCESS_DEPARTMENTS.has(department.trim().toLowerCase());
}

function normalizeTeamSetupType(
  scheduleType: string | null | undefined
): TeamSetupType {
  if (
    scheduleType === "weekend_primary" ||
    scheduleType === "weekend_rotation"
  ) {
    return "weekend";
  }

  return "weekday";
}

function normalizeAlternateWeekends(
  scheduleType: string | null | undefined
): boolean {
  return scheduleType === "weekend_rotation";
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
  const [otherTeamsExpanded, setOtherTeamsExpanded] = useState(false);

  const activeMembers = useMemo(() => {
    return members.filter(
      (member) => member.status === "active" || member.status === "onboarding"
    );
  }, [members]);

  const normalizedQuery = searchQuery.trim().toLowerCase();

  const visibleMembers = useMemo(() => {
    const prioritized = [...activeMembers].sort((left, right) => {
      const leftIsCustomerSuccess = isCustomerSuccessDepartment(left.department);
      const rightIsCustomerSuccess = isCustomerSuccessDepartment(right.department);

      if (leftIsCustomerSuccess !== rightIsCustomerSuccess) {
        return leftIsCustomerSuccess ? -1 : 1;
      }

      return left.fullName.localeCompare(right.fullName);
    });

    if (normalizedQuery.length === 0) {
      return prioritized;
    }

    return prioritized.filter((member) => {
      const nameMatch = member.fullName.toLowerCase().includes(normalizedQuery);
      const deptMatch =
        member.department?.toLowerCase().includes(normalizedQuery) ?? false;
      return nameMatch || deptMatch;
    });
  }, [activeMembers, normalizedQuery]);

  const { customerSuccessMembers, otherMembers } = useMemo(() => {
    const customerSuccess = visibleMembers.filter((member) =>
      isCustomerSuccessDepartment(member.department)
    );
    const others = visibleMembers.filter(
      (member) => !isCustomerSuccessDepartment(member.department)
    );

    return {
      customerSuccessMembers: customerSuccess,
      otherMembers: others
    };
  }, [visibleMembers]);

  const shouldShowOtherTeams = normalizedQuery.length > 0 || otherTeamsExpanded;

  const resolveCurrentDraft = (member: PersonRecord): RowDraft => {
    const existing = draftsById[member.id];
    if (existing) {
      return existing;
    }

    return {
      scheduleType: normalizeTeamSetupType(member.scheduleType),
      weekendShiftHours: normalizeWeekendHours(member.weekendShiftHours),
      alternateWeekends: normalizeAlternateWeekends(member.scheduleType)
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
    const baselineAlternateWeekends = normalizeAlternateWeekends(
      member.scheduleType
    );

    if (draft.scheduleType !== baselineType) {
      return true;
    }

    if (draft.scheduleType === "weekend") {
      if (draft.alternateWeekends !== baselineAlternateWeekends) {
        return true;
      }

      return draft.weekendShiftHours !== baselineHours;
    }

    return false;
  };

  const resolveScheduleTypeForApi = (
    draft: RowDraft
  ): "weekday" | "weekend_primary" | "weekend_rotation" => {
    if (draft.scheduleType === "weekday") {
      return "weekday";
    }

    return draft.alternateWeekends ? "weekend_rotation" : "weekend_primary";
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
          scheduleType: resolveScheduleTypeForApi(draft),
          weekendShiftHours:
            draft.scheduleType === "weekend"
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

  const renderMemberRow = (member: PersonRecord) => {
    const draft = resolveCurrentDraft(member);
    const saving = Boolean(savingById[member.id]);
    const dirty = isDirty(member, draft);
    const isWeekendWorker = draft.scheduleType === "weekend";

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
              onClick={() =>
                updateDraft(member, {
                  scheduleType: "weekday",
                  alternateWeekends: false
                })
              }
            >
              {t("teamSetup.weekdayCrew")}
            </button>
            <button
              type="button"
              className={isWeekendWorker ? "active" : ""}
              onClick={() =>
                updateDraft(member, { scheduleType: "weekend" })
              }
            >
              {t("teamSetup.weekendCrew")}
            </button>
          </div>

          {isWeekendWorker ? (
            <div className="schedule-team-setup-advanced">
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

              <label className="schedule-team-setup-alternate">
                <input
                  type="checkbox"
                  checked={draft.alternateWeekends}
                  onChange={(event) =>
                    updateDraft(member, {
                      alternateWeekends: event.currentTarget.checked
                    })
                  }
                />
                <span>{t("teamSetup.alternateWeekends")}</span>
              </label>
            </div>
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
          {customerSuccessMembers.length > 0 ? (
            <section className="schedule-team-setup-group">
              <div className="schedule-team-setup-group-header">
                <h4 className="schedule-team-setup-group-title">
                  {t("teamSetup.customerSuccessGroup")}
                </h4>
              </div>
              {customerSuccessMembers.map((member) => renderMemberRow(member))}
            </section>
          ) : null}

          {otherMembers.length > 0 ? (
            <section className="schedule-team-setup-group">
              <div className="schedule-team-setup-group-header">
                <h4 className="schedule-team-setup-group-title">
                  {t("teamSetup.otherTeamsGroup")}
                </h4>
                {normalizedQuery.length === 0 ? (
                  <button
                    type="button"
                    className="button button-ghost schedule-team-setup-group-toggle"
                    onClick={() => setOtherTeamsExpanded((current) => !current)}
                  >
                    {otherTeamsExpanded
                      ? t("teamSetup.hideOtherTeams")
                      : t("teamSetup.showOtherTeams", {
                          count: otherMembers.length
                        })}
                  </button>
                ) : null}
              </div>

              {shouldShowOtherTeams
                ? otherMembers.map((member) => renderMemberRow(member))
                : null}
            </section>
          ) : null}
        </div>
      )}
    </section>
  );
}
