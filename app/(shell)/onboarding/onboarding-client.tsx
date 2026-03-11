"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState, type FormEvent } from "react";

import { EmptyState } from "../../../components/shared/empty-state";
import { PageHeader } from "../../../components/shared/page-header";
import { SlidePanel } from "../../../components/shared/slide-panel";
import { StatusBadge } from "../../../components/shared/status-badge";
import { useAtRiskOnboardings, useOnboardingInstances, useOnboardingTemplates } from "../../../hooks/use-onboarding";
import { useUnsavedGuard } from "../../../hooks/use-unsaved-guard";
import { usePeople } from "../../../hooks/use-people";
import { countryFlagFromCode, countryNameFromCode } from "../../../lib/countries";
import { formatDateTimeTooltip, formatRelativeTime } from "../../../lib/datetime";
import { toSentenceCase } from "../../../lib/format-labels";
import {
  ONBOARDING_TYPES,
  type AtRiskInstance,
  type OnboardingInstanceCreateResponse,
  type OnboardingInstanceStatus,
  type OnboardingInstanceSummary,
  type OnboardingRemindResponse,
  type OnboardingTemplateCreateResponse,
  type OnboardingType
} from "../../../types/onboarding";

type AppLocale = "en" | "fr";

type OnboardingClientProps = {
  instanceScope: "all" | "reports" | "me";
  canViewTemplates: boolean;
  canManageOnboarding: boolean;
};

type OnboardingTab = "active" | "completed" | "at_risk" | "templates";
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
  actionUrl: string;
  actionLabel: string;
  completionGuidance: string;
};

type TemplateTaskDraftErrors = {
  title?: string;
  description?: string;
  category?: string;
  dueOffsetDays?: string;
  actionUrl?: string;
  actionLabel?: string;
  completionGuidance?: string;
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
  dueOffsetDays: "",
  actionUrl: "",
  actionLabel: "",
  completionGuidance: ""
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
  values: StartOnboardingFormValues,
  td: (key: string, params?: Record<string, unknown>) => string
): StartOnboardingFormErrors {
  const errors: StartOnboardingFormErrors = {};

  if (values.employeeId.trim().length === 0) {
    errors.employeeId = td('startPanel.errors.employeeRequired');
  }

  if (values.templateId.trim().length === 0) {
    errors.templateId = td('startPanel.errors.templateRequired');
  }

  if (!ONBOARDING_TYPES.includes(values.type)) {
    errors.type = td('startPanel.errors.invalidType');
  }

  if (
    values.startedAt.trim().length > 0 &&
    !/^\d{4}-\d{2}-\d{2}$/.test(values.startedAt.trim())
  ) {
    errors.startedAt = td('startPanel.errors.invalidDate');
  }

  return errors;
}

