"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { EmptyState } from "../../../components/shared/empty-state";
import { ErrorState } from "../../../components/shared/error-state";
import { FeatureBanner } from "../../../components/shared/feature-banner";
import { PageHeader } from "../../../components/shared/page-header";
import { ProgressRing } from "../../../components/shared/progress-ring";
import { RatingCircles } from "../../../components/shared/rating-circles";
import { SlidePanel } from "../../../components/shared/slide-panel";
import { StatusBadge } from "../../../components/shared/status-badge";
import { countryFlagFromCode, countryNameFromCode } from "../../../lib/countries";
import { formatDateTimeTooltip, formatRelativeTime } from "../../../lib/datetime";
import { toSentenceCase } from "../../../lib/format-labels";
import {
  labelForReviewAssignmentStatus,
  labelForReviewCycleStatus,
  toneForReviewAssignmentStatus,
  toneForReviewCycleStatus
} from "../../../lib/performance/reviews";
import { useGoals, usePerformanceOverview } from "../../../hooks/use-performance";
import { useUnsavedGuard } from "../../../hooks/use-unsaved-guard";
import { Star } from "lucide-react";
import type {
  AcknowledgeReviewResponse,
  GoalMutationResponse,
  GoalRecord,
  ReviewActionItem,
  ReviewActionItemMutationResponse,
  ReviewActionItemsResponse,
  ReviewAnswerValue,
  ReviewAnswers,
  ReviewAssignmentSummary,
  SaveReviewResponseApiResponse,
  SaveReviewResponsePayload,
  ShareReviewResponse
} from "../../../types/performance";
import { humanizeError } from "@/lib/errors";

type AppLocale = "en" | "fr";
type OverviewTab = "reviews" | "goals";
type SortDirection = "asc" | "desc";
type ToastVariant = "success" | "error" | "info";
type ToastMessage = {
  id: string;
  variant: ToastVariant;
  message: string;
};

type GoalFormValues = {
  title: string;
  description: string;
  dueDate: string;
  cycleId: string;
};

function createToastId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createEmptyAnswer(): ReviewAnswerValue {
  return {
    rating: null,
    text: null
  };
}

function initializeAnswers(assignment: ReviewAssignmentSummary | null, responseType: "self" | "manager"): ReviewAnswers {
  if (!assignment) {
    return {};
  }

  const existingAnswers =
    responseType === "self"
      ? assignment.selfResponse?.answers ?? {}
      : assignment.managerResponse?.answers ?? {};
  const initialized: ReviewAnswers = {};

  for (const section of assignment.templateSections) {
    for (const question of section.questions) {
      const answer = existingAnswers[question.id] ?? createEmptyAnswer();

      initialized[question.id] = {
        rating: answer.rating ?? null,
        text: answer.text ?? null
      };
    }
  }

  return initialized;
}

function requiredQuestionErrors(
  assignment: ReviewAssignmentSummary | null,
  answers: ReviewAnswers,
  td: (key: string, params?: Record<string, unknown>) => string
): Record<string, string> {
  if (!assignment) {
    return {};
  }

  const errors: Record<string, string> = {};

  for (const section of assignment.templateSections) {
    for (const question of section.questions) {
      if (!question.required) {
        continue;
      }

      const answer = answers[question.id];

      if (question.type === "rating") {
        const ratingValue = answer?.rating;

        if (typeof ratingValue !== "number" || ratingValue < 1 || ratingValue > 5) {
          errors[question.id] = td("sections.ratingRequired");
        }
      } else {
        const textValue = answer?.text?.trim() ?? "";

        if (!textValue) {
          errors[question.id] = td("sections.responseRequired");
        }
      }
    }
  }

  return errors;
}

function sectionScoreSummary(answers: ReviewAnswers, questionIds: string[]): string {
  const ratings = questionIds
    .map((questionId) => answers[questionId]?.rating)
    .filter((value): value is number => typeof value === "number");

  if (ratings.length === 0) {
    return "--";
  }

  const average = ratings.reduce((sum, value) => sum + value, 0) / ratings.length;
  return average.toFixed(1);
}

function labelForGoalStatus(status: string, td: (key: string, params?: Record<string, unknown>) => string): string {
  switch (status) {
    case "active":
      return td("goals.statusActive");
    case "completed":
      return td("goals.statusCompleted");
    case "cancelled":
      return td("goals.statusCancelled");
    default:
      return status;
  }
}

function toneForGoalStatus(status: string): "pending" | "success" | "error" | "draft" {
  switch (status) {
    case "active":
      return "pending";
    case "completed":
      return "success";
    case "cancelled":
      return "error";
    default:
      return "draft";
  }
}

function labelForActionItemStatus(status: ReviewActionItem["status"], td: (key: string, params?: Record<string, unknown>) => string): string {
  switch (status) {
    case "pending":
      return td("actionItems.statusPending");
    case "in_progress":
      return td("actionItems.statusInProgress");
    case "completed":
      return td("actionItems.statusCompleted");
    default:
      return td("actionItems.statusPending");
  }
}

function toneForActionItemStatus(
  status: ReviewActionItem["status"]
): "pending" | "processing" | "success" {
  switch (status) {
    case "pending":
      return "pending";
    case "in_progress":
      return "processing";
    case "completed":
      return "success";
    default:
      return "pending";
  }
}

function performanceSkeleton() {
  return (
    <section className="performance-skeleton" aria-hidden="true">
      <div className="performance-skeleton-header" />
      <div className="performance-skeleton-card" />
      <div className="performance-skeleton-form" />
      <div className="table-skeleton" />
    </section>
  );
}

function defaultGoalFormValues(): GoalFormValues {
  return {
    title: "",
    description: "",
    dueDate: "",
    cycleId: ""
  };
}

// ── Sharing helpers ──

function sharingStatusForAssignment(assignment: ReviewAssignmentSummary): "unshared" | "shared" | "acknowledged" {
  if (assignment.acknowledgedAt) return "acknowledged";
  if (assignment.sharedAt) return "shared";
  return "unshared";
}

// ── Goals Tab ──

