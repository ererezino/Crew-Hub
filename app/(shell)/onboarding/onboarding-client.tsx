"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { EmptyState } from "../../../components/shared/empty-state";
import { PageHeader } from "../../../components/shared/page-header";
import { StatusBadge } from "../../../components/shared/status-badge";
import { useOnboardingInstances, useOnboardingTemplates } from "../../../hooks/use-onboarding";
import { countryFlagFromCode, countryNameFromCode } from "../../../lib/countries";
import { formatDateTimeTooltip, formatRelativeTime } from "../../../lib/datetime";
import type {
  OnboardingInstanceStatus,
  OnboardingInstanceSummary,
  OnboardingType
} from "../../../types/onboarding";

type OnboardingClientProps = {
  instanceScope: "all" | "reports" | "me";
  canViewTemplates: boolean;
};

type OnboardingTab = "active" | "completed" | "templates";
type InstanceSortKey = "employee" | "startedAt";
type SortDirection = "asc" | "desc";

function toneForInstanceStatus(status: OnboardingInstanceStatus) {
  switch (status) {
    case "active":
      return "processing" as const;
    case "completed":
      return "success" as const;
    case "cancelled":
      return "warning" as const;
    default:
      return "draft" as const;
  }
}

function toneForType(type: OnboardingType) {
  return type === "onboarding" ? ("info" as const) : ("pending" as const);
}

function sortInstances(
  instances: readonly OnboardingInstanceSummary[],
  sortKey: InstanceSortKey,
  sortDirection: SortDirection
): OnboardingInstanceSummary[] {
  return [...instances].sort((leftInstance, rightInstance) => {
    if (sortKey === "employee") {
      const comparison = leftInstance.employeeName.localeCompare(rightInstance.employeeName);
      return sortDirection === "asc" ? comparison : comparison * -1;
    }

    const leftTimestamp = new Date(leftInstance.startedAt).getTime();
    const rightTimestamp = new Date(rightInstance.startedAt).getTime();

    return sortDirection === "asc"
      ? leftTimestamp - rightTimestamp
      : rightTimestamp - leftTimestamp;
  });
}

function OnboardingTableSkeleton() {
  return (
    <div className="onboarding-table-skeleton" aria-hidden="true">
      <div className="onboarding-table-skeleton-header" />
      {Array.from({ length: 6 }, (_, index) => (
        <div
          key={`onboarding-table-skeleton-${index}`}
          className="onboarding-table-skeleton-row"
        />
      ))}
    </div>
  );
}