function validateCreateTemplateForm(
  values: CreateTemplateFormValues,
  td: (key: string, params?: Record<string, unknown>) => string
): CreateTemplateFormErrors {
  const errors: CreateTemplateFormErrors = {
    taskErrors: values.tasks.map(() => ({}))
  };

  if (values.name.trim().length === 0) {
    errors.name = td('createTemplatePanel.errors.nameRequired');
  } else if (values.name.trim().length > 200) {
    errors.name = td('createTemplatePanel.errors.nameTooLong');
  }

  if (!ONBOARDING_TYPES.includes(values.type)) {
    errors.type = td('createTemplatePanel.errors.invalidType');
  }

  if (values.countryCode.trim().length > 0 && !/^[a-zA-Z]{2}$/.test(values.countryCode.trim())) {
    errors.countryCode = td('createTemplatePanel.errors.countryCodeInvalid');
  }

  if (values.department.trim().length > 100) {
    errors.department = td('createTemplatePanel.errors.departmentTooLong');
  }

  if (values.tasks.length === 0) {
    errors.tasks = td('createTemplatePanel.errors.noTasks');
    return errors;
  }

  values.tasks.forEach((task, index) => {
    const taskErrors: TemplateTaskDraftErrors = {};

    if (task.title.trim().length === 0) {
      taskErrors.title = td('createTemplatePanel.errors.taskTitleRequired');
    } else if (task.title.trim().length > 200) {
      taskErrors.title = td('createTemplatePanel.errors.taskTitleTooLong');
    }

    if (task.description.trim().length > 1000) {
      taskErrors.description = td('createTemplatePanel.errors.taskDescriptionTooLong');
    }

    if (task.category.trim().length === 0) {
      taskErrors.category = td('createTemplatePanel.errors.taskCategoryRequired');
    } else if (task.category.trim().length > 50) {
      taskErrors.category = td('createTemplatePanel.errors.taskCategoryTooLong');
    }

    if (task.dueOffsetDays.trim().length > 0) {
      const parsedOffset = Number(task.dueOffsetDays);
      const isInteger = Number.isInteger(parsedOffset);

      if (!isInteger) {
        taskErrors.dueOffsetDays = td('createTemplatePanel.errors.dueOffsetNotInteger');
      } else if (parsedOffset < -365 || parsedOffset > 365) {
        taskErrors.dueOffsetDays = td('createTemplatePanel.errors.dueOffsetOutOfRange');
      }
    }

    if (task.actionUrl.trim().length > 0) {
      try {
        const parsedUrl = new URL(task.actionUrl.trim());

        if (!["http:", "https:"].includes(parsedUrl.protocol)) {
          taskErrors.actionUrl = td('createTemplatePanel.errors.actionUrlProtocol');
        }
      } catch {
        taskErrors.actionUrl = td('createTemplatePanel.errors.actionUrlInvalid');
      }
    }

    if (task.actionLabel.trim().length > 120) {
      taskErrors.actionLabel = td('createTemplatePanel.errors.actionLabelTooLong');
    }

    if (task.completionGuidance.trim().length > 1000) {
      taskErrors.completionGuidance = td('createTemplatePanel.errors.completionGuidanceTooLong');
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
  const t = useTranslations('onboarding');
  const tCommon = useTranslations('common');
  const locale = useLocale() as AppLocale;
  const td = t as (key: string, params?: Record<string, unknown>) => string;

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
  const [templateFormDirty, setTemplateFormDirty] = useState(false);
  useUnsavedGuard(templateFormDirty);

  const activeInstancesQuery = useOnboardingInstances({
    scope: instanceScope,
    status: "active"
  });
  const completedInstancesQuery = useOnboardingInstances({
    scope: instanceScope,
    status: "completed"
  });
  const templatesQuery = useOnboardingTemplates();
  const atRiskQuery = useAtRiskOnboardings();
  const peopleQuery = usePeople({
    scope: canManageOnboarding ? "all" : instanceScope
  });
  const [sendingReminderId, setSendingReminderId] = useState<string | null>(null);

  const atRiskCount = atRiskQuery.instances.length;

  const tabs = useMemo(
    () =>
      (canViewTemplates
        ? [
            { id: "active", label: t('tabs.active') },
            { id: "completed", label: t('tabs.completed') },
            { id: "at_risk", label: t('tabs.atRisk') },
            { id: "templates", label: t('tabs.templates') }
          ]
        : canManageOnboarding
          ? [
              { id: "active", label: t('tabs.active') },
              { id: "completed", label: t('tabs.completed') },
              { id: "at_risk", label: t('tabs.atRisk') }
            ]
          : [
              { id: "active", label: t('tabs.active') },
              { id: "completed", label: t('tabs.completed') }
            ]) as Array<{ id: OnboardingTab; label: string }>,
    [canViewTemplates, canManageOnboarding, t]
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
  const employeeOptions = useMemo(
    () =>
      peopleQuery.people
        .filter((person) => person.status === "active" || person.status === "onboarding")
        .sort((leftPerson, rightPerson) => leftPerson.fullName.localeCompare(rightPerson.fullName)),
    [peopleQuery.people]
  );

  const instancesForTab = activeTab === "active" ? activeInstances : completedInstances;
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
    setTemplateFormDirty(false);
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
      setStartErrors(validateStartOnboardingForm(resolvedValues, td));
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
      setTemplateErrors(validateCreateTemplateForm(resolvedValues, td));
      return resolvedValues;
    });
    setTemplateFormDirty(true);
  };

  const handleStartOnboarding = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const validationErrors = validateStartOnboardingForm(startValues, td);
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
          form: payload.error?.message ?? td('toast.startFailed')
        }));
        return;
      }

      closeStartPanel();
      setActiveTab("active");
      activeInstancesQuery.refresh();
      completedInstancesQuery.refresh();
      addToast("success", td('toast.onboardingStarted'));
    } catch (error) {
      setStartErrors((currentErrors) => ({
        ...currentErrors,
        form: error instanceof Error ? error.message : td('toast.startFailed')
      }));
    } finally {
      setIsStartingOnboarding(false);
    }
  };

  const handleCreateTemplate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const validationErrors = validateCreateTemplateForm(templateValues, td);
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
                : Number(task.dueOffsetDays),
            actionUrl: task.actionUrl.trim().length === 0 ? null : task.actionUrl.trim(),
            actionLabel: task.actionLabel.trim().length === 0 ? null : task.actionLabel.trim(),
            completionGuidance:
              task.completionGuidance.trim().length === 0
                ? null
                : task.completionGuidance.trim()
          }))
        })
      });

      const payload = (await response.json()) as OnboardingTemplateCreateResponse;

      if (!response.ok || !payload.data?.template) {
        setTemplateErrors((currentErrors) => ({
          ...currentErrors,
          form: payload.error?.message ?? td('toast.templateCreateFailed')
        }));
        return;
      }

      closeTemplatePanel();
      setActiveTab("templates");
      setPreviewTemplateId(payload.data.template.id);
      templatesQuery.refresh();
      addToast("success", td('toast.templateCreated'));
    } catch (error) {
      setTemplateErrors((currentErrors) => ({
        ...currentErrors,
        form: error instanceof Error ? error.message : td('toast.templateCreateFailed')
      }));
    } finally {
      setIsCreatingTemplate(false);
    }
  };

  const handleSendReminder = async (instance: AtRiskInstance) => {
    if (sendingReminderId) {
      return;
    }

    setSendingReminderId(instance.instanceId);

    try {
      const response = await fetch(
        `/api/v1/onboarding/instances/${instance.instanceId}/remind`,
        { method: "POST" }
      );

      const payload = (await response.json()) as OnboardingRemindResponse;

      if (!response.ok || !payload.data?.sent) {
        addToast("error", payload.error?.message ?? td('toast.unableToSendReminder'));
        return;
      }

      addToast("success", td('toast.reminderSent', { name: instance.employeeName }));
    } catch (error) {
      addToast(
        "error",
        error instanceof Error ? error.message : td('toast.unableToSendReminder')
      );
    } finally {
      setSendingReminderId(null);
    }
  };

  return (
    <>
      <PageHeader
        title={t('pageTitle')}
        description={t('pageDescription')}
        actions={
          canManageOnboarding ? (
            <>
              <button
                type="button"
                className="button"
                onClick={() => setIsTemplatePanelOpen(true)}
              >
                {t('actions.newTemplate')}
              </button>
              <button
                type="button"
                className="button button-accent"
                onClick={() => setIsStartPanelOpen(true)}
              >
                {t('actions.startOnboarding')}
              </button>
            </>
          ) : null
        }
      />

      <section className="page-tabs" aria-label={t('tabs.ariaLabel')}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={activeTab === tab.id ? "page-tab page-tab-active" : "page-tab"}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
            {tab.id === "at_risk" && atRiskCount > 0 ? (
              <span className="page-tab-badge numeric">{atRiskCount}</span>
            ) : null}
          </button>
        ))}
      </section>

      {activeTab === "active" || activeTab === "completed" ? (
        <>
          {activeInstancesQueryForTab.isLoading ? <OnboardingTableSkeleton /> : null}

          {!activeInstancesQueryForTab.isLoading && activeInstancesQueryForTab.errorMessage ? (
            <EmptyState
              title={t('emptyState.unavailable')}
              description={activeInstancesQueryForTab.errorMessage}
              ctaLabel={tCommon('retry')}
              ctaHref="/onboarding"
            />
          ) : null}

          {!activeInstancesQueryForTab.isLoading &&
          !activeInstancesQueryForTab.errorMessage &&
          instancesForTab.length === 0 ? (
            <>
              <EmptyState
                title={td(`emptyState.noInstances_${activeTab}`)}
                description={t('emptyState.noRecords')}
                {...(canManageOnboarding
                  ? { ctaLabel: t('actions.startOnboarding'), onCtaClick: () => setIsStartPanelOpen(true) }
                  : {})}
              />
            </>
          ) : null}

          {!activeInstancesQueryForTab.isLoading &&
          !activeInstancesQueryForTab.errorMessage &&
          instancesForTab.length > 0 ? (
            <div className="data-table-container">
              <table className="data-table" aria-label={t('instancesTable.ariaLabel')}>
                <thead>
                  <tr>
                    <th>
                      <button
                        type="button"
                        className="table-sort-trigger"
                        onClick={() => handleSort("employee")}
                      >
                        {t('instancesTable.employee')} {sortKey === "employee" ? (sortDirection === "asc" ? "↑" : "↓") : ""}
                      </button>
                    </th>
                    <th>{t('instancesTable.template')}</th>
                    <th>{t('instancesTable.type')}</th>
                    <th>{t('instancesTable.status')}</th>
                    <th>{t('instancesTable.progress')}</th>
                    <th>
                      <button
                        type="button"
                        className="table-sort-trigger"
                        onClick={() => handleSort("startedAt")}
                      >
                        {t('instancesTable.started')} {sortKey === "startedAt" ? (sortDirection === "asc" ? "↑" : "↓") : ""}
                      </button>
                    </th>
                    <th>{t('instancesTable.completed')}</th>
                    <th className="table-action-column">{t('instancesTable.actions')}</th>
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
                        <StatusBadge tone={toneForInstanceStatus(instance.status)}>
                          {toSentenceCase(instance.status)}
                        </StatusBadge>
                      </td>
                      <td className="numeric">
                        {instance.completedTasks}/{instance.totalTasks} ({instance.progressPercent}%)
                      </td>
                      <td>
                        <time
                          dateTime={instance.startedAt}
                          title={formatDateTimeTooltip(instance.startedAt, locale)}
                        >
                          {formatRelativeTime(instance.startedAt, locale)}
                        </time>
                      </td>
                      <td>
                        {instance.completedAt ? (
                          <time
                            dateTime={instance.completedAt}
                            title={formatDateTimeTooltip(instance.completedAt, locale)}
                          >
                            {formatRelativeTime(instance.completedAt, locale)}
                          </time>
                        ) : (
                          "--"
                        )}
                      </td>
                      <td className="table-row-action-cell">
                        <div className="onboarding-row-actions">
                          <Link className="table-row-action" href={`/onboarding/${instance.id}`}>
                            {t('actions.view')}
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

      {activeTab === "at_risk" ? (
        <>
          {atRiskQuery.isLoading ? <OnboardingTableSkeleton /> : null}

          {!atRiskQuery.isLoading && atRiskQuery.errorMessage ? (
            <EmptyState
              title={t('emptyState.atRiskUnavailable')}
              description={atRiskQuery.errorMessage}
              ctaLabel={tCommon('retry')}
              ctaHref="/onboarding"
            />
          ) : null}

          {!atRiskQuery.isLoading &&
          !atRiskQuery.errorMessage &&
          atRiskQuery.instances.length === 0 ? (
            <>
              <EmptyState
                title={t('emptyState.noAtRisk')}
                description={t('emptyState.noAtRiskDescription')}
                ctaLabel={t('emptyState.viewActive')}
                onCtaClick={() => setActiveTab("active")}
              />
            </>
          ) : null}

          {!atRiskQuery.isLoading &&
          !atRiskQuery.errorMessage &&
          atRiskQuery.instances.length > 0 ? (
            <div className="data-table-container">
              <table className="data-table" aria-label={t('atRiskTable.ariaLabel')}>
                <thead>
                  <tr>
                    <th>{t('atRiskTable.employee')}</th>
                    <th>{t('atRiskTable.daysInactive')}</th>
                    <th>{t('atRiskTable.progress')}</th>
                    <th>{t('atRiskTable.stuckTask')}</th>
                    <th>{t('atRiskTable.started')}</th>
                    <th className="table-action-column">{t('atRiskTable.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {atRiskQuery.instances.map((instance) => (
                    <tr key={instance.instanceId} className="data-table-row">
                      <td>{instance.employeeName}</td>
                      <td>
                        <span
                          className={
                            instance.daysSinceLastActivity >= 6
                              ? "at-risk-days-red"
                              : instance.daysSinceLastActivity >= 3
                                ? "at-risk-days-amber"
                                : ""
                          }
                        >
                          {tCommon('daysValue', { value: instance.daysSinceLastActivity })}
                        </span>
                      </td>
                      <td>
                        <span className="at-risk-progress">
                          {t('atRiskTable.taskCount', { completed: instance.completedTasks, total: instance.totalTasks })}
                        </span>
                      </td>
                      <td>
                        {instance.stuckTask ? (
                          <span title={t('atRiskTable.overdueTooltip', { days: instance.stuckTask.daysPastDue })}>
                            {instance.stuckTask.title}
                            <span className="at-risk-days-red"> {t('atRiskTable.overdue', { days: instance.stuckTask.daysPastDue })}</span>
                          </span>
                        ) : (
                          "--"
                        )}
                      </td>
                      <td>
                        <time
                          dateTime={instance.startedAt}
                          title={formatDateTimeTooltip(instance.startedAt, locale)}
                        >
                          {formatRelativeTime(instance.startedAt, locale)}
                        </time>
                      </td>
                      <td className="table-row-action-cell">
                        <div className="onboarding-row-actions">
                          <Link
                            className="table-row-action"
                            href={`/onboarding/${instance.instanceId}`}
                          >
                            {t('actions.view')}
                          </Link>
                          {canManageOnboarding ? (
                            <button
                              type="button"
                              className="table-row-action"
                              disabled={sendingReminderId === instance.instanceId}
                              onClick={() => handleSendReminder(instance)}
                            >
                              {sendingReminderId === instance.instanceId
                                ? t('actions.sending')
                                : t('actions.sendReminder')}
                            </button>
                          ) : null}
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
              title={t('emptyState.templateUnavailable')}
              description={templatesQuery.errorMessage}
              ctaLabel={tCommon('retry')}
              ctaHref="/onboarding"
            />
          ) : null}

          {!templatesQuery.isLoading &&
          !templatesQuery.errorMessage &&
          templatesQuery.templates.length === 0 ? (
            <>
              <EmptyState
                title={t('emptyState.noTemplates')}
                description={t('emptyState.noTemplatesDescription')}
                {...(canManageOnboarding
                  ? { ctaLabel: t('actions.createTemplate'), ctaHref: "/onboarding" }
                  : {})}
              />
              {canManageOnboarding ? (
                <button
                  type="button"
                  className="button"
                  onClick={() => setIsTemplatePanelOpen(true)}
                >
                  {t('actions.createTemplate')}
                </button>
              ) : null}
            </>
          ) : null}

          {!templatesQuery.isLoading &&
          !templatesQuery.errorMessage &&
          templatesQuery.templates.length > 0 ? (
            <>
              <div className="data-table-container">
                <table className="data-table" aria-label={t('templatesTable.ariaLabel')}>
                  <thead>
                    <tr>
                      <th>{t('templatesTable.name')}</th>
                      <th>{t('templatesTable.type')}</th>
                      <th>{t('templatesTable.country')}</th>
                      <th>{t('templatesTable.department')}</th>
                      <th>{t('templatesTable.tasks')}</th>
                      <th>{t('templatesTable.updated')}</th>
                      <th className="table-action-column">{t('templatesTable.actions')}</th>
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
                            <span>{countryNameFromCode(template.countryCode, locale)}</span>
                          </span>
                        </td>
                        <td>{template.department ?? "--"}</td>
                        <td className="numeric">{template.tasks.length}</td>
                        <td>
                          <time
                            dateTime={template.updatedAt}
                            title={formatDateTimeTooltip(template.updatedAt, locale)}
                          >
                            {formatRelativeTime(template.updatedAt, locale)}
                          </time>
                        </td>
                        <td className="table-row-action-cell">
                          <div className="onboarding-row-actions">
                            <button
                              type="button"
                              className="table-row-action"
                              onClick={() => setPreviewTemplateId(template.id)}
                            >
                              {t('actions.preview')}
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
                                {t('actions.start')}
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
                    <h2 className="section-title">{t('templatePreview.tasksHeading', { name: templatePreview.name })}</h2>
                    <p className="settings-card-description">
                      {t('templatePreview.taskCount', { count: templatePreview.tasks.length })}
                    </p>
                  </header>
                  <ul className="onboarding-template-task-list">
                    {templatePreview.tasks.map((task, index) => (
                      <li key={`${templatePreview.id}-task-${index}`} className="onboarding-template-task-item">
                        <div>
                          <p className="onboarding-template-task-title">{task.title}</p>
                          <p className="settings-card-description">{task.description}</p>
                          {task.actionUrl ? (
                            <p className="settings-card-description">
                              {t('templatePreview.action')}: {task.actionLabel ?? t('actions.openResource')} ({task.actionUrl})
                            </p>
                          ) : null}
                          {task.completionGuidance ? (
                            <p className="settings-card-description">
                              {t('templatePreview.completionGuidance')}: {task.completionGuidance}
                            </p>
                          ) : null}
                        </div>
                        <div className="onboarding-template-task-meta">
                          <StatusBadge tone="info">{toSentenceCase(task.category)}</StatusBadge>
                          <span className="numeric">
                            {task.dueOffsetDays === null
                              ? t('actions.noDueOffset')
                              : t('templatePreview.dueOffsetDays', { days: task.dueOffsetDays })}
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
        title={t('startPanel.title')}
        description={t('startPanel.description')}
        onClose={closeStartPanel}
      >
        <form className="slide-panel-form-wrapper" onSubmit={handleStartOnboarding} noValidate>
          <label className="form-field" htmlFor="onboarding-employee">
            <span className="form-label">{t('startPanel.employeeLabel')}</span>
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
              <option value="">{t('startPanel.selectEmployee')}</option>
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
            <span className="form-label">{t('startPanel.templateLabel')}</span>
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
              <option value="">{t('startPanel.selectTemplate')}</option>
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
            <span className="form-label">{t('startPanel.typeLabel')}</span>
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
            <span className="form-label">{t('startPanel.startDateLabel')}</span>
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
              {tCommon('cancel')}
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
              {isStartingOnboarding ? t('startPanel.starting') : t('actions.startOnboarding')}
            </button>
          </div>
        </form>
      </SlidePanel>

      <SlidePanel
        isOpen={isTemplatePanelOpen}
        title={t('createTemplatePanel.title')}
        description={t('createTemplatePanel.description')}
        onClose={closeTemplatePanel}
      >
        <form className="slide-panel-form-wrapper" onSubmit={handleCreateTemplate} noValidate>
          <label className="form-field" htmlFor="template-name">
            <span className="form-label">{t('createTemplatePanel.nameLabel')}</span>
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
            <span className="form-label">{t('createTemplatePanel.typeLabel')}</span>
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
            <span className="form-label">{t('createTemplatePanel.countryCodeLabel')}</span>
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
            <span className="form-label">{t('createTemplatePanel.departmentLabel')}</span>
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
              <h3 className="section-title">{t('createTemplatePanel.tasksHeading')}</h3>
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
                {t('createTemplatePanel.addTask')}
              </button>
            </div>

            {templateErrors.tasks ? <p className="form-field-error">{templateErrors.tasks}</p> : null}

            {templateValues.tasks.map((task, index) => {
              const taskErrors = templateErrors.taskErrors[index] ?? {};

              return (
                <article key={`template-task-${index}`} className="onboarding-template-editor-card">
                  <header className="onboarding-template-editor-card-header">
                    <p className="section-title">{t('createTemplatePanel.taskNumber', { number: index + 1 })}</p>
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
                      {t('createTemplatePanel.removeTask')}
                    </button>
                  </header>

                  <label className="form-field" htmlFor={`template-task-title-${index}`}>
                    <span className="form-label">{t('createTemplatePanel.taskTitleLabel')}</span>
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
                    <span className="form-label">{t('createTemplatePanel.taskDescriptionLabel')}</span>
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
                      <span className="form-label">{t('createTemplatePanel.taskCategoryLabel')}</span>
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
                      <span className="form-label">{t('createTemplatePanel.taskDueOffsetLabel')}</span>
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

                  <div className="onboarding-template-editor-grid">
                    <label className="form-field" htmlFor={`template-task-action_url-${index}`}>
                      <span className="form-label">{t('createTemplatePanel.taskActionUrlLabel')}</span>
                      <input
                        id={`template-task-action_url-${index}`}
                        name="action_url"
                        className={taskErrors.actionUrl ? "form-input form-input-error" : "form-input"}
                        value={task.actionUrl}
                        onChange={(event) =>
                          updateTemplateValues({
                            ...templateValues,
                            tasks: templateValues.tasks.map((currentTask, taskIndex) =>
                              taskIndex === index
                                ? { ...currentTask, actionUrl: event.currentTarget.value }
                                : currentTask
                            )
                          })
                        }
                        placeholder={t('createTemplatePanel.actionUrlPlaceholder')}
                      />
                      {taskErrors.actionUrl ? (
                        <p className="form-field-error">{taskErrors.actionUrl}</p>
                      ) : null}
                    </label>

                    <label className="form-field" htmlFor={`template-task-action_label-${index}`}>
                      <span className="form-label">{t('createTemplatePanel.taskActionLabelLabel')}</span>
                      <input
                        id={`template-task-action_label-${index}`}
                        name="action_label"
                        className={taskErrors.actionLabel ? "form-input form-input-error" : "form-input"}
                        value={task.actionLabel}
                        onChange={(event) =>
                          updateTemplateValues({
                            ...templateValues,
                            tasks: templateValues.tasks.map((currentTask, taskIndex) =>
                              taskIndex === index
                                ? { ...currentTask, actionLabel: event.currentTarget.value }
                                : currentTask
                            )
                          })
                        }
                        placeholder={t('createTemplatePanel.actionLabelPlaceholder')}
                      />
                      {taskErrors.actionLabel ? (
                        <p className="form-field-error">{taskErrors.actionLabel}</p>
                      ) : null}
                    </label>
                  </div>

                  <label className="form-field" htmlFor={`template-task-completion_guidance-${index}`}>
                    <span className="form-label">{t('createTemplatePanel.taskCompletionGuidanceLabel')}</span>
                    <textarea
                      id={`template-task-completion_guidance-${index}`}
                      name="completion_guidance"
                      className={taskErrors.completionGuidance ? "form-input form-input-error" : "form-input"}
                      rows={2}
                      value={task.completionGuidance}
                      onChange={(event) =>
                        updateTemplateValues({
                          ...templateValues,
                          tasks: templateValues.tasks.map((currentTask, taskIndex) =>
                            taskIndex === index
                              ? { ...currentTask, completionGuidance: event.currentTarget.value }
                              : currentTask
                          )
                        })
                      }
                      placeholder={t('createTemplatePanel.completionCriteriaPlaceholder')}
                    />
                    {taskErrors.completionGuidance ? (
                      <p className="form-field-error">{taskErrors.completionGuidance}</p>
                    ) : null}
                  </label>
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
              {tCommon('cancel')}
            </button>
            <button
              type="submit"
              className="button button-accent"
              disabled={isCreatingTemplate}
            >
              {isCreatingTemplate ? t('createTemplatePanel.creating') : t('actions.createTemplate')}
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
                aria-label={t('dismissNotification')}
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