function GoalsTab({
  activeCycleId,
  activeCycleName,
  showToast,
  refreshOverview
}: {
  activeCycleId: string | null;
  activeCycleName: string | null;
  showToast: (variant: ToastVariant, message: string) => void;
  refreshOverview: () => void;
}) {
  const t = useTranslations('performance');
  const tCommon = useTranslations('common');
  const locale = useLocale() as AppLocale;
  const td = t as (key: string, params?: Record<string, unknown>) => string;
  const [goalStatusFilter, setGoalStatusFilter] = useState<string>("active");
  const goalsQuery = useGoals({ status: goalStatusFilter });
  const goals = goalsQuery.data?.goals ?? [];
  const [goalPanelOpen, setGoalPanelOpen] = useState(false);
  const [editingGoal, setEditingGoal] = useState<GoalRecord | null>(null);
  const [goalForm, setGoalForm] = useState<GoalFormValues>(defaultGoalFormValues());
  const [isCreatingGoal, setIsCreatingGoal] = useState(false);
  const [progressEditGoalId, setProgressEditGoalId] = useState<string | null>(null);
  const [progressValue, setProgressValue] = useState(0);
  const [isSavingProgress, setIsSavingProgress] = useState(false);

  const openAddGoal = () => {
    setEditingGoal(null);
    setGoalForm({
      ...defaultGoalFormValues(),
      cycleId: activeCycleId ?? ""
    });
    setGoalPanelOpen(true);
  };

  const openEditGoal = (goal: GoalRecord) => {
    setEditingGoal(goal);
    setGoalForm({
      title: goal.title,
      description: goal.description ?? "",
      dueDate: goal.dueDate ?? "",
      cycleId: goal.cycleId ?? ""
    });
    setGoalPanelOpen(true);
  };

  const closeGoalPanel = () => {
    setGoalPanelOpen(false);
    setEditingGoal(null);
  };

  const saveGoal = async () => {
    if (!goalForm.title.trim()) {
      showToast("error", t("toast.goalTitleRequired"));
      return;
    }

    setIsCreatingGoal(true);

    try {
      if (editingGoal) {
        const response = await fetch(`/api/v1/performance/goals/${editingGoal.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: goalForm.title.trim(),
            description: goalForm.description.trim() || null,
            dueDate: goalForm.dueDate || null,
            status: editingGoal.status
          })
        });

        const body = (await response.json()) as GoalMutationResponse;

        if (!response.ok || !body.data) {
          showToast("error", body.error?.message ?? t("toast.unableToUpdateGoal"));
          return;
        }

        showToast("success", t("toast.goalUpdated"));
      } else {
        const response = await fetch("/api/v1/performance/goals", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            employeeId: "__self__",
            title: goalForm.title.trim(),
            description: goalForm.description.trim() || null,
            dueDate: goalForm.dueDate || null,
            cycleId: goalForm.cycleId || null
          })
        });

        const body = (await response.json()) as GoalMutationResponse;

        if (!response.ok || !body.data) {
          showToast("error", body.error?.message ?? t("toast.unableToCreateGoal"));
          return;
        }

        showToast("success", t("toast.goalCreated"));
      }

      closeGoalPanel();
      goalsQuery.refresh();
      refreshOverview();
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : t("toast.unableToSaveGoal"));
    } finally {
      setIsCreatingGoal(false);
    }
  };

  const updateGoalStatus = async (goal: GoalRecord, newStatus: "completed" | "cancelled") => {
    try {
      const response = await fetch(`/api/v1/performance/goals/${goal.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus })
      });

      const body = (await response.json()) as GoalMutationResponse;

      if (!response.ok || !body.data) {
        showToast("error", body.error?.message ?? t("toast.unableToUpdateGoalStatus"));
        return;
      }

      showToast("success", t("toast.goalMarkedAs", { status: newStatus }));
      goalsQuery.refresh();
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : t("toast.unableToUpdateGoal"));
    }
  };

  const startProgressEdit = (goal: GoalRecord) => {
    setProgressEditGoalId(goal.id);
    setProgressValue(goal.progressPct);
  };

  const saveProgress = async (goalId: string) => {
    setIsSavingProgress(true);

    try {
      const response = await fetch(`/api/v1/performance/goals/${goalId}/progress`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ progressPct: progressValue })
      });

      const body = (await response.json()) as GoalMutationResponse;

      if (!response.ok || !body.data) {
        showToast("error", body.error?.message ?? t("toast.unableToUpdateProgress"));
        return;
      }

      showToast("info", t("toast.progressUpdated", { value: progressValue }));
      setProgressEditGoalId(null);
      goalsQuery.refresh();
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : t("toast.unableToUpdateProgress"));
    } finally {
      setIsSavingProgress(false);
    }
  };

  return (
    <>
      <article className="settings-card">
        <div className="performance-goals-header">
          <h2 className="section-title">{t("sections.goals")}</h2>
          <div className="performance-goals-controls">
            <select
              className="form-input performance-goals-filter"
              value={goalStatusFilter}
              onChange={(event) => setGoalStatusFilter(event.currentTarget.value)}
              aria-label={t("goals.filterByStatus")}
            >
              <option value="all">{t("goals.filterAll")}</option>
              <option value="active">{t("goals.statusActive")}</option>
              <option value="completed">{t("goals.statusCompleted")}</option>
              <option value="cancelled">{t("goals.statusCancelled")}</option>
            </select>
            <button type="button" className="button button-accent" onClick={openAddGoal}>
              {t("goals.addGoal")}
            </button>
          </div>
        </div>

        {goalsQuery.isLoading ? (
          <div className="performance-skeleton-card" aria-hidden="true" />
        ) : goalsQuery.errorMessage ? (
          <ErrorState
            title={t("goals.unavailableTitle")}
            message={goalsQuery.errorMessage}
            onRetry={goalsQuery.refresh}
          />
        ) : goals.length === 0 ? (
          <EmptyState
            title={t("goals.emptyTitle")}
            description={t("goals.emptyDescription")}
            ctaLabel={t("goals.addAGoal")}
            ctaHref="/performance"
          />
        ) : (
          <div className="performance-goals-list">
            {goals.map((goal) => (
              <article key={goal.id} className="performance-goal-card">
                <div className="performance-goal-ring">
                  <ProgressRing value={goal.progressPct} label={goal.title} size={72} />
                </div>
                <div className="performance-goal-details">
                  <div className="performance-goal-title-row">
                    <h3 className="form-label">{goal.title}</h3>
                    <StatusBadge tone={toneForGoalStatus(goal.status)}>
                      {labelForGoalStatus(goal.status, td)}
                    </StatusBadge>
                  </div>
                  {goal.description ? (
                    <p className="settings-card-description">{goal.description}</p>
                  ) : null}
                  <div className="performance-goal-meta">
                    {goal.dueDate ? (
                      <span title={formatDateTimeTooltip(goal.dueDate, locale)}>
                        {t("goals.due")}: {formatRelativeTime(goal.dueDate, locale)}
                      </span>
                    ) : null}
                    {goal.cycleName ? <span>{t("goals.cycle")}: {goal.cycleName}</span> : null}
                  </div>

                  {progressEditGoalId === goal.id ? (
                    <div className="performance-goal-progress-edit">
                      <input
                        type="range"
                        min={0}
                        max={100}
                        step={5}
                        value={progressValue}
                        onChange={(event) => setProgressValue(Number(event.currentTarget.value))}
                        className="performance-progress-slider"
                        aria-label={t("goals.updateProgress")}
                      />
                      <span className="numeric">{progressValue}%</span>
                      <button
                        type="button"
                        className="button button-primary button-sm"
                        disabled={isSavingProgress}
                        onClick={() => { void saveProgress(goal.id); }}
                      >
                        {isSavingProgress ? tCommon("working") : tCommon("save")}
                      </button>
                      <button
                        type="button"
                        className="button button-subtle button-sm"
                        onClick={() => setProgressEditGoalId(null)}
                      >
                        {tCommon("cancel")}
                      </button>
                    </div>
                  ) : null}

                  <div className="performance-goal-actions">
                    {goal.status === "active" ? (
                      <>
                        <button
                          type="button"
                          className="table-row-action"
                          onClick={() => startProgressEdit(goal)}
                        >
                          {t("goals.updateProgress")}
                        </button>
                        <button
                          type="button"
                          className="table-row-action"
                          onClick={() => openEditGoal(goal)}
                        >
                          {t("actions.edit")}
                        </button>
                        <button
                          type="button"
                          className="table-row-action"
                          onClick={() => { void updateGoalStatus(goal, "completed"); }}
                        >
                          {t("goals.markComplete")}
                        </button>
                      </>
                    ) : null}
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </article>

      <SlidePanel
        isOpen={goalPanelOpen}
        title={editingGoal ? t("goals.editGoalTitle") : t("goals.addGoalTitle")}
        description={editingGoal ? t("goals.editGoalDescription") : t("goals.addGoalDescription")}
        onClose={closeGoalPanel}
      >
        <div className="slide-panel-form">
          <label className="form-field" htmlFor="goal-title">
            <span className="form-label">{t("goals.titleLabel")}</span>
            <input
              id="goal-title"
              className="form-input"
              placeholder={t("goals.titlePlaceholder")}
              value={goalForm.title}
              onChange={(event) =>
                setGoalForm((current) => ({ ...current, title: event.currentTarget.value }))
              }
            />
          </label>

          <label className="form-field" htmlFor="goal-description">
            <span className="form-label">{t("goals.descriptionLabel")}</span>
            <textarea
              id="goal-description"
              className="form-input"
              rows={3}
              placeholder={t("goals.descriptionPlaceholder")}
              value={goalForm.description}
              onChange={(event) =>
                setGoalForm((current) => ({ ...current, description: event.currentTarget.value }))
              }
            />
          </label>

          <label className="form-field" htmlFor="goal-due-date">
            <span className="form-label">{t("goals.dueDateLabel")}</span>
            <input
              id="goal-due-date"
              type="date"
              className="form-input"
              value={goalForm.dueDate}
              onChange={(event) =>
                setGoalForm((current) => ({ ...current, dueDate: event.currentTarget.value }))
              }
            />
          </label>

          {!editingGoal && activeCycleId ? (
            <label className="form-field" htmlFor="goal-cycle">
              <span className="form-label">{t("goals.linkToCycle")}</span>
              <select
                id="goal-cycle"
                className="form-input"
                value={goalForm.cycleId}
                onChange={(event) =>
                  setGoalForm((current) => ({ ...current, cycleId: event.currentTarget.value }))
                }
              >
                <option value="">{t("goals.noCycle")}</option>
                <option value={activeCycleId}>{activeCycleName ?? t("goals.activeCycle")}</option>
              </select>
            </label>
          ) : null}

          <div className="settings-actions">
            <button
              type="button"
              className="button button-accent"
              disabled={isCreatingGoal}
              onClick={() => { void saveGoal(); }}
            >
              {isCreatingGoal ? tCommon("working") : editingGoal ? t("goals.updateGoal") : t("goals.createGoal")}
            </button>
            <button type="button" className="button button-subtle" onClick={closeGoalPanel}>
              {tCommon("cancel")}
            </button>
          </div>
        </div>
      </SlidePanel>
    </>
  );
}

function ReviewActionItemsSection({
  assignment,
  allowCreate,
  showToast
}: {
  assignment: ReviewAssignmentSummary;
  allowCreate: boolean;
  showToast: (variant: ToastVariant, message: string) => void;
}) {
  const t = useTranslations('performance');
  const tCommon = useTranslations('common');
  const locale = useLocale() as AppLocale;
  const td = t as (key: string, params?: Record<string, unknown>) => string;
  const [actionItems, setActionItems] = useState<ReviewActionItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isUpdatingId, setIsUpdatingId] = useState<string | null>(null);
  const [newDescription, setNewDescription] = useState("");
  const [newDueDate, setNewDueDate] = useState("");
  const [newAssignedTo, setNewAssignedTo] = useState(assignment.employeeId);

  const loadActionItems = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const response = await fetch(`/api/v1/performance/assignments/${assignment.id}/action-items`, {
        method: "GET"
      });

      const body = (await response.json()) as ReviewActionItemsResponse;

      if (!response.ok || !body.data) {
        setErrorMessage(body.error?.message ?? t("toast.unableToLoadActionItems"));
        return;
      }

      setActionItems(body.data.actionItems);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("toast.unableToLoadActionItems"));
    } finally {
      setIsLoading(false);
    }
  }, [assignment.id]);

  useEffect(() => {
    setNewAssignedTo(assignment.employeeId);
  }, [assignment.employeeId]);

  useEffect(() => {
    void loadActionItems();
  }, [loadActionItems]);

  const openActionCount = useMemo(
    () => actionItems.filter((item) => item.status !== "completed").length,
    [actionItems]
  );

  const createActionItem = async () => {
    if (!newDescription.trim()) {
      showToast("error", t("toast.actionItemDescriptionRequired"));
      return;
    }

    setIsCreating(true);

    try {
      const response = await fetch(`/api/v1/performance/assignments/${assignment.id}/action-items`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          description: newDescription.trim(),
          dueDate: newDueDate || null,
          assignedTo: newAssignedTo || null
        })
      });

      const body = (await response.json()) as ReviewActionItemMutationResponse;

      if (!response.ok || !body.data) {
        showToast("error", body.error?.message ?? t("toast.unableToAddActionItem"));
        return;
      }

      const createdActionItem = body.data.actionItem;
      setActionItems((currentItems) => [...currentItems, createdActionItem]);
      setNewDescription("");
      setNewDueDate("");
      setNewAssignedTo(assignment.employeeId);
      showToast("success", t("toast.actionItemAdded"));
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : t("toast.unableToAddActionItem"));
    } finally {
      setIsCreating(false);
    }
  };

  const updateActionItemStatus = async (
    actionItem: ReviewActionItem,
    nextStatus: ReviewActionItem["status"]
  ) => {
    setIsUpdatingId(actionItem.id);

    try {
      const response = await fetch(`/api/v1/performance/action-items/${actionItem.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          status: nextStatus
        })
      });

      const body = (await response.json()) as ReviewActionItemMutationResponse;

      if (!response.ok || !body.data) {
        showToast("error", body.error?.message ?? t("toast.unableToUpdateActionItem"));
        return;
      }

      const updatedActionItem = body.data.actionItem;
      setActionItems((currentItems) =>
        currentItems.map((item) => (item.id === actionItem.id ? updatedActionItem : item))
      );
      showToast("info", t("toast.actionItemMarked", { status: labelForActionItemStatus(nextStatus, td).toLowerCase() }));
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : t("toast.unableToUpdateActionItem"));
    } finally {
      setIsUpdatingId(null);
    }
  };

  return (
    <section className="performance-action-items-section">
      <div className="performance-action-items-header">
        <h4 className="section-title">{t("actionItems.title")}</h4>
        <StatusBadge tone={openActionCount === 0 ? "success" : "pending"}>
          {t("actionItems.openCount", { count: openActionCount })}
        </StatusBadge>
      </div>

      {allowCreate ? (
        <div className="performance-action-items-form">
          <label className="form-field">
            <span className="form-label">{t("actionItems.label")}</span>
            <textarea
              className="form-input"
              rows={3}
              value={newDescription}
              onChange={(event) => setNewDescription(event.currentTarget.value)}
              placeholder={t("actionItems.placeholder")}
              maxLength={2000}
            />
          </label>
          <div className="performance-action-items-controls">
            <label className="form-field">
              <span className="form-label">{t("actionItems.dueDateLabel")}</span>
              <input
                className="form-input numeric"
                type="date"
                value={newDueDate}
                onChange={(event) => setNewDueDate(event.currentTarget.value)}
              />
            </label>
            <label className="form-field">
              <span className="form-label">{t("actionItems.assignToLabel")}</span>
              <select
                className="form-input"
                value={newAssignedTo}
                onChange={(event) => setNewAssignedTo(event.currentTarget.value)}
              >
                <option value={assignment.employeeId}>{assignment.employeeName}</option>
                <option value={assignment.reviewerId}>{assignment.reviewerName}</option>
              </select>
            </label>
          </div>
          <button
            type="button"
            className="button button-accent"
            disabled={isCreating}
            onClick={() => {
              void createActionItem();
            }}
          >
            {isCreating ? tCommon("working") : t("actionItems.addActionItem")}
          </button>
        </div>
      ) : null}

      {isLoading ? (
        <div className="performance-skeleton-card" aria-hidden="true" />
      ) : errorMessage ? (
        <ErrorState
          title={t("actionItems.unavailableTitle")}
          message={errorMessage}
          onRetry={() => {
            void loadActionItems();
          }}
        />
      ) : actionItems.length === 0 ? (
        <EmptyState
          title={t("actionItems.emptyTitle")}
          description={t("actionItems.emptyDescription")}
        />
      ) : (
        <ul className="performance-action-items-list">
          {actionItems.map((actionItem) => (
            <li key={actionItem.id} className="performance-action-item-card">
              <div className="performance-action-item-copy">
                <p className="form-label">{actionItem.description}</p>
                <p className="settings-card-description">
                  {t("actionItems.assignedTo")}: {actionItem.assignedToName ?? t("actionItems.unassigned")}
                </p>
                {actionItem.dueDate ? (
                  <p className="settings-card-description" title={formatDateTimeTooltip(actionItem.dueDate, locale)}>
                    {t("actionItems.due")}: {formatRelativeTime(actionItem.dueDate, locale)}
                  </p>
                ) : null}
              </div>
              <div className="performance-action-item-meta">
                <StatusBadge tone={toneForActionItemStatus(actionItem.status)}>
                  {labelForActionItemStatus(actionItem.status, td)}
                </StatusBadge>
                <div className="performance-action-item-actions">
                  {actionItem.status !== "in_progress" ? (
                    <button
                      type="button"
                      className="table-row-action"
                      disabled={isUpdatingId === actionItem.id}
                      onClick={() => {
                        void updateActionItemStatus(actionItem, "in_progress");
                      }}
                    >
                      {t("actionItems.start")}
                    </button>
                  ) : null}
                  {actionItem.status !== "completed" ? (
                    <button
                      type="button"
                      className="table-row-action"
                      disabled={isUpdatingId === actionItem.id}
                      onClick={() => {
                        void updateActionItemStatus(actionItem, "completed");
                      }}
                    >
                      {t("actionItems.complete")}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="table-row-action"
                      disabled={isUpdatingId === actionItem.id}
                      onClick={() => {
                        void updateActionItemStatus(actionItem, "pending");
                      }}
                    >
                      {t("actionItems.reopen")}
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ── Main Component ──

export function PerformanceClient({ canManagePerformance }: { canManagePerformance: boolean }) {
  const t = useTranslations('performance');
  const tCommon = useTranslations('common');
  const locale = useLocale() as AppLocale;
  const td = t as (key: string, params?: Record<string, unknown>) => string;
  const overviewQuery = usePerformanceOverview();
  const refreshOverview = overviewQuery.refresh;
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [activeTab, setActiveTab] = useState<OverviewTab>("reviews");

  const [selfAnswers, setSelfAnswers] = useState<ReviewAnswers>({});
  const [selfDirty, setSelfDirty] = useState(false);
  const [isSavingSelf, setIsSavingSelf] = useState(false);
  const [isSubmittingSelf, setIsSubmittingSelf] = useState(false);

  const [selectedManagerAssignmentId, setSelectedManagerAssignmentId] = useState<string | null>(null);
  const [managerAnswers, setManagerAnswers] = useState<ReviewAnswers>({});
  const [managerDirty, setManagerDirty] = useState(false);
  useUnsavedGuard(selfDirty || managerDirty);
  const [isSavingManager, setIsSavingManager] = useState(false);
  const [isSubmittingManager, setIsSubmittingManager] = useState(false);

  const [pastSortDirection, setPastSortDirection] = useState<SortDirection>("desc");

  const [isSharingReview, setIsSharingReview] = useState(false);
  const [isAcknowledging, setIsAcknowledging] = useState(false);

  const activeCycle = overviewQuery.data?.activeCycle ?? null;
  const selfAssignment = overviewQuery.data?.selfAssignment ?? null;
  const managerAssignments = useMemo(
    () => overviewQuery.data?.managerAssignments ?? [],
    [overviewQuery.data?.managerAssignments]
  );
  const selectedManagerAssignment = useMemo(
    () =>
      managerAssignments.find((assignment) => assignment.id === selectedManagerAssignmentId) ??
      managerAssignments[0] ??
      null,
    [managerAssignments, selectedManagerAssignmentId]
  );

  const pastAssignments = useMemo(() => {
    const rows = overviewQuery.data?.pastAssignments ?? [];

    return [...rows].sort((left, right) => {
      const comparison = left.updatedAt.localeCompare(right.updatedAt);
      return pastSortDirection === "asc" ? comparison : comparison * -1;
    });
  }, [overviewQuery.data?.pastAssignments, pastSortDirection]);

  const dismissToast = useCallback((toastId: string) => {
    setToasts((currentToasts) => currentToasts.filter((toast) => toast.id !== toastId));
  }, []);

  const showToast = useCallback((variant: ToastVariant, rawMessage: string) => {
    const message = variant === "error" ? humanizeError(rawMessage) : rawMessage;
    const toastId = createToastId();
    setToasts((currentToasts) => [...currentToasts, { id: toastId, variant, message }]);

    window.setTimeout(() => {
      dismissToast(toastId);
    }, 4000);
  }, [dismissToast]);

  useEffect(() => {
    setSelfAnswers(initializeAnswers(selfAssignment, "self"));
    setSelfDirty(false);
  }, [selfAssignment]);

  useEffect(() => {
    if (!selectedManagerAssignmentId && managerAssignments.length > 0) {
      setSelectedManagerAssignmentId(managerAssignments[0].id);
    }
  }, [managerAssignments, selectedManagerAssignmentId]);

  useEffect(() => {
    setManagerAnswers(initializeAnswers(selectedManagerAssignment, "manager"));
    setManagerDirty(false);
  }, [selectedManagerAssignment]);

  const saveResponse = useCallback(
    async ({
      assignment,
      responseType,
      answers,
      submit
    }: {
      assignment: ReviewAssignmentSummary;
      responseType: "self" | "manager";
      answers: ReviewAnswers;
      submit: boolean;
    }): Promise<boolean> => {
      const payload: SaveReviewResponsePayload = {
        assignmentId: assignment.id,
        responseType,
        answers,
        submit
      };

      const response = await fetch("/api/v1/performance/responses", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      const body = (await response.json()) as SaveReviewResponseApiResponse;

      if (!response.ok || !body.data) {
        showToast("error", body.error?.message ?? t("toast.unableToSaveResponse"));
        return false;
      }

      if (submit) {
        showToast(
          "success",
          responseType === "self"
            ? t("toast.selfReviewSubmitted")
            : t("toast.managerReviewSubmitted")
        );
      } else {
        showToast("info", t("toast.draftAutoSaved"));
      }

      refreshOverview();
      return true;
    },
    [refreshOverview, showToast]
  );

  useEffect(() => {
    if (!selfDirty || !selfAssignment || isSubmittingSelf) {
      return;
    }

    const timeoutId = window.setTimeout(async () => {
      setIsSavingSelf(true);

      try {
        const saved = await saveResponse({
          assignment: selfAssignment,
          responseType: "self",
          answers: selfAnswers,
          submit: false
        });

        if (saved) {
          setSelfDirty(false);
        }
      } finally {
        setIsSavingSelf(false);
      }
    }, 900);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [selfDirty, selfAssignment, selfAnswers, isSubmittingSelf, saveResponse]);

  useEffect(() => {
    if (!managerDirty || !selectedManagerAssignment || isSubmittingManager) {
      return;
    }

    const timeoutId = window.setTimeout(async () => {
      setIsSavingManager(true);

      try {
        const saved = await saveResponse({
          assignment: selectedManagerAssignment,
          responseType: "manager",
          answers: managerAnswers,
          submit: false
        });

        if (saved) {
          setManagerDirty(false);
        }
      } finally {
        setIsSavingManager(false);
      }
    }, 900);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [managerDirty, selectedManagerAssignment, managerAnswers, isSubmittingManager, saveResponse]);

  const selfErrors = requiredQuestionErrors(selfAssignment, selfAnswers, td);
  const managerErrors = requiredQuestionErrors(selectedManagerAssignment, managerAnswers, td);

  const submitSelfReview = async () => {
    if (!selfAssignment) {
      return;
    }

    if (Object.keys(selfErrors).length > 0) {
      showToast("error", t("toast.completeSelfReviewFields"));
      return;
    }

    setIsSubmittingSelf(true);

    try {
      const saved = await saveResponse({
        assignment: selfAssignment,
        responseType: "self",
        answers: selfAnswers,
        submit: true
      });

      if (saved) {
        setSelfDirty(false);
      }
    } finally {
      setIsSubmittingSelf(false);
    }
  };

  const submitManagerReview = async () => {
    if (!selectedManagerAssignment) {
      return;
    }

    if (Object.keys(managerErrors).length > 0) {
      showToast("error", t("toast.completeManagerReviewFields"));
      return;
    }

    setIsSubmittingManager(true);

    try {
      const saved = await saveResponse({
        assignment: selectedManagerAssignment,
        responseType: "manager",
        answers: managerAnswers,
        submit: true
      });

      if (saved) {
        setManagerDirty(false);
      }
    } finally {
      setIsSubmittingManager(false);
    }
  };

  // ── Sharing ──

  const shareReview = async (assignmentId: string) => {
    setIsSharingReview(true);

    try {
      const response = await fetch(`/api/v1/performance/assignments/${assignmentId}/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" }
      });

      const body = (await response.json()) as ShareReviewResponse;

      if (!response.ok || !body.data) {
        showToast("error", body.error?.message ?? t("toast.unableToShareReview"));
        return;
      }

      showToast("success", t("toast.reviewShared"));
      refreshOverview();
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : t("toast.unableToShareReview"));
    } finally {
      setIsSharingReview(false);
    }
  };

  // ── Acknowledgment ──

  const acknowledgeReview = async (assignmentId: string) => {
    setIsAcknowledging(true);

    try {
      const response = await fetch(`/api/v1/performance/assignments/${assignmentId}/acknowledge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" }
      });

      const body = (await response.json()) as AcknowledgeReviewResponse;

      if (!response.ok || !body.data) {
        showToast("error", body.error?.message ?? t("toast.unableToAcknowledgeReview"));
        return;
      }

      showToast("success", t("toast.reviewAcknowledged"));
      refreshOverview();
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : t("toast.unableToAcknowledgeReview"));
    } finally {
      setIsAcknowledging(false);
    }
  };

  // ── Determine if self-assignment review can be seen ──

  const selfAssignmentShared = selfAssignment ? sharingStatusForAssignment(selfAssignment) !== "unshared" : false;
  const selfAssignmentAcknowledged = selfAssignment ? sharingStatusForAssignment(selfAssignment) === "acknowledged" : false;

  return (
    <>
      <PageHeader
        title={t("pageTitle")}
        description={t("pageDescription")}
        actions={
          canManagePerformance ? (
            <Link className="button button-subtle" href="/performance/admin">
              {t("actions.performanceAdmin")}
            </Link>
          ) : null
        }
      />

      <FeatureBanner
        moduleId="performance"
        description={t("pilotBanner")}
      />

      {overviewQuery.isLoading ? performanceSkeleton() : null}

      {!overviewQuery.isLoading && overviewQuery.errorMessage ? (
        <ErrorState
          title={t("emptyState.dataUnavailable")}
          message={overviewQuery.errorMessage}
          onRetry={overviewQuery.refresh}
        />
      ) : null}

      {!overviewQuery.isLoading && !overviewQuery.errorMessage ? (
        <section className="settings-layout" aria-label={t("sections.performanceOverview")}>
          {/* ── Tab Navigation ── */}
          <section className="page-tabs" aria-label={t("sections.performanceSections")}>
            <button
              type="button"
              className={activeTab === "reviews" ? "page-tab page-tab-active" : "page-tab"}
              onClick={() => setActiveTab("reviews")}
            >
              {t("sections.reviews")}
            </button>
            <button
              type="button"
              className={activeTab === "goals" ? "page-tab page-tab-active" : "page-tab"}
              onClick={() => setActiveTab("goals")}
            >
              {t("sections.goals")}
            </button>
          </section>

          {activeTab === "goals" ? (
            <GoalsTab
              activeCycleId={activeCycle?.id ?? null}
              activeCycleName={activeCycle?.name ?? null}
              showToast={showToast}
              refreshOverview={refreshOverview}
            />
          ) : null}

          {activeTab === "reviews" ? (
            <>
              {/* ── Active Cycle ── */}
              <article className="settings-card">
                <h2 className="section-title">{t("sections.activeCycle")}</h2>
                {activeCycle ? (
                  <>
                    <div className="performance-cycle-header">
                      <div>
                        <p className="section-title">{activeCycle.name}</p>
                        <p className="settings-card-description">
                          {t("sections.reviewCycleType", { type: toSentenceCase(activeCycle.type) })}
                        </p>
                      </div>
                      <StatusBadge tone={toneForReviewCycleStatus(activeCycle.status)}>
                        {labelForReviewCycleStatus(activeCycle.status)}
                      </StatusBadge>
                    </div>
                    <div className="performance-cycle-meta">
                      <p title={formatDateTimeTooltip(activeCycle.startDate, locale)}>
                        {t("sections.start")}: <span className="numeric">{formatRelativeTime(activeCycle.startDate, locale)}</span>
                      </p>
                      <p title={formatDateTimeTooltip(activeCycle.endDate, locale)}>
                        {t("sections.end")}: <span className="numeric">{formatRelativeTime(activeCycle.endDate, locale)}</span>
                      </p>
                      <p
                        title={
                          activeCycle.selfReviewDeadline
                            ? formatDateTimeTooltip(activeCycle.selfReviewDeadline, locale)
                            : "--"
                        }
                      >
                        {t("sections.selfDeadline")}:{" "}
                        <span className="numeric">
                          {activeCycle.selfReviewDeadline
                            ? formatRelativeTime(activeCycle.selfReviewDeadline, locale)
                            : "--"}
                        </span>
                      </p>
                      <p
                        title={
                          activeCycle.managerReviewDeadline
                            ? formatDateTimeTooltip(activeCycle.managerReviewDeadline, locale)
                            : "--"
                        }
                      >
                        {t("sections.managerDeadline")}:{" "}
                        <span className="numeric">
                          {activeCycle.managerReviewDeadline
                            ? formatRelativeTime(activeCycle.managerReviewDeadline, locale)
                            : "--"}
                        </span>
                      </p>
                    </div>
                  </>
                ) : (
                  <EmptyState
                    icon={<Star size={32} />}
                    title={t("emptyState.noActiveReview")}
                    description={t("emptyState.noActiveReviewDescription")}
                    {...(canManagePerformance
                      ? { ctaLabel: t("actions.openAdmin"), ctaHref: "/performance/admin" }
                      : {})}
                  />
                )}
              </article>

              {/* ── Self Review ── */}
              <article className="settings-card">
                <div className="performance-form-header">
                  <h2 className="section-title">{t("sections.selfReview")}</h2>
                  {isSavingSelf ? (
                    <StatusBadge tone="processing">{t("status.autosaving")}</StatusBadge>
                  ) : selfDirty ? (
                    <StatusBadge tone="pending">{t("status.unsavedChanges")}</StatusBadge>
                  ) : (
                    <StatusBadge tone="draft">{t("status.saved")}</StatusBadge>
                  )}
                </div>

                {!selfAssignment ? (
                  <EmptyState
                    title={t("emptyState.noSelfReview")}
                    description={t("emptyState.noSelfReviewDescription")}
                  />
                ) : (
                  <>
                    <div className="performance-assignment-meta">
                      <p>
                        {t("sections.reviewer")}: <span>{selfAssignment.reviewerName}</span>
                      </p>
                      <p title={selfAssignment.dueAt ? formatDateTimeTooltip(selfAssignment.dueAt, locale) : "--"}>
                        {t("sections.due")}:{" "}
                        <span className="numeric">
                          {selfAssignment.dueAt ? formatRelativeTime(selfAssignment.dueAt, locale) : "--"}
                        </span>
                      </p>
                      <StatusBadge tone={toneForReviewAssignmentStatus(selfAssignment.status)}>
                        {labelForReviewAssignmentStatus(selfAssignment.status)}
                      </StatusBadge>
                    </div>

                    {selfAssignment.templateSections.map((section) => (
                      <section key={section.id} className="performance-section-card">
                        <div className="performance-section-header">
                          <div>
                            <h3 className="section-title">{section.title}</h3>
                            <p className="settings-card-description">{section.description}</p>
                          </div>
                          <p className="numeric">
                            {t("sections.avgScore")}:{" "}
                            {sectionScoreSummary(
                              selfAnswers,
                              section.questions.map((question) => question.id)
                            )}
                          </p>
                        </div>

                        <div className="performance-question-list">
                          {section.questions.map((question) => (
                            <article key={question.id} className="performance-question-card">
                              <div className="performance-question-header">
                                <p className="form-label">{question.title}</p>
                                {question.required ? (
                                  <span className="performance-required">{t("sections.required")}</span>
                                ) : (
                                  <span className="settings-card-description">{t("sections.optional")}</span>
                                )}
                              </div>
                              <p className="settings-card-description">{question.prompt}</p>

                              {question.type === "rating" ? (
                                <RatingCircles
                                  id={`self-${question.id}`}
                                  value={selfAnswers[question.id]?.rating ?? null}
                                  onChange={(ratingValue) => {
                                    setSelfAnswers((currentAnswers) => ({
                                      ...currentAnswers,
                                      [question.id]: {
                                        rating: ratingValue,
                                        text: currentAnswers[question.id]?.text ?? null
                                      }
                                    }));
                                    setSelfDirty(true);
                                  }}
                                />
                              ) : (
                                <textarea
                                  className={
                                    selfErrors[question.id]
                                      ? "form-input form-input-error"
                                      : "form-input"
                                  }
                                  rows={4}
                                  maxLength={question.maxLength ?? 4000}
                                  value={selfAnswers[question.id]?.text ?? ""}
                                  onChange={(event) => {
                                    const nextText = event.currentTarget.value;

                                    setSelfAnswers((currentAnswers) => ({
                                      ...currentAnswers,
                                      [question.id]: {
                                        rating: currentAnswers[question.id]?.rating ?? null,
                                        text: nextText
                                      }
                                    }));
                                    setSelfDirty(true);
                                  }}
                                />
                              )}

                              {selfErrors[question.id] ? (
                                <p className="form-field-error">{selfErrors[question.id]}</p>
                              ) : null}
                            </article>
                          ))}
                        </div>
                      </section>
                    ))}

                    <div className="settings-actions">
                      <button
                        type="button"
                        className="button button-accent"
                        disabled={isSubmittingSelf}
                        onClick={() => {
                          void submitSelfReview();
                        }}
                      >
                        {isSubmittingSelf ? tCommon("working") : t("actions.submitSelfReview")}
                      </button>
                    </div>

                    {/* ── Shared Review (employee side) ── */}
                    {selfAssignment.status === "completed" && selfAssignmentShared ? (
                      <section className="performance-shared-review">
                        <h3 className="section-title">{t("sections.managerReview")}</h3>
                        {selfAssignmentAcknowledged ? (
                          <StatusBadge tone="success">{t("status.acknowledged")}</StatusBadge>
                        ) : (
                          <StatusBadge tone="pending">{t("status.sharedPendingAcknowledgment")}</StatusBadge>
                        )}

                        {selfAssignment.managerResponse ? (
                          <div className="performance-shared-review-content">
                            {selfAssignment.templateSections.map((section) => (
                              <section key={`shared-mgr-${section.id}`}>
                                <p className="form-label">{section.title}</p>
                                <ul className="performance-read-list">
                                  {section.questions.map((question) => {
                                    const answer =
                                      selfAssignment.managerResponse?.answers[question.id];

                                    return (
                                      <li key={`shared-mgr-${question.id}`}>
                                        <p>{question.title}</p>
                                        {question.type === "rating" ? (
                                          <RatingCircles
                                            id={`shared-mgr-read-${question.id}`}
                                            value={answer?.rating ?? null}
                                            onChange={() => undefined}
                                            readOnly
                                          />
                                        ) : (
                                          <p className="settings-card-description">
                                            {answer?.text?.trim() || "--"}
                                          </p>
                                        )}
                                      </li>
                                    );
                                  })}
                                </ul>
                              </section>
                            ))}
                          </div>
                        ) : null}

                        {!selfAssignmentAcknowledged ? (
                          <div className="performance-acknowledge-section">
                            <p className="settings-card-description">
                              {t("actions.acknowledgeDescription")}
                            </p>
                            <button
                              type="button"
                              className="button button-primary"
                              disabled={isAcknowledging}
                              onClick={() => {
                                void acknowledgeReview(selfAssignment.id);
                              }}
                            >
                              {isAcknowledging ? tCommon("working") : t("actions.acknowledgeReview")}
                            </button>
                          </div>
                        ) : null}

                        <ReviewActionItemsSection
                          assignment={selfAssignment}
                          allowCreate={false}
                          showToast={showToast}
                        />
                      </section>
                    ) : selfAssignment.status === "completed" || selfAssignment.status === "in_review" ? (
                      !selfAssignmentShared ? (
                        <p className="settings-card-description" style={{ marginTop: "var(--space-md)" }}>
                          {t("sections.managerReviewPending")}
                        </p>
                      ) : null
                    ) : null}
                  </>
                )}
              </article>

              {/* ── Manager Reviews ── */}
              <article className="settings-card">
                <h2 className="section-title">{t("sections.managerReviews")}</h2>
                {managerAssignments.length === 0 ? (
                  <EmptyState
                    title={t("emptyState.noManagerReviews")}
                    description={t("emptyState.noManagerReviewsDescription")}
                  />
                ) : (
                  <>
                    <section className="data-table-container" aria-label={t("table.managerReviewAssignments")}>
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>{t("table.employee")}</th>
                            <th>{t("table.department")}</th>
                            <th>{t("table.country")}</th>
                            <th>{t("table.status")}</th>
                            <th>{t("table.due")}</th>
                            <th>{t("table.sharing")}</th>
                            <th className="table-action-column">{t("table.actions")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {managerAssignments.map((assignment) => {
                            const sharingStatus = sharingStatusForAssignment(assignment);

                            return (
                              <tr
                                key={assignment.id}
                                className={
                                  selectedManagerAssignmentId === assignment.id
                                    ? "data-table-row performance-row-active"
                                    : "data-table-row"
                                }
                              >
                                <td>{assignment.employeeName}</td>
                                <td>{assignment.employeeDepartment ?? "--"}</td>
                                <td>
                                  <p className="country-chip">
                                    <span>{countryFlagFromCode(assignment.employeeCountryCode)}</span>
                                    <span>{countryNameFromCode(assignment.employeeCountryCode, locale)}</span>
                                  </p>
                                </td>
                                <td>
                                  <StatusBadge tone={toneForReviewAssignmentStatus(assignment.status)}>
                                    {labelForReviewAssignmentStatus(assignment.status)}
                                  </StatusBadge>
                                </td>
                                <td title={assignment.dueAt ? formatDateTimeTooltip(assignment.dueAt, locale) : "--"}>
                                  {assignment.dueAt ? formatRelativeTime(assignment.dueAt, locale) : "--"}
                                </td>
                                <td>
                                  {assignment.status === "completed" ? (
                                    sharingStatus === "acknowledged" ? (
                                      <StatusBadge tone="success">{t("status.acknowledged")}</StatusBadge>
                                    ) : sharingStatus === "shared" ? (
                                      <StatusBadge tone="pending">{t("status.awaitingAcknowledgment")}</StatusBadge>
                                    ) : (
                                      <button
                                        type="button"
                                        className="button button-primary button-sm"
                                        disabled={isSharingReview}
                                        onClick={() => { void shareReview(assignment.id); }}
                                      >
                                        {isSharingReview ? tCommon("working") : t("actions.shareReview")}
                                      </button>
                                    )
                                  ) : (
                                    <span className="settings-card-description">--</span>
                                  )}
                                </td>
                                <td className="table-row-action-cell">
                                  <button
                                    type="button"
                                    className="table-row-action"
                                    onClick={() => setSelectedManagerAssignmentId(assignment.id)}
                                  >
                                    {selectedManagerAssignmentId === assignment.id ? t("actions.selected") : t("actions.review")}
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </section>

                    {selectedManagerAssignment ? (
                      <section className="performance-manager-grid">
                        <article className="settings-card performance-side-card">
                          <h3 className="section-title">{t("sections.selfReviewReadOnly")}</h3>
                          {selectedManagerAssignment.selfResponse ? (
                            selectedManagerAssignment.templateSections.map((section) => (
                              <section key={`${selectedManagerAssignment.id}-self-${section.id}`}>
                                <p className="form-label">{section.title}</p>
                                <ul className="performance-read-list">
                                  {section.questions.map((question) => {
                                    const answer =
                                      selectedManagerAssignment.selfResponse?.answers[question.id];

                                    return (
                                      <li key={`${selectedManagerAssignment.id}-self-${question.id}`}>
                                        <p>{question.title}</p>
                                        {question.type === "rating" ? (
                                          <RatingCircles
                                            id={`self-read-${question.id}`}
                                            value={answer?.rating ?? null}
                                            onChange={() => undefined}
                                            readOnly
                                          />
                                        ) : (
                                          <p className="settings-card-description">
                                            {answer?.text?.trim() || "--"}
                                          </p>
                                        )}
                                      </li>
                                    );
                                  })}
                                </ul>
                              </section>
                            ))
                          ) : (
                            <EmptyState
                              title={t("emptyState.selfReviewNotSubmitted")}
                              description={t("emptyState.selfReviewNotSubmittedDescription")}
                              ctaLabel={t("actions.backToTop")}
                              ctaHref="/performance"
                            />
                          )}
                        </article>

                        <article className="settings-card performance-side-card">
                          <div className="performance-form-header">
                            <h3 className="section-title">{t("sections.managerReview")}</h3>
                            {isSavingManager ? (
                              <StatusBadge tone="processing">{t("status.autosaving")}</StatusBadge>
                            ) : managerDirty ? (
                              <StatusBadge tone="pending">{t("status.unsavedChanges")}</StatusBadge>
                            ) : (
                              <StatusBadge tone="draft">{t("status.saved")}</StatusBadge>
                            )}
                          </div>

                          {selectedManagerAssignment.templateSections.map((section) => (
                            <section key={`${selectedManagerAssignment.id}-manager-${section.id}`}>
                              <div className="performance-section-header">
                                <div>
                                  <h4 className="section-title">{section.title}</h4>
                                  <p className="settings-card-description">{section.description}</p>
                                </div>
                                <p className="numeric">
                                  {t("sections.avgScore")}:{" "}
                                  {sectionScoreSummary(
                                    managerAnswers,
                                    section.questions.map((question) => question.id)
                                  )}
                                </p>
                              </div>

                              <div className="performance-question-list">
                                {section.questions.map((question) => (
                                  <article key={`${selectedManagerAssignment.id}-${question.id}`} className="performance-question-card">
                                    <div className="performance-question-header">
                                      <p className="form-label">{question.title}</p>
                                      {question.required ? (
                                        <span className="performance-required">{t("sections.required")}</span>
                                      ) : (
                                        <span className="settings-card-description">{t("sections.optional")}</span>
                                      )}
                                    </div>
                                    <p className="settings-card-description">{question.prompt}</p>

                                    {question.type === "rating" ? (
                                      <RatingCircles
                                        id={`manager-${question.id}`}
                                        value={managerAnswers[question.id]?.rating ?? null}
                                        onChange={(ratingValue) => {
                                          setManagerAnswers((currentAnswers) => ({
                                            ...currentAnswers,
                                            [question.id]: {
                                              rating: ratingValue,
                                              text: currentAnswers[question.id]?.text ?? null
                                            }
                                          }));
                                          setManagerDirty(true);
                                        }}
                                      />
                                    ) : (
                                      <textarea
                                        className={
                                          managerErrors[question.id]
                                            ? "form-input form-input-error"
                                            : "form-input"
                                        }
                                        rows={4}
                                        maxLength={question.maxLength ?? 4000}
                                        value={managerAnswers[question.id]?.text ?? ""}
                                        onChange={(event) => {
                                          const nextText = event.currentTarget.value;

                                          setManagerAnswers((currentAnswers) => ({
                                            ...currentAnswers,
                                            [question.id]: {
                                              rating: currentAnswers[question.id]?.rating ?? null,
                                              text: nextText
                                            }
                                          }));
                                          setManagerDirty(true);
                                        }}
                                      />
                                    )}

                                    {managerErrors[question.id] ? (
                                      <p className="form-field-error">{managerErrors[question.id]}</p>
                                    ) : null}
                                  </article>
                                ))}
                              </div>
                            </section>
                          ))}

                          <div className="settings-actions">
                            <button
                              type="button"
                              className="button button-accent"
                              disabled={isSubmittingManager}
                              onClick={() => {
                                void submitManagerReview();
                              }}
                            >
                              {isSubmittingManager ? tCommon("working") : t("actions.submitManagerReview")}
                            </button>
                          </div>

                          <ReviewActionItemsSection
                            assignment={selectedManagerAssignment}
                            allowCreate
                            showToast={showToast}
                          />
                        </article>
                      </section>
                    ) : null}
                  </>
                )}
              </article>

              {/* ── Past Reviews ── */}
              <article className="settings-card">
                <h2 className="section-title">{t("sections.pastReviews")}</h2>
                <section className="data-table-container" aria-label={t("table.pastPerformanceReviews")}>
                  {pastAssignments.length === 0 ? (
                    <EmptyState
                      title={t("emptyState.noCompletedReviews")}
                      description={t("emptyState.noCompletedReviewsDescription")}
                    />
                  ) : (
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>
                            <button
                              type="button"
                              className="table-sort-trigger"
                              onClick={() =>
                                setPastSortDirection((current) => (current === "asc" ? "desc" : "asc"))
                              }
                            >
                              {t("table.cycle")}
                              <span className="numeric">{pastSortDirection === "asc" ? "\u2191" : "\u2193"}</span>
                            </button>
                          </th>
                          <th>{t("table.reviewer")}</th>
                          <th>{t("table.status")}</th>
                          <th>{t("table.sharing")}</th>
                          <th>{t("table.updated")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pastAssignments.map((assignment) => {
                          const sharingStatus = sharingStatusForAssignment(assignment);

                          return (
                            <tr key={`past-${assignment.id}`} className="data-table-row">
                              <td>{assignment.cycleName}</td>
                              <td>{assignment.reviewerName}</td>
                              <td>
                                <StatusBadge tone={toneForReviewAssignmentStatus(assignment.status)}>
                                  {labelForReviewAssignmentStatus(assignment.status)}
                                </StatusBadge>
                              </td>
                              <td>
                                {sharingStatus === "acknowledged" ? (
                                  <StatusBadge tone="success">{t("status.acknowledged")}</StatusBadge>
                                ) : sharingStatus === "shared" ? (
                                  <StatusBadge tone="pending">{t("status.shared")}</StatusBadge>
                                ) : (
                                  <span className="settings-card-description">{t("status.notShared")}</span>
                                )}
                              </td>
                              <td title={formatDateTimeTooltip(assignment.updatedAt, locale)}>
                                {formatRelativeTime(assignment.updatedAt, locale)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </section>
              </article>
            </>
          ) : null}
        </section>
      ) : null}

      {toasts.length > 0 ? (
        <section className="toast-region" aria-live="polite" aria-label={t("toast.region")}>
          {toasts.map((toast) => (
            <article key={toast.id} className={`toast-message toast-message-${toast.variant}`}>
              <p>{toast.message}</p>
              <button
                type="button"
                className="toast-dismiss"
                onClick={() => dismissToast(toast.id)}
                aria-label={t("dismissNotification")}
              >
                {tCommon("close")}
              </button>
            </article>
          ))}
        </section>
      ) : null}
    </>
  );
}