export function OnboardingClient({
  instanceScope,
  canViewTemplates
}: OnboardingClientProps) {
  const [activeTab, setActiveTab] = useState<OnboardingTab>("active");
  const [sortKey, setSortKey] = useState<InstanceSortKey>("startedAt");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [previewTemplateId, setPreviewTemplateId] = useState<string | null>(null);

  const activeInstancesQuery = useOnboardingInstances({
    scope: instanceScope,
    status: "active"
  });
  const completedInstancesQuery = useOnboardingInstances({
    scope: instanceScope,
    status: "completed"
  });
  const templatesQuery = useOnboardingTemplates("onboarding");

  const tabs = useMemo(
    () =>
      (canViewTemplates
        ? [
            { id: "active", label: "Active" },
            { id: "completed", label: "Completed" },
            { id: "templates", label: "Templates" }
          ]
        : [
            { id: "active", label: "Active" },
            { id: "completed", label: "Completed" }
          ]) as Array<{ id: OnboardingTab; label: string }>,
    [canViewTemplates]
  );

  const activeInstances = useMemo(
    () => sortInstances(activeInstancesQuery.instances, sortKey, sortDirection),
    [activeInstancesQuery.instances, sortDirection, sortKey]
  );
  const completedInstances = useMemo(
    () => sortInstances(completedInstancesQuery.instances, sortKey, sortDirection),
    [completedInstancesQuery.instances, sortDirection, sortKey]
  );
  const templatePreview = useMemo(
    () =>
      templatesQuery.templates.find((template) => template.id === previewTemplateId) ??
      null,
    [previewTemplateId, templatesQuery.templates]
  );

  const handleSort = (nextSortKey: InstanceSortKey) => {
    if (sortKey === nextSortKey) {
      setSortDirection((currentDirection) =>
        currentDirection === "asc" ? "desc" : "asc"
      );
      return;
    }

    setSortKey(nextSortKey);
    setSortDirection("asc");
  };

  const instancesForTab = activeTab === "active" ? activeInstances : completedInstances;
  const activeInstancesQueryForTab =
    activeTab === "active" ? activeInstancesQuery : completedInstancesQuery;

  return (
    <>
      <PageHeader
        title="Onboarding"
        description="HR onboarding dashboard for active and completed lifecycle instances."
      />

      <section className="onboarding-tabs" aria-label="Onboarding dashboard tabs">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={activeTab === tab.id ? "onboarding-tab onboarding-tab-active" : "onboarding-tab"}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </section>

      {activeTab !== "templates" ? (
        <>
          {activeInstancesQueryForTab.isLoading ? <OnboardingTableSkeleton /> : null}

          {!activeInstancesQueryForTab.isLoading && activeInstancesQueryForTab.errorMessage ? (
            <EmptyState
              title="Onboarding data is unavailable"
              description={activeInstancesQueryForTab.errorMessage}
              ctaLabel="Retry"
              ctaHref="/onboarding"
            />
          ) : null}

          {!activeInstancesQueryForTab.isLoading &&
          !activeInstancesQueryForTab.errorMessage &&
          instancesForTab.length === 0 ? (
            <EmptyState
              title={`No ${activeTab} onboarding instances`}
              description="When onboarding records are created, they will appear in this table."
              ctaLabel="Open dashboard"
              ctaHref="/dashboard"
            />
          ) : null}

          {!activeInstancesQueryForTab.isLoading &&
          !activeInstancesQueryForTab.errorMessage &&
          instancesForTab.length > 0 ? (
            <div className="data-table-container">
              <table className="data-table" aria-label="Onboarding instances table">
                <thead>
                  <tr>
                    <th>
                      <button
                        type="button"
                        className="table-sort-trigger"
                        onClick={() => handleSort("employee")}
                      >
                        Employee {sortKey === "employee" ? (sortDirection === "asc" ? "↑" : "↓") : ""}
                      </button>
                    </th>
                    <th>Template</th>
                    <th>Type</th>
                    <th>Status</th>
                    <th>Progress</th>
                    <th>
                      <button
                        type="button"
                        className="table-sort-trigger"
                        onClick={() => handleSort("startedAt")}
                      >
                        Started {sortKey === "startedAt" ? (sortDirection === "asc" ? "↑" : "↓") : ""}
                      </button>
                    </th>
                    <th>Completed</th>
                    <th className="table-action-column">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {instancesForTab.map((instance) => (
                    <tr key={instance.id} className="data-table-row">
                      <td>{instance.employeeName}</td>
                      <td>{instance.templateName}</td>
                      <td>
                        <StatusBadge tone={toneForType(instance.type)}>{instance.type}</StatusBadge>
                      </td>
                      <td>
                        <StatusBadge tone={toneForInstanceStatus(instance.status)}>
                          {instance.status}
                        </StatusBadge>
                      </td>
                      <td className="numeric">
                        {instance.completedTasks}/{instance.totalTasks} ({instance.progressPercent}%)
                      </td>
                      <td>
                        <time
                          dateTime={instance.startedAt}
                          title={formatDateTimeTooltip(instance.startedAt)}
                        >
                          {formatRelativeTime(instance.startedAt)}
                        </time>
                      </td>
                      <td>
                        {instance.completedAt ? (
                          <time
                            dateTime={instance.completedAt}
                            title={formatDateTimeTooltip(instance.completedAt)}
                          >
                            {formatRelativeTime(instance.completedAt)}
                          </time>
                        ) : (
                          "--"
                        )}
                      </td>
                      <td className="table-row-action-cell">
                        <div className="onboarding-row-actions">
                          <Link className="table-row-action" href={`/onboarding/${instance.id}`}>
                            View
                          </Link>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </>
      ) : null}

      {activeTab === "templates" ? (
        <>
          {templatesQuery.isLoading ? <OnboardingTableSkeleton /> : null}

          {!templatesQuery.isLoading && templatesQuery.errorMessage ? (
            <EmptyState
              title="Template data is unavailable"
              description={templatesQuery.errorMessage}
              ctaLabel="Retry"
              ctaHref="/onboarding"
            />
          ) : null}

          {!templatesQuery.isLoading &&
          !templatesQuery.errorMessage &&
          templatesQuery.templates.length === 0 ? (
            <EmptyState
              title="No onboarding templates"
              description="Template records will appear here once created."
              ctaLabel="Open dashboard"
              ctaHref="/dashboard"
            />
          ) : null}

          {!templatesQuery.isLoading &&
          !templatesQuery.errorMessage &&
          templatesQuery.templates.length > 0 ? (
            <>
              <div className="data-table-container">
                <table className="data-table" aria-label="Onboarding templates table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Type</th>
                      <th>Country</th>
                      <th>Department</th>
                      <th>Tasks</th>
                      <th>Updated</th>
                      <th className="table-action-column">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {templatesQuery.templates.map((template) => (
                      <tr key={template.id} className="data-table-row">
                        <td>{template.name}</td>
                        <td>
                          <StatusBadge tone={toneForType(template.type)}>{template.type}</StatusBadge>
                        </td>
                        <td>
                          <span className="country-chip">
                            <span>{countryFlagFromCode(template.countryCode)}</span>
                            <span>{countryNameFromCode(template.countryCode)}</span>
                          </span>
                        </td>
                        <td>{template.department ?? "--"}</td>
                        <td className="numeric">{template.tasks.length}</td>
                        <td>
                          <time
                            dateTime={template.updatedAt}
                            title={formatDateTimeTooltip(template.updatedAt)}
                          >
                            {formatRelativeTime(template.updatedAt)}
                          </time>
                        </td>
                        <td className="table-row-action-cell">
                          <div className="onboarding-row-actions">
                            <button
                              type="button"
                              className="table-row-action"
                              onClick={() => setPreviewTemplateId(template.id)}
                            >
                              Preview
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {templatePreview ? (
                <section className="onboarding-template-preview">
                  <header className="onboarding-template-preview-header">
                    <h2 className="section-title">{templatePreview.name} Tasks</h2>
                    <p className="settings-card-description">
                      {templatePreview.tasks.length} tasks in template
                    </p>
                  </header>
                  <ul className="onboarding-template-task-list">
                    {templatePreview.tasks.map((task, index) => (
                      <li key={`${templatePreview.id}-task-${index}`} className="onboarding-template-task-item">
                        <div>
                          <p className="onboarding-template-task-title">{task.title}</p>
                          <p className="settings-card-description">{task.description}</p>
                        </div>
                        <div className="onboarding-template-task-meta">
                          <StatusBadge tone="info">{task.category}</StatusBadge>
                          <span className="numeric">
                            {task.dueOffsetDays === null
                              ? "No due offset"
                              : `${task.dueOffsetDays}d`}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </>
          ) : null}
        </>
      ) : null}
    </>
  );
}
