"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

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
  answers: ReviewAnswers
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
          errors[question.id] = "Rating is required.";
        }
      } else {
        const textValue = answer?.text?.trim() ?? "";

        if (!textValue) {
          errors[question.id] = "Response is required.";
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

function labelForGoalStatus(status: string): string {
  switch (status) {
    case "active":
      return "Active";
    case "completed":
      return "Completed";
    case "cancelled":
      return "Cancelled";
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

function labelForActionItemStatus(status: ReviewActionItem["status"]): string {
  switch (status) {
    case "pending":
      return "Pending";
    case "in_progress":
      return "In Progress";
    case "completed":
      return "Completed";
    default:
      return "Pending";
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
      showToast("error", "Goal title is required.");
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
          showToast("error", body.error?.message ?? "Unable to update goal.");
          return;
        }

        showToast("success", "Goal updated.");
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
          showToast("error", body.error?.message ?? "Unable to create goal.");
          return;
        }

        showToast("success", "Goal created.");
      }

      closeGoalPanel();
      goalsQuery.refresh();
      refreshOverview();
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : "Unable to save goal.");
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
        showToast("error", body.error?.message ?? "Unable to update goal status.");
        return;
      }

      showToast("success", `Goal marked as ${newStatus}.`);
      goalsQuery.refresh();
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : "Unable to update goal.");
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
        showToast("error", body.error?.message ?? "Unable to update progress.");
        return;
      }

      showToast("info", `Progress updated to ${progressValue}%.`);
      setProgressEditGoalId(null);
      goalsQuery.refresh();
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : "Unable to update progress.");
    } finally {
      setIsSavingProgress(false);
    }
  };

  return (
    <>
      <article className="settings-card">
        <div className="performance-goals-header">
          <h2 className="section-title">Goals</h2>
          <div className="performance-goals-controls">
            <select
              className="form-input performance-goals-filter"
              value={goalStatusFilter}
              onChange={(event) => setGoalStatusFilter(event.currentTarget.value)}
              aria-label="Filter goals by status"
            >
              <option value="all">All</option>
              <option value="active">Active</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </select>
            <button type="button" className="button button-accent" onClick={openAddGoal}>
              Add goal
            </button>
          </div>
        </div>

        {goalsQuery.isLoading ? (
          <div className="performance-skeleton-card" aria-hidden="true" />
        ) : goalsQuery.errorMessage ? (
          <ErrorState
            title="Goals unavailable"
            message={goalsQuery.errorMessage}
            onRetry={goalsQuery.refresh}
          />
        ) : goals.length === 0 ? (
          <EmptyState
            title="No goals yet"
            description="Set goals to track your progress through the review cycle."
            ctaLabel="Add a goal"
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
                      {labelForGoalStatus(goal.status)}
                    </StatusBadge>
                  </div>
                  {goal.description ? (
                    <p className="settings-card-description">{goal.description}</p>
                  ) : null}
                  <div className="performance-goal-meta">
                    {goal.dueDate ? (
                      <span title={formatDateTimeTooltip(goal.dueDate)}>
                        Due: {formatRelativeTime(goal.dueDate)}
                      </span>
                    ) : null}
                    {goal.cycleName ? <span>Cycle: {goal.cycleName}</span> : null}
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
                        aria-label="Update progress"
                      />
                      <span className="numeric">{progressValue}%</span>
                      <button
                        type="button"
                        className="button button-primary button-sm"
                        disabled={isSavingProgress}
                        onClick={() => { void saveProgress(goal.id); }}
                      >
                        {isSavingProgress ? "Saving..." : "Save"}
                      </button>
                      <button
                        type="button"
                        className="button button-subtle button-sm"
                        onClick={() => setProgressEditGoalId(null)}
                      >
                        Cancel
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
                          Update progress
                        </button>
                        <button
                          type="button"
                          className="table-row-action"
                          onClick={() => openEditGoal(goal)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="table-row-action"
                          onClick={() => { void updateGoalStatus(goal, "completed"); }}
                        >
                          Mark complete
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
        title={editingGoal ? "Edit Goal" : "Add Goal"}
        description={editingGoal ? "Update your goal details." : "Create a new goal to track your progress."}
        onClose={closeGoalPanel}
      >
        <div className="slide-panel-form">
          <label className="form-field" htmlFor="goal-title">
            <span className="form-label">Title</span>
            <input
              id="goal-title"
              className="form-input"
              placeholder="e.g. Complete Q1 deliverables"
              value={goalForm.title}
              onChange={(event) =>
                setGoalForm((current) => ({ ...current, title: event.currentTarget.value }))
              }
            />
          </label>

          <label className="form-field" htmlFor="goal-description">
            <span className="form-label">Description</span>
            <textarea
              id="goal-description"
              className="form-input"
              rows={3}
              placeholder="Optional. Describe what success looks like."
              value={goalForm.description}
              onChange={(event) =>
                setGoalForm((current) => ({ ...current, description: event.currentTarget.value }))
              }
            />
          </label>

          <label className="form-field" htmlFor="goal-due-date">
            <span className="form-label">Due date</span>
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
              <span className="form-label">Link to cycle</span>
              <select
                id="goal-cycle"
                className="form-input"
                value={goalForm.cycleId}
                onChange={(event) =>
                  setGoalForm((current) => ({ ...current, cycleId: event.currentTarget.value }))
                }
              >
                <option value="">No cycle</option>
                <option value={activeCycleId}>{activeCycleName ?? "Active cycle"}</option>
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
              {isCreatingGoal ? "Saving..." : editingGoal ? "Update goal" : "Create goal"}
            </button>
            <button type="button" className="button button-subtle" onClick={closeGoalPanel}>
              Cancel
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
        setErrorMessage(body.error?.message ?? "Unable to load post-review action items.");
        return;
      }

      setActionItems(body.data.actionItems);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to load post-review action items.");
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
      showToast("error", "Action item description is required.");
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
        showToast("error", body.error?.message ?? "Unable to add action item.");
        return;
      }

      const createdActionItem = body.data.actionItem;
      setActionItems((currentItems) => [...currentItems, createdActionItem]);
      setNewDescription("");
      setNewDueDate("");
      setNewAssignedTo(assignment.employeeId);
      showToast("success", "Post-review action item added.");
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : "Unable to add action item.");
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
        showToast("error", body.error?.message ?? "Unable to update action item.");
        return;
      }

      const updatedActionItem = body.data.actionItem;
      setActionItems((currentItems) =>
        currentItems.map((item) => (item.id === actionItem.id ? updatedActionItem : item))
      );
      showToast("info", `Action item marked ${labelForActionItemStatus(nextStatus).toLowerCase()}.`);
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : "Unable to update action item.");
    } finally {
      setIsUpdatingId(null);
    }
  };

  return (
    <section className="performance-action-items-section">
      <div className="performance-action-items-header">
        <h4 className="section-title">Post-Review Actions</h4>
        <StatusBadge tone={openActionCount === 0 ? "success" : "pending"}>
          {openActionCount} open
        </StatusBadge>
      </div>

      {allowCreate ? (
        <div className="performance-action-items-form">
          <label className="form-field">
            <span className="form-label">Action item</span>
            <textarea
              className="form-input"
              rows={3}
              value={newDescription}
              onChange={(event) => setNewDescription(event.currentTarget.value)}
              placeholder="Define a concrete next step from this review conversation."
              maxLength={2000}
            />
          </label>
          <div className="performance-action-items-controls">
            <label className="form-field">
              <span className="form-label">Due date</span>
              <input
                className="form-input numeric"
                type="date"
                value={newDueDate}
                onChange={(event) => setNewDueDate(event.currentTarget.value)}
              />
            </label>
            <label className="form-field">
              <span className="form-label">Assign to</span>
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
            {isCreating ? "Adding..." : "Add action item"}
          </button>
        </div>
      ) : null}

      {isLoading ? (
        <div className="performance-skeleton-card" aria-hidden="true" />
      ) : errorMessage ? (
        <ErrorState
          title="Action items unavailable"
          message={errorMessage}
          onRetry={() => {
            void loadActionItems();
          }}
        />
      ) : actionItems.length === 0 ? (
        <EmptyState
          title="No action items yet"
          description="Action items from review conversations will appear here."
        />
      ) : (
        <ul className="performance-action-items-list">
          {actionItems.map((actionItem) => (
            <li key={actionItem.id} className="performance-action-item-card">
              <div className="performance-action-item-copy">
                <p className="form-label">{actionItem.description}</p>
                <p className="settings-card-description">
                  Assigned to: {actionItem.assignedToName ?? "Unassigned"}
                </p>
                {actionItem.dueDate ? (
                  <p className="settings-card-description" title={formatDateTimeTooltip(actionItem.dueDate)}>
                    Due: {formatRelativeTime(actionItem.dueDate)}
                  </p>
                ) : null}
              </div>
              <div className="performance-action-item-meta">
                <StatusBadge tone={toneForActionItemStatus(actionItem.status)}>
                  {labelForActionItemStatus(actionItem.status)}
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
                      Start
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
                      Complete
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
                      Reopen
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
        showToast("error", body.error?.message ?? "Unable to save review response.");
        return false;
      }

      if (submit) {
        showToast(
          "success",
          responseType === "self"
            ? "Self review submitted."
            : "Manager review submitted."
        );
      } else {
        showToast("info", "Draft auto-saved.");
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

  const selfErrors = requiredQuestionErrors(selfAssignment, selfAnswers);
  const managerErrors = requiredQuestionErrors(selectedManagerAssignment, managerAnswers);

  const submitSelfReview = async () => {
    if (!selfAssignment) {
      return;
    }

    if (Object.keys(selfErrors).length > 0) {
      showToast("error", "Complete all required self review fields before submitting.");
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
      showToast("error", "Complete all required manager review fields before submitting.");
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
        showToast("error", body.error?.message ?? "Unable to share review.");
        return;
      }

      showToast("success", "Review shared successfully.");
      refreshOverview();
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : "Unable to share review.");
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
        showToast("error", body.error?.message ?? "Unable to acknowledge review.");
        return;
      }

      showToast("success", "Review acknowledged.");
      refreshOverview();
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : "Unable to acknowledge review.");
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
        title="Performance"
        description="Run review cycles, track completion, and calibrate fairly."
        actions={
          canManagePerformance ? (
            <Link className="button button-subtle" href="/performance/admin">
              Performance admin
            </Link>
          ) : null
        }
      />

      <FeatureBanner
        moduleId="performance"
        description="Performance is in limited pilot. Review cycles, ratings, and calibration are available for testing"
      />

      {overviewQuery.isLoading ? performanceSkeleton() : null}

      {!overviewQuery.isLoading && overviewQuery.errorMessage ? (
        <ErrorState
          title="Performance data unavailable"
          message={overviewQuery.errorMessage}
          onRetry={overviewQuery.refresh}
        />
      ) : null}

      {!overviewQuery.isLoading && !overviewQuery.errorMessage ? (
        <section className="settings-layout" aria-label="Performance overview">
          {/* ── Tab Navigation ── */}
          <section className="page-tabs" aria-label="Performance sections">
            <button
              type="button"
              className={activeTab === "reviews" ? "page-tab page-tab-active" : "page-tab"}
              onClick={() => setActiveTab("reviews")}
            >
              Reviews
            </button>
            <button
              type="button"
              className={activeTab === "goals" ? "page-tab page-tab-active" : "page-tab"}
              onClick={() => setActiveTab("goals")}
            >
              Goals
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
                <h2 className="section-title">Active Cycle</h2>
                {activeCycle ? (
                  <>
                    <div className="performance-cycle-header">
                      <div>
                        <p className="section-title">{activeCycle.name}</p>
                        <p className="settings-card-description">
                          {toSentenceCase(activeCycle.type)} review cycle
                        </p>
                      </div>
                      <StatusBadge tone={toneForReviewCycleStatus(activeCycle.status)}>
                        {labelForReviewCycleStatus(activeCycle.status)}
                      </StatusBadge>
                    </div>
                    <div className="performance-cycle-meta">
                      <p title={formatDateTimeTooltip(activeCycle.startDate)}>
                        Start: <span className="numeric">{formatRelativeTime(activeCycle.startDate)}</span>
                      </p>
                      <p title={formatDateTimeTooltip(activeCycle.endDate)}>
                        End: <span className="numeric">{formatRelativeTime(activeCycle.endDate)}</span>
                      </p>
                      <p
                        title={
                          activeCycle.selfReviewDeadline
                            ? formatDateTimeTooltip(activeCycle.selfReviewDeadline)
                            : "--"
                        }
                      >
                        Self deadline:{" "}
                        <span className="numeric">
                          {activeCycle.selfReviewDeadline
                            ? formatRelativeTime(activeCycle.selfReviewDeadline)
                            : "--"}
                        </span>
                      </p>
                      <p
                        title={
                          activeCycle.managerReviewDeadline
                            ? formatDateTimeTooltip(activeCycle.managerReviewDeadline)
                            : "--"
                        }
                      >
                        Manager deadline:{" "}
                        <span className="numeric">
                          {activeCycle.managerReviewDeadline
                            ? formatRelativeTime(activeCycle.managerReviewDeadline)
                            : "--"}
                        </span>
                      </p>
                    </div>
                  </>
                ) : (
                  <EmptyState
                    icon={<Star size={32} />}
                    title="No active review"
                    description="There is no active review cycle right now. You will be notified when one starts."
                    {...(canManagePerformance
                      ? { ctaLabel: "Open admin", ctaHref: "/performance/admin" }
                      : {})}
                  />
                )}
              </article>

              {/* ── Self Review ── */}
              <article className="settings-card">
                <div className="performance-form-header">
                  <h2 className="section-title">Self Review</h2>
                  {isSavingSelf ? (
                    <StatusBadge tone="processing">Autosaving...</StatusBadge>
                  ) : selfDirty ? (
                    <StatusBadge tone="pending">Unsaved changes</StatusBadge>
                  ) : (
                    <StatusBadge tone="draft">Saved</StatusBadge>
                  )}
                </div>

                {!selfAssignment ? (
                  <EmptyState
                    title="No self review assigned"
                    description="You do not have an active self review assignment right now."
                  />
                ) : (
                  <>
                    <div className="performance-assignment-meta">
                      <p>
                        Reviewer: <span>{selfAssignment.reviewerName}</span>
                      </p>
                      <p title={selfAssignment.dueAt ? formatDateTimeTooltip(selfAssignment.dueAt) : "--"}>
                        Due:{" "}
                        <span className="numeric">
                          {selfAssignment.dueAt ? formatRelativeTime(selfAssignment.dueAt) : "--"}
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
                            Avg score:{" "}
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
                                  <span className="performance-required">Required</span>
                                ) : (
                                  <span className="settings-card-description">Optional</span>
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
                        {isSubmittingSelf ? "Submitting..." : "Submit self review"}
                      </button>
                    </div>

                    {/* ── Shared Review (employee side) ── */}
                    {selfAssignment.status === "completed" && selfAssignmentShared ? (
                      <section className="performance-shared-review">
                        <h3 className="section-title">Manager Review</h3>
                        {selfAssignmentAcknowledged ? (
                          <StatusBadge tone="success">Acknowledged</StatusBadge>
                        ) : (
                          <StatusBadge tone="pending">Shared, pending acknowledgment</StatusBadge>
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
                              By acknowledging, you confirm you have read this review.
                            </p>
                            <button
                              type="button"
                              className="button button-primary"
                              disabled={isAcknowledging}
                              onClick={() => {
                                void acknowledgeReview(selfAssignment.id);
                              }}
                            >
                              {isAcknowledging ? "Acknowledging..." : "Acknowledge review"}
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
                          Your manager review is pending and will be visible once shared.
                        </p>
                      ) : null
                    ) : null}
                  </>
                )}
              </article>

              {/* ── Manager Reviews ── */}
              <article className="settings-card">
                <h2 className="section-title">Manager Reviews</h2>
                {managerAssignments.length === 0 ? (
                  <EmptyState
                    title="No manager reviews assigned"
                    description="You currently have no direct report reviews assigned in active cycles."
                  />
                ) : (
                  <>
                    <section className="data-table-container" aria-label="Manager review assignments">
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>Employee</th>
                            <th>Department</th>
                            <th>Country</th>
                            <th>Status</th>
                            <th>Due</th>
                            <th>Sharing</th>
                            <th className="table-action-column">Actions</th>
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
                                    <span>{countryNameFromCode(assignment.employeeCountryCode)}</span>
                                  </p>
                                </td>
                                <td>
                                  <StatusBadge tone={toneForReviewAssignmentStatus(assignment.status)}>
                                    {labelForReviewAssignmentStatus(assignment.status)}
                                  </StatusBadge>
                                </td>
                                <td title={assignment.dueAt ? formatDateTimeTooltip(assignment.dueAt) : "--"}>
                                  {assignment.dueAt ? formatRelativeTime(assignment.dueAt) : "--"}
                                </td>
                                <td>
                                  {assignment.status === "completed" ? (
                                    sharingStatus === "acknowledged" ? (
                                      <StatusBadge tone="success">Acknowledged</StatusBadge>
                                    ) : sharingStatus === "shared" ? (
                                      <StatusBadge tone="pending">Awaiting acknowledgment</StatusBadge>
                                    ) : (
                                      <button
                                        type="button"
                                        className="button button-primary button-sm"
                                        disabled={isSharingReview}
                                        onClick={() => { void shareReview(assignment.id); }}
                                      >
                                        {isSharingReview ? "Sharing..." : "Share review"}
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
                                    {selectedManagerAssignmentId === assignment.id ? "Selected" : "Review"}
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
                          <h3 className="section-title">Self Review (Read-only)</h3>
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
                              title="Self review not submitted"
                              description="This crew member has not submitted their self review yet."
                              ctaLabel="Back to top"
                              ctaHref="/performance"
                            />
                          )}
                        </article>

                        <article className="settings-card performance-side-card">
                          <div className="performance-form-header">
                            <h3 className="section-title">Manager Review</h3>
                            {isSavingManager ? (
                              <StatusBadge tone="processing">Autosaving...</StatusBadge>
                            ) : managerDirty ? (
                              <StatusBadge tone="pending">Unsaved changes</StatusBadge>
                            ) : (
                              <StatusBadge tone="draft">Saved</StatusBadge>
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
                                  Avg score:{" "}
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
                                        <span className="performance-required">Required</span>
                                      ) : (
                                        <span className="settings-card-description">Optional</span>
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
                              {isSubmittingManager ? "Submitting..." : "Submit manager review"}
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
                <h2 className="section-title">Past Reviews</h2>
                <section className="data-table-container" aria-label="Past performance reviews">
                  {pastAssignments.length === 0 ? (
                    <EmptyState
                      title="No completed reviews yet"
                      description="Completed review cycles will appear here."
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
                              Cycle
                              <span className="numeric">{pastSortDirection === "asc" ? "\u2191" : "\u2193"}</span>
                            </button>
                          </th>
                          <th>Reviewer</th>
                          <th>Status</th>
                          <th>Sharing</th>
                          <th>Updated</th>
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
                                  <StatusBadge tone="success">Acknowledged</StatusBadge>
                                ) : sharingStatus === "shared" ? (
                                  <StatusBadge tone="pending">Shared</StatusBadge>
                                ) : (
                                  <span className="settings-card-description">Not shared</span>
                                )}
                              </td>
                              <td title={formatDateTimeTooltip(assignment.updatedAt)}>
                                {formatRelativeTime(assignment.updatedAt)}
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
        <section className="toast-region" aria-live="polite" aria-label="Performance toasts">
          {toasts.map((toast) => (
            <article key={toast.id} className={`toast-message toast-message-${toast.variant}`}>
              <p>{toast.message}</p>
              <button
                type="button"
                className="toast-dismiss"
                onClick={() => dismissToast(toast.id)}
                aria-label="Dismiss toast"
              >
                Dismiss
              </button>
            </article>
          ))}
        </section>
      ) : null}
    </>
  );
}
