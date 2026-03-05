"use client";

import Link from "next/link";
import { useMemo, useState, type FormEvent } from "react";

import { EmptyState } from "../../../components/shared/empty-state";
import { PageHeader } from "../../../components/shared/page-header";
import { SlidePanel } from "../../../components/shared/slide-panel";
import { StatusBadge } from "../../../components/shared/status-badge";
import { useOnboardingInstances, useOnboardingTemplates } from "../../../hooks/use-onboarding";
import { usePeople } from "../../../hooks/use-people";
import { countryFlagFromCode, countryNameFromCode } from "../../../lib/countries";
import { formatDateTimeTooltip, formatRelativeTime } from "../../../lib/datetime";
import { toSentenceCase } from "../../../lib/format-labels";
import {
  ONBOARDING_TYPES,
  type OnboardingInstanceCreateResponse,
  type OnboardingInstanceStatus,
  type OnboardingInstanceSummary,
  type OnboardingTemplateCreateResponse,
  type OnboardingType
} from "../../../types/onboarding";

type OnboardingClientProps = {
  instanceScope: "all" | "reports" | "me";
  canViewTemplates: boolean;
  canManageOnboarding: boolean;
};

type OnboardingTab = "active" | "completed" | "templates";
type InstanceSortKey = "employee" | "startedAt";
type SortDirection = "asc" | "desc";
type ToastVariant = "success" | "error" | "info";

type ToastMessage = {
  id: string;
  variant: ToastVariant;
  message: string;
};

type StartOnboardingFormValues = {
  employeeId: string;
  templateId: string;
  type: OnboardingType;
  startedAt: string;
};

type StartOnboardingFormErrors = Partial<Record<keyof StartOnboardingFormValues, string>> & {
  form?: string;
};

type TemplateTaskDraft = {
  title: string;
  description: string;
  category: string;
  dueOffsetDays: string;
};

type TemplateTaskDraftErrors = {
  title?: string;
  description?: string;
  category?: string;
  dueOffsetDays?: string;
};

type CreateTemplateFormValues = {
  name: string;
  type: OnboardingType;
  countryCode: string;
  department: string;
  tasks: TemplateTaskDraft[];
};

type CreateTemplateFormErrors = {
  name?: string;
  type?: string;
  countryCode?: string;
  department?: string;
  tasks?: string;
  taskErrors: TemplateTaskDraftErrors[];
  form?: string;
};

const initialTemplateTaskDraft: TemplateTaskDraft = {
  title: "",
  description: "",
  category: "",
  dueOffsetDays: ""
};

const initialStartOnboardingFormValues: StartOnboardingFormValues = {
  employeeId: "",
  templateId: "",
  type: "onboarding",
  startedAt: ""
};

const initialCreateTemplateFormValues: CreateTemplateFormValues = {
  name: "",
  type: "onboarding",
  countryCode: "",
  department: "",
  tasks: [{ ...initialTemplateTaskDraft }]
};

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

