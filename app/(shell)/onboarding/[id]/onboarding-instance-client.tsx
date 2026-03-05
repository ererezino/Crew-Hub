"use client";

import { useMemo } from "react";

import { EmptyState } from "../../../../components/shared/empty-state";
import { ErrorState } from "../../../../components/shared/error-state";
import { PageHeader } from "../../../../components/shared/page-header";
import { ProgressRing } from "../../../../components/shared/progress-ring";
import { StatusBadge } from "../../../../components/shared/status-badge";
import { useOnboardingInstanceDetail } from "../../../../hooks/use-onboarding";
import { formatDateTimeTooltip, formatRelativeTime } from "../../../../lib/datetime";
import { toSentenceCase } from "../../../../lib/format-labels";
import type { OnboardingTask } from "../../../../types/onboarding";

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

  return new Map([...groupedTasks.entries()].sort((leftEntry, rightEntry) =>
    leftEntry[0].localeCompare(rightEntry[0])
  ));
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

export function OnboardingInstanceClient({ instanceId }: OnboardingInstanceClientProps) {
  const { detail, isLoading, errorMessage } = useOnboardingInstanceDetail(instanceId);

  const tasksByCategory = useMemo(
    () => groupTasksByCategory(detail?.tasks ?? []),
    [detail?.tasks]
  );

  if (isLoading) {
    return <OnboardingDetailsSkeleton />;
  }

  if (errorMessage || !detail) {
    return (
      <ErrorState
        title="Onboarding instance is unavailable"
        message={errorMessage ?? "Unable to load onboarding instance."}
      />
    );
  }

  return (
    <>
      <PageHeader
        title={`${detail.instance.employeeName} - ${toSentenceCase(detail.instance.type)}`}
        description={`Template: ${detail.instance.templateName}`}
      />

      <section className="onboarding-instance-summary">
        <ProgressRing value={detail.instance.progressPercent} label="Progress" />
        <div className="onboarding-instance-summary-metrics">
          <article className="onboarding-instance-metric">
            <p className="onboarding-instance-metric-label">Status</p>
            <StatusBadge
              tone={detail.instance.status === "completed" ? "success" : "processing"}
            >
              {toSentenceCase(detail.instance.status)}
            </StatusBadge>
          </article>
          <article className="onboarding-instance-metric">
            <p className="onboarding-instance-metric-label">Started</p>
            <p className="onboarding-instance-metric-value">
              <time
                dateTime={detail.instance.startedAt}
                title={formatDateTimeTooltip(detail.instance.startedAt)}
              >
                {formatRelativeTime(detail.instance.startedAt)}
              </time>
            </p>
          </article>
          <article className="onboarding-instance-metric">
            <p className="onboarding-instance-metric-label">Completed</p>
            <p className="onboarding-instance-metric-value">
              {detail.instance.completedAt ? (
                <time
                  dateTime={detail.instance.completedAt}
                  title={formatDateTimeTooltip(detail.instance.completedAt)}
                >
                  {formatRelativeTime(detail.instance.completedAt)}
                </time>
              ) : (
                "--"
              )}
            </p>
          </article>
          <article className="onboarding-instance-metric">
            <p className="onboarding-instance-metric-label">Task completion</p>
            <p className="onboarding-instance-metric-value numeric">
              {detail.instance.completedTasks}/{detail.instance.totalTasks}
            </p>
          </article>
        </div>
      </section>

      {tasksByCategory.size === 0 ? (
        <EmptyState
          title="No onboarding tasks found"
          description="Tasks will appear here once assigned to this onboarding instance."
          ctaLabel="Back to onboarding"
          ctaHref="/onboarding"
        />
      ) : (
        <section className="onboarding-category-grid">
          {[...tasksByCategory.entries()].map(([category, tasks]) => (
            <article key={category} className="onboarding-category-card">
              <header className="onboarding-category-header">
                <h2 className="section-title">{category}</h2>
                <span className="pill numeric">{tasks.length} tasks</span>
              </header>
              <ul className="onboarding-task-list">
                {tasks.map((task) => (
                  <li key={task.id} className="onboarding-task-item">
                    <div className="onboarding-task-main">
                      <p className="onboarding-task-title">{task.title}</p>
                      <p className="settings-card-description">
                        {task.description ?? "No description"}
                      </p>
                    </div>
                    <div className="onboarding-task-meta">
                      <StatusBadge tone={toneForTaskStatus(task.status)}>{toSentenceCase(task.status)}</StatusBadge>
                      <p className="settings-card-description">Assigned: {task.assignedToName}</p>
                      <p className="settings-card-description">
                        Due:{" "}
                        {task.dueDate ? (
                          <time dateTime={task.dueDate} title={formatDateTimeTooltip(task.dueDate)}>
                            {formatRelativeTime(task.dueDate)}
                          </time>
                        ) : (
                          "--"
                        )}
                      </p>
                      <p className="settings-card-description">
                        Completed by: {task.completedByName ?? "--"}
                      </p>
                      <p className="settings-card-description">{task.notes ?? "No notes"}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </section>
      )}
    </>
  );
}
