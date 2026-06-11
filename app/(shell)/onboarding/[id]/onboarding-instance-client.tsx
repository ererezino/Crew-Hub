/* eslint-disable i18next/no-literal-string -- Admin onboarding view has
   structural labels that will be extracted to i18n in a follow-up pass. */
"use client";

import { useLocale, useTranslations } from "next-intl";
import { useCallback, useMemo, useState } from "react";

import { DependencyGraph, type DependencyGraphNode } from "../../../../components/onboarding/dependency-graph";
import { EmptyState } from "../../../../components/shared/empty-state";
import { ErrorState } from "../../../../components/shared/error-state";
import { PageHeader } from "../../../../components/shared/page-header";
import { ProgressRing } from "../../../../components/shared/progress-ring";
import { StatusBadge } from "../../../../components/shared/status-badge";
import { useOnboardingInstanceDetail } from "../../../../hooks/use-onboarding";
import { formatDateTimeTooltip, formatRelativeTime } from "../../../../lib/datetime";
import { toSentenceCase } from "../../../../lib/format-labels";
import type { OnboardingTask, OnboardingTrack } from "../../../../types/onboarding";

type AppLocale = "en" | "fr";

type OnboardingInstanceClientProps = {
  instanceId: string;
};

function toneForTaskStatus(taskStatus: OnboardingTask["status"]) {
  switch (taskStatus) {
    case "pending":
      return "pending" as const;
    case "in_progress":
      return "processing" as const;
    case "completed":
      return "success" as const;
    case "blocked":
      return "error" as const;
    default:
      return "draft" as const;
  }
}

function groupTasksByCategory(tasks: readonly OnboardingTask[]): Map<string, OnboardingTask[]> {
  const groupedTasks = new Map<string, OnboardingTask[]>();

  for (const task of tasks) {
    const categoryTasks = groupedTasks.get(task.category) ?? [];
    categoryTasks.push(task);
    groupedTasks.set(task.category, categoryTasks);
  }

  return new Map([...groupedTasks.entries()].sort((a, b) => a[0].localeCompare(b[0])));
}

function OnboardingDetailsSkeleton() {
  return (
    <div className="onboarding-details-skeleton" aria-hidden="true">
      <div className="onboarding-details-skeleton-summary" />
      {Array.from({ length: 3 }, (_, index) => (
        <div
          key={`onboarding-details-skeleton-${index}`}
          className="onboarding-details-skeleton-section"
        />
      ))}
    </div>
  );
}

/* ── Track Section (admin can complete ops tasks) ── */

function unmetPrerequisiteTitles(
  task: OnboardingTask,
  allTasksById: Map<string, OnboardingTask>
): string[] {
  const prerequisites = task.dependsOnTaskIds
    .map((taskId) => allTasksById.get(taskId))
    .filter((prerequisite): prerequisite is OnboardingTask => Boolean(prerequisite));
  const unmet = prerequisites.filter((prerequisite) => prerequisite.status !== "completed");

  return (unmet.length > 0 ? unmet : prerequisites).map((prerequisite) => prerequisite.title);
}

function TaskLockIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect
        x="5"
        y="11"
        width="14"
        height="9"
        rx="2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M8 11V8a4 4 0 0 1 8 0v3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function TrackSection({
  track,
  tasks,
  allTasksById,
  instanceId,
  completingTaskId,
  onComplete,
  locale,
  t
}: {
  track: OnboardingTrack;
  tasks: OnboardingTask[];
  allTasksById: Map<string, OnboardingTask>;
  instanceId: string;
  completingTaskId: string | null;
  onComplete: (instanceId: string, taskId: string) => void;
  locale: AppLocale;
  t: ReturnType<typeof useTranslations<"onboardingInstance">>;
}) {
  const tasksByCategory = useMemo(() => groupTasksByCategory(tasks), [tasks]);
  const completedCount = tasks.filter((t) => t.status === "completed").length;
  const isOps = track === "operations";

  return (
    <section className="admin-track-section">
      <header className="admin-track-header">
        <h2 className="admin-track-title">
          {isOps ? "⚙️ Operations track" : "👤 Employee track"}
        </h2>
        <span className="admin-track-count">
          {completedCount}/{tasks.length} complete
        </span>
      </header>

      <div className="admin-track-progress-bar">
        <div
          className={`admin-track-progress-fill ${isOps ? "admin-track-progress-fill-ops" : ""}`}
          style={{
            width: tasks.length > 0 ? `${Math.round((completedCount / tasks.length) * 100)}%` : "0%"
          }}
        />
      </div>

      {[...tasksByCategory.entries()].map(([category, categoryTasks]) => (
        <article key={category} className="onboarding-category-card">
          <header className="onboarding-category-header">
            <h3 className="section-title">{category}</h3>
            <span className="pill numeric">{t("taskCount", { count: categoryTasks.length })}</span>
          </header>
          <ul className="onboarding-task-list">
            {categoryTasks.map((task) => (
              <li key={task.id} className="onboarding-task-item">
                <div className="onboarding-task-main">
                  <p className="onboarding-task-title">{task.title}</p>
                  <p className="settings-card-description">
                    {task.description ?? t("noDescription")}
                  </p>
                </div>
                <div className="onboarding-task-meta">
                  <StatusBadge tone={toneForTaskStatus(task.status)}>
                    {toSentenceCase(task.status)}
                  </StatusBadge>
                  {task.status === "blocked" && task.dependsOnTaskIds.length > 0 ? (
                    <p
                      className="onboarding-task-unlocks"
                      title={t("unlocksAfter", {
                        titles: unmetPrerequisiteTitles(task, allTasksById).join(", ")
                      })}
                    >
                      <TaskLockIcon />
                      <span>
                        {t("unlocksAfter", {
                          titles: unmetPrerequisiteTitles(task, allTasksById).join(", ")
                        })}
                      </span>
                    </p>
                  ) : null}
                  <p className="settings-card-description">
                    {t("assigned", { name: task.assignedToName })}
                  </p>
                  <p className="settings-card-description">
                    {t("due")}{" "}
                    {task.dueDate ? (
                      <time
                        dateTime={task.dueDate}
                        title={formatDateTimeTooltip(task.dueDate, locale)}
                      >
                        {formatRelativeTime(task.dueDate, locale)}
                      </time>
                    ) : (
                      "--"
                    )}
                  </p>
                  {task.completionGuidance ? (
                    <p className="settings-card-description">
                      {t("completionGuidance", { text: task.completionGuidance })}
                    </p>
                  ) : null}
                  {task.actionUrl ? (
                    <a
                      href={task.actionUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="button button-sm"
                    >
                      {task.actionLabel ?? t("openTaskAction")}
                    </a>
                  ) : null}
                  {/* Admin can complete ops-track tasks */}
                  {isOps && task.status !== "completed" && task.taskType !== "e_signature" ? (
                    <button
                      type="button"
                      className="button button-accent button-sm"
                      disabled={completingTaskId === task.id || task.status === "blocked"}
                      onClick={() => onComplete(instanceId, task.id)}
                    >
                      {completingTaskId === task.id ? t("completing") : t("markComplete")}
                    </button>
                  ) : null}
                  {task.status === "completed" ? (
                    <p className="settings-card-description">
                      {t("completedBy", { name: task.completedByName ?? "--" })}
                    </p>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </article>
      ))}
    </section>
  );
}

/* ── Main Component ── */

export function OnboardingInstanceClient({ instanceId }: OnboardingInstanceClientProps) {
  const t = useTranslations("onboardingInstance");
  const locale = useLocale() as AppLocale;
  const [completingTaskId, setCompletingTaskId] = useState<string | null>(null);

  const { detail, isLoading, errorMessage, refresh } = useOnboardingInstanceDetail(instanceId);

  const handleCompleteTask = useCallback(
    async (instId: string, taskId: string) => {
      setCompletingTaskId(taskId);
      try {
        const response = await fetch(
          `/api/v1/onboarding/instances/${instId}/tasks/${taskId}/complete`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "complete" })
          }
        );
        if (response.ok) {
          refresh();
        }
      } catch {
        // Swallow
      } finally {
        setCompletingTaskId(null);
      }
    },
    [refresh]
  );

  const employeeTasks = useMemo(
    () => (detail?.tasks ?? []).filter((t) => t.track !== "operations"),
    [detail?.tasks]
  );

  const opsTasks = useMemo(
    () => (detail?.tasks ?? []).filter((t) => t.track === "operations"),
    [detail?.tasks]
  );

  const allTasksById = useMemo(
    () => new Map((detail?.tasks ?? []).map((task) => [task.id, task])),
    [detail?.tasks]
  );

  const dependencyGraphNodes = useMemo<DependencyGraphNode[]>(
    () =>
      (detail?.tasks ?? []).map((task) => ({
        id: task.id,
        title: task.title,
        status: task.status,
        dependsOn: task.dependsOnTaskIds
      })),
    [detail?.tasks]
  );

  const hasDependencies = useMemo(
    () => (detail?.tasks ?? []).some((task) => task.dependsOnTaskIds.length > 0),
    [detail?.tasks]
  );

  if (isLoading) {
    return <OnboardingDetailsSkeleton />;
  }

  if (errorMessage || !detail) {
    return (
      <ErrorState
        title={t("unavailable")}
        message={errorMessage ?? t("unableToLoad")}
      />
    );
  }

  return (
    <>
      <PageHeader
        title={`${detail.instance.employeeName} - ${toSentenceCase(detail.instance.type)}`}
        description={t("template", { name: detail.instance.templateName })}
      />

      <section className="onboarding-instance-summary">
        <ProgressRing value={detail.instance.progressPercent} label={t("progress")} />
        <div className="onboarding-instance-summary-metrics">
          <article className="onboarding-instance-metric">
            <p className="onboarding-instance-metric-label">{t("status")}</p>
            <StatusBadge
              tone={detail.instance.status === "completed" ? "success" : "processing"}
            >
              {toSentenceCase(detail.instance.status)}
            </StatusBadge>
          </article>
          <article className="onboarding-instance-metric">
            <p className="onboarding-instance-metric-label">Employee track</p>
            <p className="onboarding-instance-metric-value numeric">
              {detail.instance.employeeTrack.percent}%
            </p>
          </article>
          <article className="onboarding-instance-metric">
            <p className="onboarding-instance-metric-label">Operations track</p>
            <p className="onboarding-instance-metric-value numeric">
              {detail.instance.operationsTrack.percent}%
            </p>
          </article>
          <article className="onboarding-instance-metric">
            <p className="onboarding-instance-metric-label">{t("taskCompletion")}</p>
            <p className="onboarding-instance-metric-value numeric">
              {detail.instance.completedTasks}/{detail.instance.totalTasks}
            </p>
          </article>
        </div>
      </section>

      {hasDependencies ? (
        <section className="onboarding-deps-section">
          <h2 className="section-title">{t("dependenciesHeading")}</h2>
          <DependencyGraph
            nodes={dependencyGraphNodes}
            labels={{
              aria: t("dependencyGraphAria"),
              independentHeading: t("independentTasks")
            }}
          />
        </section>
      ) : null}

      {detail.tasks.length === 0 ? (
        <EmptyState
          title={t("noTasks")}
          description={t("noTasksDescription")}
          ctaLabel={t("backToOnboarding")}
          ctaHref="/onboarding"
        />
      ) : (
        <div className="admin-tracks-container">
          {employeeTasks.length > 0 ? (
            <TrackSection
              track="employee"
              tasks={employeeTasks}
              allTasksById={allTasksById}
              instanceId={instanceId}
              completingTaskId={completingTaskId}
              onComplete={handleCompleteTask}
              locale={locale}
              t={t}
            />
          ) : null}
          {opsTasks.length > 0 ? (
            <TrackSection
              track="operations"
              tasks={opsTasks}
              allTasksById={allTasksById}
              instanceId={instanceId}
              completingTaskId={completingTaskId}
              onComplete={handleCompleteTask}
              locale={locale}
              t={t}
            />
          ) : null}
        </div>
      )}
    </>
  );
}
