"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { EmptyState } from "../../../../components/shared/empty-state";
import { ErrorState } from "../../../../components/shared/error-state";
import { PageHeader } from "../../../../components/shared/page-header";
import { ProgressRing } from "../../../../components/shared/progress-ring";
import { StatusBadge } from "../../../../components/shared/status-badge";
import { useOnboardingInstanceDetail, useOnboardingInstances } from "../../../../hooks/use-onboarding";
import { formatDateTimeTooltip, formatRelativeTime } from "../../../../lib/datetime";
import { toSentenceCase } from "../../../../lib/format-labels";
import type { OnboardingTask } from "../../../../types/onboarding";

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

function MyOnboardingSkeleton() {
  return (
    <div className="onboarding-details-skeleton" aria-hidden="true">
      <div className="onboarding-details-skeleton-summary" />
      {Array.from({ length: 4 }, (_, index) => (
        <div
          key={`my-onboarding-skeleton-${index}`}
          className="onboarding-details-skeleton-section"
        />
      ))}
    </div>
  );
}

export function MyOnboardingClient() {
  const { instances, isLoading: isInstancesLoading, errorMessage: instancesError } =
    useOnboardingInstances({
      scope: "me"
    });

  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(null);
  const resolvedSelectedInstanceId = useMemo(() => {
    if (instances.length === 0) {
      return null;
    }

    if (selectedInstanceId && instances.some((instance) => instance.id === selectedInstanceId)) {
      return selectedInstanceId;
    }

    const activeInstance = instances.find((instance) => instance.status === "active");
    return activeInstance?.id ?? instances[0]?.id ?? null;
  }, [instances, selectedInstanceId]);

  const {
    detail,
    isLoading: isDetailLoading,
    errorMessage: detailError
  } = useOnboardingInstanceDetail(resolvedSelectedInstanceId);

  const selectedInstance = useMemo(
    () => instances.find((instance) => instance.id === resolvedSelectedInstanceId) ?? null,
    [instances, resolvedSelectedInstanceId]
  );

  if (isInstancesLoading) {
    return <MyOnboardingSkeleton />;
  }

  if (instancesError) {
    return (
      <ErrorState
        title="My onboarding data is unavailable"
        message={instancesError}
      />
    );
  }

  if (instances.length === 0) {
    return (
      <>
        <PageHeader
          title="My Onboarding"
          description="Track your assigned onboarding tasks and completion progress."
        />
        <EmptyState
          title="No onboarding instance assigned"
          description="Your onboarding checklist appears here once your manager or HR assigns it."
          ctaLabel="Open dashboard"
          ctaHref="/dashboard"
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="My Onboarding"
        description="Track your assigned onboarding tasks and completion progress."
      />

      <section className="page-tabs" aria-label="My onboarding instances">
        {instances.map((instance) => (
          <button
            key={instance.id}
            type="button"
            className={
              resolvedSelectedInstanceId === instance.id
                ? "page-tab page-tab-active"
                : "page-tab"
            }
            onClick={() => setSelectedInstanceId(instance.id)}
          >
            {instance.templateName}
          </button>
        ))}
      </section>

      {isDetailLoading ? <MyOnboardingSkeleton /> : null}

      {!isDetailLoading && detailError ? (
        <ErrorState
          title="Selected onboarding instance is unavailable"
          message={detailError}
        />
      ) : null}

      {!isDetailLoading && !detailError && detail && selectedInstance ? (
        <>
          <section className="onboarding-instance-summary">
            <ProgressRing value={detail.instance.progressPercent} label="Progress" />
            <div className="onboarding-instance-summary-metrics">
              <article className="onboarding-instance-metric">
                <p className="onboarding-instance-metric-label">Template</p>
                <p className="onboarding-instance-metric-value">{detail.instance.templateName}</p>
              </article>
              <article className="onboarding-instance-metric">
                <p className="onboarding-instance-metric-label">Status</p>
                <StatusBadge
                  tone={selectedInstance.status === "completed" ? "success" : "processing"}
                >
                  {toSentenceCase(selectedInstance.status)}
                </StatusBadge>
              </article>
              <article className="onboarding-instance-metric">
                <p className="onboarding-instance-metric-label">Started</p>
                <p className="onboarding-instance-metric-value">
                  <time
                    dateTime={selectedInstance.startedAt}
                    title={formatDateTimeTooltip(selectedInstance.startedAt)}
                  >
                    {formatRelativeTime(selectedInstance.startedAt)}
                  </time>
                </p>
              </article>
              <article className="onboarding-instance-metric">
                <p className="onboarding-instance-metric-label">Tasks done</p>
                <p className="onboarding-instance-metric-value numeric">
                  {detail.instance.completedTasks}/{detail.instance.totalTasks}
                </p>
              </article>
            </div>
          </section>

          {detail.tasks.length === 0 ? (
            <EmptyState
              title="No tasks assigned yet"
              description="Tasks assigned to this onboarding instance will appear here."
              ctaLabel="Open dashboard"
              ctaHref="/dashboard"
            />
          ) : (
            <section className="my-onboarding-task-list">
              {detail.tasks.map((task) => (
                <article key={task.id} className="my-onboarding-task-card">
                  <header className="my-onboarding-task-card-header">
                    <h2 className="section-title">{task.title}</h2>
                    <div className="my-onboarding-task-badges">
                      {task.taskType === "e_signature" && task.status === "completed" ? (
                        <StatusBadge tone="success">Signed</StatusBadge>
                      ) : (
                        <StatusBadge tone={toneForTaskStatus(task.status)}>{toSentenceCase(task.status)}</StatusBadge>
                      )}
                    </div>
                  </header>
                  <p className="settings-card-description">
                    {task.description ?? "No description"}
                  </p>
                  <p className="settings-card-description">Category: {toSentenceCase(task.category)}</p>
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
                  {task.taskType === "e_signature" && task.status !== "completed" ? (
                    <Link href="/signatures" className="button button-accent button-sm">
                      Sign now
                    </Link>
                  ) : null}
                  <p className="settings-card-description">
                    Completed by: {task.completedByName ?? "--"}
                  </p>
                </article>
              ))}
            </section>
          )}

          <footer className="my-onboarding-footer">
            <Link className="button" href={`/onboarding/${detail.instance.id}`}>
              Open full instance view
            </Link>
          </footer>
        </>
      ) : null}
    </>
  );
}