function isStuckInstance(instance: OnboardingInstanceSummary): boolean {
  if (instance.status !== "active") return false;
  const startedMs = new Date(instance.startedAt).getTime();
  const nowMs = Date.now();
  const daysSinceStart = (nowMs - startedMs) / (1000 * 60 * 60 * 24);

  // Stuck if started > 14 days ago and less than 50% complete
  if (daysSinceStart > 14 && instance.progressPercent < 50) return true;
  // Stuck if started > 30 days ago and not fully complete
  if (daysSinceStart > 30 && instance.progressPercent < 100) return true;

  return false;
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

function createToastId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function validateStartOnboardingForm(
  values: StartOnboardingFormValues
): StartOnboardingFormErrors {
  const errors: StartOnboardingFormErrors = {};

  if (values.employeeId.trim().length === 0) {
    errors.employeeId = "Select an employee.";
  }

  if (values.templateId.trim().length === 0) {
    errors.templateId = "Select a template.";
  }

  if (!ONBOARDING_TYPES.includes(values.type)) {
    errors.type = "Select a valid onboarding type.";
  }

  if (
    values.startedAt.trim().length > 0 &&
    !/^\d{4}-\d{2}-\d{2}$/.test(values.startedAt.trim())
  ) {
    errors.startedAt = "Start date must be YYYY-MM-DD.";
  }

  return errors;
}

function validateCreateTemplateForm(
  values: CreateTemplateFormValues
): CreateTemplateFormErrors {
  const errors: CreateTemplateFormErrors = {
    taskErrors: values.tasks.map(() => ({}))
  };

  if (values.name.trim().length === 0) {
    errors.name = "Template name is required.";
  } else if (values.name.trim().length > 200) {
    errors.name = "Template name is too long.";
  }

  if (!ONBOARDING_TYPES.includes(values.type)) {
    errors.type = "Select a valid onboarding type.";
  }

  if (values.countryCode.trim().length > 0 && !/^[a-zA-Z]{2}$/.test(values.countryCode.trim())) {
    errors.countryCode = "Country code must be 2 letters.";
  }

  if (values.department.trim().length > 100) {
    errors.department = "Department is too long.";
  }

  if (values.tasks.length === 0) {
    errors.tasks = "Add at least one task.";
    return errors;
  }

  values.tasks.forEach((task, index) => {
    const taskErrors: TemplateTaskDraftErrors = {};

    if (task.title.trim().length === 0) {
      taskErrors.title = "Title is required.";
    } else if (task.title.trim().length > 200) {
      taskErrors.title = "Title is too long.";
    }

    if (task.description.trim().length > 1000) {
      taskErrors.description = "Description is too long.";
    }

    if (task.category.trim().length === 0) {
      taskErrors.category = "Category is required.";
    } else if (task.category.trim().length > 50) {
      taskErrors.category = "Category is too long.";
    }

    if (task.dueOffsetDays.trim().length > 0) {
      const parsedOffset = Number(task.dueOffsetDays);
      const isInteger = Number.isInteger(parsedOffset);

      if (!isInteger) {
        taskErrors.dueOffsetDays = "Due offset must be a whole number.";
      } else if (parsedOffset < -365 || parsedOffset > 365) {
        taskErrors.dueOffsetDays = "Due offset must be between -365 and 365.";
      }
    }

    errors.taskErrors[index] = taskErrors;
  });

  return errors;
}

function hasStartFormErrors(errors: StartOnboardingFormErrors): boolean {
  return Object.values(errors).some((error) => Boolean(error));
}

function hasCreateTemplateErrors(errors: CreateTemplateFormErrors): boolean {
  const hasFieldErrors = Boolean(
    errors.name ||
      errors.type ||
      errors.countryCode ||
      errors.department ||
      errors.tasks ||
      errors.form
  );

  if (hasFieldErrors) {
    return true;
  }

  return errors.taskErrors.some((taskErrors) =>
    Object.values(taskErrors).some((error) => Boolean(error))
  );
}

function OnboardingTableSkeleton() {
  return (
    <div className="table-skeleton" aria-hidden="true">
      <div className="table-skeleton-header" />
      {Array.from({ length: 6 }, (_, index) => (
        <div
          key={`table-skeleton-${index}`}
          className="table-skeleton-row"
        />
      ))}
    </div>
  );
}

export function OnboardingClient({
  instanceScope,
  canViewTemplates,
  canManageOnboarding
}: OnboardingClientProps) {
  const [activeTab, setActiveTab] = useState<OnboardingTab>("active");
  const [sortKey, setSortKey] = useState<InstanceSortKey>("startedAt");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [previewTemplateId, setPreviewTemplateId] = useState<string | null>(null);
  const [isStartPanelOpen, setIsStartPanelOpen] = useState(false);
  const [isTemplatePanelOpen, setIsTemplatePanelOpen] = useState(false);
  const [isStartingOnboarding, setIsStartingOnboarding] = useState(false);
  const [isCreatingTemplate, setIsCreatingTemplate] = useState(false);
  const [startValues, setStartValues] = useState<StartOnboardingFormValues>(
    initialStartOnboardingFormValues
  );
  const [startErrors, setStartErrors] = useState<StartOnboardingFormErrors>({});
  const [templateValues, setTemplateValues] = useState<CreateTemplateFormValues>(
    initialCreateTemplateFormValues
  );
  const [templateErrors, setTemplateErrors] = useState<CreateTemplateFormErrors>({
    taskErrors: []
  });
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [showStuckOnly, setShowStuckOnly] = useState(false);

  const activeInstancesQuery = useOnboardingInstances({
    scope: instanceScope,
    status: "active"
  });
  const completedInstancesQuery = useOnboardingInstances({
    scope: instanceScope,
    status: "completed"
  });
  const templatesQuery = useOnboardingTemplates();
  const peopleQuery = usePeople({
    scope: canManageOnboarding ? "all" : instanceScope
  });

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
  const stuckCount = useMemo(
    () => activeInstances.filter(isStuckInstance).length,
    [activeInstances]
  );
  const templatePreview = useMemo(
    () =>
      templatesQuery.templates.find((template) => template.id === previewTemplateId) ??
      null,
    [previewTemplateId, templatesQuery.templates]
  );
  const employeeOptions = useMemo(
    () =>
      peopleQuery.people
        .filter((person) => person.status === "active" || person.status === "onboarding")
        .sort((leftPerson, rightPerson) => leftPerson.fullName.localeCompare(rightPerson.fullName)),
    [peopleQuery.people]
  );

  const instancesForTab = activeTab === "active"
    ? (showStuckOnly ? activeInstances.filter(isStuckInstance) : activeInstances)
    : completedInstances;
  const activeInstancesQueryForTab =
    activeTab === "active" ? activeInstancesQuery : completedInstancesQuery;

  const addToast = (variant: ToastVariant, message: string) => {
    const id = createToastId();
    setToasts((currentToasts) => [...currentToasts, { id, message, variant }]);

    window.setTimeout(() => {
      setToasts((currentToasts) => currentToasts.filter((toast) => toast.id !== id));
    }, 4000);
  };

  const closeStartPanel = () => {
    if (isStartingOnboarding) {
      return;
    }

    setStartValues(initialStartOnboardingFormValues);
    setStartErrors({});
    setIsStartPanelOpen(false);
  };

  const closeTemplatePanel = () => {
    if (isCreatingTemplate) {
      return;
    }

    setTemplateValues(initialCreateTemplateFormValues);
    setTemplateErrors({
      taskErrors: []
    });
    setIsTemplatePanelOpen(false);
  };

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

  const updateStartValues = (
    nextValues:
      | StartOnboardingFormValues
      | ((currentValues: StartOnboardingFormValues) => StartOnboardingFormValues)
  ) => {
    setStartValues((currentValues) => {
      const resolvedValues =
        typeof nextValues === "function" ? nextValues(currentValues) : nextValues;
      setStartErrors(validateStartOnboardingForm(resolvedValues));
      return resolvedValues;
    });
  };

  const updateTemplateValues = (
    nextValues:
      | CreateTemplateFormValues
      | ((currentValues: CreateTemplateFormValues) => CreateTemplateFormValues)
  ) => {
    setTemplateValues((currentValues) => {
      const resolvedValues =
        typeof nextValues === "function" ? nextValues(currentValues) : nextValues;
      setTemplateErrors(validateCreateTemplateForm(resolvedValues));
      return resolvedValues;
    });
  };

  const handleStartOnboarding = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const validationErrors = validateStartOnboardingForm(startValues);
    setStartErrors(validationErrors);

    if (hasStartFormErrors(validationErrors)) {
      return;
    }

    setIsStartingOnboarding(true);
    setStartErrors((currentErrors) => ({
      ...currentErrors,
      form: undefined
    }));

    try {
      const response = await fetch("/api/v1/onboarding/instances", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          employeeId: startValues.employeeId,
          templateId: startValues.templateId,
          type: startValues.type,
          startedAt: startValues.startedAt.trim() || undefined
        })
      });

      const payload = (await response.json()) as OnboardingInstanceCreateResponse;

      if (!response.ok || !payload.data?.instance) {
        setStartErrors((currentErrors) => ({
          ...currentErrors,
          form: payload.error?.message ?? "Unable to start onboarding."
        }));
        return;
      }

      closeStartPanel();
      setActiveTab("active");
      activeInstancesQuery.refresh();
      completedInstancesQuery.refresh();
      addToast("success", "Onboarding instance started.");
    } catch (error) {
      setStartErrors((currentErrors) => ({
        ...currentErrors,
        form: error instanceof Error ? error.message : "Unable to start onboarding."
      }));
    } finally {
      setIsStartingOnboarding(false);
    }
  };

  const handleCreateTemplate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const validationErrors = validateCreateTemplateForm(templateValues);
    setTemplateErrors(validationErrors);

    if (hasCreateTemplateErrors(validationErrors)) {
      return;
    }

    setIsCreatingTemplate(true);
    setTemplateErrors((currentErrors) => ({
      ...currentErrors,
      form: undefined
    }));

    try {
      const response = await fetch("/api/v1/onboarding/templates", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          name: templateValues.name.trim(),
          type: templateValues.type,
          countryCode: templateValues.countryCode.trim() || undefined,
          department: templateValues.department.trim() || undefined,
          tasks: templateValues.tasks.map((task) => ({
            title: task.title.trim(),
            description: task.description.trim(),
            category: task.category.trim(),
            dueOffsetDays:
              task.dueOffsetDays.trim().length === 0
                ? null
                : Number(task.dueOffsetDays)
          }))
        })
      });

      const payload = (await response.json()) as OnboardingTemplateCreateResponse;

      if (!response.ok || !payload.data?.template) {
        setTemplateErrors((currentErrors) => ({
          ...currentErrors,
          form: payload.error?.message ?? "Unable to create template."
        }));
        return;
      }

      closeTemplatePanel();
      setActiveTab("templates");
      setPreviewTemplateId(payload.data.template.id);
      templatesQuery.refresh();
      addToast("success", "Template created.");
    } catch (error) {
      setTemplateErrors((currentErrors) => ({
        ...currentErrors,
        form: error instanceof Error ? error.message : "Unable to create template."
      }));
    } finally {
      setIsCreatingTemplate(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Onboarding"
        description="HR onboarding dashboard for active and completed lifecycle instances."
        actions={
          canManageOnboarding ? (
            <div className="onboarding-header-actions">
              <button
                type="button"
                className="button"
                onClick={() => setIsTemplatePanelOpen(true)}
              >
                New template
              </button>
              <button
                type="button"
                className="button button-accent"
                onClick={() => setIsStartPanelOpen(true)}
              >
                Start onboarding
              </button>
            </div>
          ) : null
        }
      />

      <section className="page-tabs" aria-label="Onboarding dashboard tabs">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={activeTab === tab.id ? "page-tab page-tab-active" : "page-tab"}
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

          {activeTab === "active" && stuckCount > 0 && !activeInstancesQueryForTab.isLoading ? (
            <div className="onboarding-stuck-filter">
              <label className="onboarding-stuck-toggle">
                <input
                  type="checkbox"
                  checked={showStuckOnly}
                  onChange={(e) => setShowStuckOnly(e.target.checked)}
                />
                <span>
                  Show stuck only ({stuckCount})
                </span>
              </label>
            </div>
          ) : null}

          {!activeInstancesQueryForTab.isLoading &&
          !activeInstancesQueryForTab.errorMessage &&
          instancesForTab.length === 0 ? (
            <section className="error-state">
              <EmptyState
                title={showStuckOnly ? "No stuck onboarding instances" : `No ${activeTab} onboarding instances`}
                description={showStuckOnly
                  ? "All active onboarding instances are progressing normally."
                  : "When onboarding records are created, they will appear in this table."}
                ctaLabel={showStuckOnly ? "Show all" : (canManageOnboarding ? "Start onboarding" : "Open dashboard")}
                {...(showStuckOnly
                  ? { onCtaClick: () => setShowStuckOnly(false) }
                  : canManageOnboarding
                    ? { onCtaClick: () => setIsStartPanelOpen(true) }
                    : { ctaHref: "/dashboard" })}
              />
            </section>
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
                        <StatusBadge tone={toneForType(instance.type)}>{toSentenceCase(instance.type)}</StatusBadge>
                      </td>
                      <td>
                        <div className="onboarding-status-cell">
                          <StatusBadge tone={toneForInstanceStatus(instance.status)}>
                            {toSentenceCase(instance.status)}
                          </StatusBadge>
                          {isStuckInstance(instance) ? (
                            <StatusBadge tone="warning">Stuck</StatusBadge>
                          ) : null}
                        </div>
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
            <section className="error-state">
              <EmptyState
                title="No onboarding templates"
                description="Template records will appear here once created."
                ctaLabel={canManageOnboarding ? "Create template" : "Open dashboard"}
                ctaHref={canManageOnboarding ? "/onboarding" : "/dashboard"}
              />
              {canManageOnboarding ? (
                <button
                  type="button"
                  className="button"
                  onClick={() => setIsTemplatePanelOpen(true)}
                >
                  Create template
                </button>
              ) : null}
            </section>
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
                          <StatusBadge tone={toneForType(template.type)}>{toSentenceCase(template.type)}</StatusBadge>
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
                            {canManageOnboarding ? (
                              <button
                                type="button"
                                className="table-row-action"
                                onClick={() => {
                                  setStartValues((currentValues) => ({
                                    ...currentValues,
                                    templateId: template.id,
                                    type: template.type
                                  }));
                                  setStartErrors({});
                                  setIsStartPanelOpen(true);
                                }}
                              >
                                Start
                              </button>
                            ) : null}
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
                          <StatusBadge tone="info">{toSentenceCase(task.category)}</StatusBadge>
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

      <SlidePanel
        isOpen={isStartPanelOpen}
        title="Start Onboarding"
        description="Assign a template to an employee and create tasks."
        onClose={closeStartPanel}
      >
        <form className="slide-panel-form-wrapper" onSubmit={handleStartOnboarding} noValidate>
          <label className="form-field" htmlFor="onboarding-employee">
            <span className="form-label">Employee</span>
            <select
              id="onboarding-employee"
              className={startErrors.employeeId ? "form-input form-input-error" : "form-input"}
              value={startValues.employeeId}
              onChange={(event) =>
                updateStartValues({
                  ...startValues,
                  employeeId: event.currentTarget.value
                })
              }
            >
              <option value="">Select employee</option>
              {employeeOptions.map((person) => (
                <option key={`onboarding-employee-${person.id}`} value={person.id}>
                  {person.fullName}
                </option>
              ))}
            </select>
            {startErrors.employeeId ? (
              <p className="form-field-error">{startErrors.employeeId}</p>
            ) : null}
          </label>

          <label className="form-field" htmlFor="onboarding-template">
            <span className="form-label">Template</span>
            <select
              id="onboarding-template"
              className={startErrors.templateId ? "form-input form-input-error" : "form-input"}
              value={startValues.templateId}
              onChange={(event) => {
                const nextTemplate = templatesQuery.templates.find(
                  (template) => template.id === event.currentTarget.value
                );

                updateStartValues({
                  ...startValues,
                  templateId: event.currentTarget.value,
                  type: nextTemplate?.type ?? startValues.type
                });
              }}
            >
              <option value="">Select template</option>
              {templatesQuery.templates.map((template) => (
                <option key={`onboarding-template-${template.id}`} value={template.id}>
                  {template.name}
                </option>
              ))}
            </select>
            {startErrors.templateId ? (
              <p className="form-field-error">{startErrors.templateId}</p>
            ) : null}
          </label>

          <label className="form-field" htmlFor="onboarding-type">
            <span className="form-label">Type</span>
            <select
              id="onboarding-type"
              className={startErrors.type ? "form-input form-input-error" : "form-input"}
              value={startValues.type}
              onChange={(event) =>
                updateStartValues({
                  ...startValues,
                  type: event.currentTarget.value as OnboardingType
                })
              }
            >
              {ONBOARDING_TYPES.map((type) => (
                <option key={`onboarding-type-${type}`} value={type}>
                  {type}
                </option>
              ))}
            </select>
            {startErrors.type ? <p className="form-field-error">{startErrors.type}</p> : null}
          </label>

          <label className="form-field" htmlFor="onboarding-start-date">
            <span className="form-label">Start date</span>
            <input
              id="onboarding-start-date"
              type="date"
              className={startErrors.startedAt ? "form-input form-input-error" : "form-input"}
              value={startValues.startedAt}
              onChange={(event) =>
                updateStartValues({
                  ...startValues,
                  startedAt: event.currentTarget.value
                })
              }
            />
            {startErrors.startedAt ? (
              <p className="form-field-error">{startErrors.startedAt}</p>
            ) : null}
          </label>

          {startErrors.form ? <p className="form-submit-error">{startErrors.form}</p> : null}

          <div className="slide-panel-actions">
            <button
              type="button"
              className="button"
              onClick={closeStartPanel}
              disabled={isStartingOnboarding}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="button button-accent"
              disabled={
                isStartingOnboarding ||
                employeeOptions.length === 0 ||
                templatesQuery.templates.length === 0
              }
            >
              {isStartingOnboarding ? "Starting..." : "Start onboarding"}
            </button>
          </div>
        </form>
      </SlidePanel>

      <SlidePanel
        isOpen={isTemplatePanelOpen}
        title="Create Template"
        description="Define reusable tasks for onboarding or offboarding."
        onClose={closeTemplatePanel}
      >
        <form className="slide-panel-form-wrapper" onSubmit={handleCreateTemplate} noValidate>
          <label className="form-field" htmlFor="template-name">
            <span className="form-label">Template name</span>
            <input
              id="template-name"
              className={templateErrors.name ? "form-input form-input-error" : "form-input"}
              value={templateValues.name}
              onChange={(event) =>
                updateTemplateValues({
                  ...templateValues,
                  name: event.currentTarget.value
                })
              }
            />
            {templateErrors.name ? <p className="form-field-error">{templateErrors.name}</p> : null}
          </label>

          <label className="form-field" htmlFor="template-type">
            <span className="form-label">Template type</span>
            <select
              id="template-type"
              className={templateErrors.type ? "form-input form-input-error" : "form-input"}
              value={templateValues.type}
              onChange={(event) =>
                updateTemplateValues({
                  ...templateValues,
                  type: event.currentTarget.value as OnboardingType
                })
              }
            >
              {ONBOARDING_TYPES.map((type) => (
                <option key={`template-type-${type}`} value={type}>
                  {type}
                </option>
              ))}
            </select>
            {templateErrors.type ? <p className="form-field-error">{templateErrors.type}</p> : null}
          </label>

          <label className="form-field" htmlFor="template-country">
            <span className="form-label">Country code</span>
            <input
              id="template-country"
              maxLength={2}
              className={templateErrors.countryCode ? "form-input form-input-error" : "form-input"}
              value={templateValues.countryCode}
              onChange={(event) =>
                updateTemplateValues({
                  ...templateValues,
                  countryCode: event.currentTarget.value.toUpperCase()
                })
              }
            />
            {templateErrors.countryCode ? (
              <p className="form-field-error">{templateErrors.countryCode}</p>
            ) : null}
          </label>

          <label className="form-field" htmlFor="template-department">
            <span className="form-label">Department</span>
            <input
              id="template-department"
              className={templateErrors.department ? "form-input form-input-error" : "form-input"}
              value={templateValues.department}
              onChange={(event) =>
                updateTemplateValues({
                  ...templateValues,
                  department: event.currentTarget.value
                })
              }
            />
            {templateErrors.department ? (
              <p className="form-field-error">{templateErrors.department}</p>
            ) : null}
          </label>

          <section className="onboarding-template-editor">
            <div className="onboarding-template-editor-header">
              <h3 className="section-title">Tasks</h3>
              <button
                type="button"
                className="button"
                onClick={() =>
                  updateTemplateValues({
                    ...templateValues,
                    tasks: [...templateValues.tasks, { ...initialTemplateTaskDraft }]
                  })
                }
              >
                Add task
              </button>
            </div>

            {templateErrors.tasks ? <p className="form-field-error">{templateErrors.tasks}</p> : null}

            {templateValues.tasks.map((task, index) => {
              const taskErrors = templateErrors.taskErrors[index] ?? {};

              return (
                <article key={`template-task-${index}`} className="onboarding-template-editor-card">
                  <header className="onboarding-template-editor-card-header">
                    <p className="section-title">Task {index + 1}</p>
                    <button
                      type="button"
                      className="table-row-action"
                      onClick={() =>
                        updateTemplateValues({
                          ...templateValues,
                          tasks: templateValues.tasks.filter((_, taskIndex) => taskIndex !== index)
                        })
                      }
                      disabled={templateValues.tasks.length === 1}
                    >
                      Remove
                    </button>
                  </header>

                  <label className="form-field" htmlFor={`template-task-title-${index}`}>
                    <span className="form-label">Title</span>
                    <input
                      id={`template-task-title-${index}`}
                      className={taskErrors.title ? "form-input form-input-error" : "form-input"}
                      value={task.title}
                      onChange={(event) =>
                        updateTemplateValues({
                          ...templateValues,
                          tasks: templateValues.tasks.map((currentTask, taskIndex) =>
                            taskIndex === index
                              ? { ...currentTask, title: event.currentTarget.value }
                              : currentTask
                          )
                        })
                      }
                    />
                    {taskErrors.title ? <p className="form-field-error">{taskErrors.title}</p> : null}
                  </label>

                  <label className="form-field" htmlFor={`template-task-description-${index}`}>
                    <span className="form-label">Description</span>
                    <textarea
                      id={`template-task-description-${index}`}
                      className={taskErrors.description ? "form-input form-input-error" : "form-input"}
                      rows={3}
                      value={task.description}
                      onChange={(event) =>
                        updateTemplateValues({
                          ...templateValues,
                          tasks: templateValues.tasks.map((currentTask, taskIndex) =>
                            taskIndex === index
                              ? { ...currentTask, description: event.currentTarget.value }
                              : currentTask
                          )
                        })
                      }
                    />
                    {taskErrors.description ? (
                      <p className="form-field-error">{taskErrors.description}</p>
                    ) : null}
                  </label>

                  <div className="onboarding-template-editor-grid">
                    <label className="form-field" htmlFor={`template-task-category-${index}`}>
                      <span className="form-label">Category</span>
                      <input
                        id={`template-task-category-${index}`}
                        className={taskErrors.category ? "form-input form-input-error" : "form-input"}
                        value={task.category}
                        onChange={(event) =>
                          updateTemplateValues({
                            ...templateValues,
                            tasks: templateValues.tasks.map((currentTask, taskIndex) =>
                              taskIndex === index
                                ? { ...currentTask, category: event.currentTarget.value }
                                : currentTask
                            )
                          })
                        }
                      />
                      {taskErrors.category ? (
                        <p className="form-field-error">{taskErrors.category}</p>
                      ) : null}
                    </label>

                    <label className="form-field" htmlFor={`template-task-offset-${index}`}>
                      <span className="form-label">Due offset (days)</span>
                      <input
                        id={`template-task-offset-${index}`}
                        className={taskErrors.dueOffsetDays ? "form-input form-input-error" : "form-input"}
                        value={task.dueOffsetDays}
                        onChange={(event) =>
                          updateTemplateValues({
                            ...templateValues,
                            tasks: templateValues.tasks.map((currentTask, taskIndex) =>
                              taskIndex === index
                                ? { ...currentTask, dueOffsetDays: event.currentTarget.value }
                                : currentTask
                            )
                          })
                        }
                      />
                      {taskErrors.dueOffsetDays ? (
                        <p className="form-field-error">{taskErrors.dueOffsetDays}</p>
                      ) : null}
                    </label>
                  </div>
                </article>
              );
            })}
          </section>

          {templateErrors.form ? <p className="form-submit-error">{templateErrors.form}</p> : null}

          <div className="slide-panel-actions">
            <button
              type="button"
              className="button"
              onClick={closeTemplatePanel}
              disabled={isCreatingTemplate}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="button button-accent"
              disabled={isCreatingTemplate}
            >
              {isCreatingTemplate ? "Creating..." : "Create template"}
            </button>
          </div>
        </form>
      </SlidePanel>

      {toasts.length > 0 ? (
        <section className="toast-region" aria-live="polite">
          {toasts.map((toast) => (
            <article
              key={toast.id}
              className={`toast-message ${
                toast.variant === "success"
                  ? "toast-message-success"
                  : toast.variant === "error"
                    ? "toast-message-error"
                    : "toast-message-info"
              }`}
            >
              <span>{toast.message}</span>
              <button
                type="button"
                className="toast-dismiss"
                aria-label="Dismiss notification"
                onClick={() =>
                  setToasts((currentToasts) =>
                    currentToasts.filter((entry) => entry.id !== toast.id)
                  )
                }
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    d="M6 6l12 12M18 6L6 18"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </article>
          ))}
        </section>
      ) : null}
    </>
  );
}
