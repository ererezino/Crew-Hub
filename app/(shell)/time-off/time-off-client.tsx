"use client";

import { type ChangeEvent, type FormEvent, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { z } from "zod";

type AppLocale = "en" | "fr";

import { EmptyState } from "../../../components/shared/empty-state";
import { ContextualHelp } from "../../../components/shared/contextual-help";
import { ErrorState } from "../../../components/shared/error-state";
import { PageHeader } from "../../../components/shared/page-header";
import { SlidePanel } from "../../../components/shared/slide-panel";
import { StatusBadge } from "../../../components/shared/status-badge";
import { TeamAvailabilityPanel } from "../../../components/time-off/team-availability-panel";
import { useConfirmAction } from "../../../hooks/use-confirm-action";
import { useAfkLogs, useTimeOffSummary } from "../../../hooks/use-time-off";
import { countryFlagFromCode, countryNameFromCode } from "../../../lib/countries";
import {
  formatDays,
  formatDateRangeHuman,
  formatDateTimeTooltip,
  formatMonth,
  formatRelativeTime,
  formatSingleDateHuman,
  todayIsoDate
} from "../../../lib/datetime";
import { formatLeaveStatus } from "../../../lib/format-labels";
import {
  calculateWorkingDays,
  enumerateIsoDatesInRange,
  formatLeaveTypeLabel,
  getBirthdayLeaveOptions,
  getCurrentMonthKey,
  isoDateToUtcDate,
  isIsoDate,
  monthToDateRange
} from "../../../lib/time-off";
import type {
  LeaveBalance,
  LeaveRequestRecord,
  LeaveRequestStatus,
  TimeOffRequestMutationResponse
} from "../../../types/time-off";
import { AUTO_GRANTED_LEAVE_TYPES, UNLIMITED_LEAVE_TYPES } from "../../../types/time-off";
import { CalendarOff } from "lucide-react";
import { humanizeError } from "@/lib/errors";

type SortDirection = "asc" | "desc";
type ToastVariant = "success" | "error" | "info";

type ToastMessage = {
  id: string;
  message: string;
  variant: ToastVariant;
};

type RequestFormValues = {
  leaveType: string;
  startDate: string;
  endDate: string;
  reason: string;
};

type RequestFormField = keyof RequestFormValues;
type RequestFormErrors = Partial<Record<RequestFormField, string>>;
type RequestFormTouched = Record<RequestFormField, boolean>;

function buildRequestFormSchema(td: (key: string) => string) {
  return z.object({
    leaveType: z.string().trim().min(1, td("validation.leaveTypeRequired")),
    startDate: z
      .string()
      .min(1, td("validation.startDateRequired"))
      .refine((value) => isIsoDate(value), td("validation.startDateFormat")),
    endDate: z
      .string()
      .min(1, td("validation.endDateRequired"))
      .refine((value) => isIsoDate(value), td("validation.endDateFormat")),
    reason: z.string().trim().min(1, td("validation.reasonRequired")).max(2000, td("validation.reasonTooLong"))
  });
}

const INITIAL_FORM_VALUES: RequestFormValues = {
  leaveType: "",
  startDate: "",
  endDate: "",
  reason: ""
};

const INITIAL_FORM_TOUCHED: RequestFormTouched = {
  leaveType: false,
  startDate: false,
  endDate: false,
  reason: false
};

const ALL_FORM_TOUCHED: RequestFormTouched = {
  leaveType: true,
  startDate: true,
  endDate: true,
  reason: true
};

function buildContextualHelpItems(t: (key: string) => string) {
  return [
    {
      title: t("contextualHelp.workingDayTitle"),
      description: t("contextualHelp.workingDayDescription")
    },
    {
      title: t("contextualHelp.approvalTitle"),
      description: t("contextualHelp.approvalDescription")
    },
    {
      title: t("contextualHelp.teamCoverageTitle"),
      description: t("contextualHelp.teamCoverageDescription"),
      ctaLabel: t("contextualHelp.viewAvailability"),
      ctaHref: "/time-off?tab=calendar"
    },
    {
      title: t("contextualHelp.useItTitle"),
      description: t("contextualHelp.useItDescription")
    }
  ];
}

function createToastId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function hasFormErrors(errors: RequestFormErrors): boolean {
  return Boolean(errors.leaveType || errors.startDate || errors.endDate || errors.reason);
}

function getFormErrors(
  values: RequestFormValues,
  touched: RequestFormTouched,
  schema: z.ZodObject<z.ZodRawShape>,
  td: (key: string) => string
): RequestFormErrors {
  const parsed = schema.safeParse(values);
  const errors: RequestFormErrors = {};

  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors;
    errors.leaveType = touched.leaveType ? fieldErrors.leaveType?.[0] : undefined;
    errors.startDate = touched.startDate ? fieldErrors.startDate?.[0] : undefined;
    errors.endDate = touched.endDate ? fieldErrors.endDate?.[0] : undefined;
    errors.reason = touched.reason ? fieldErrors.reason?.[0] : undefined;
  }

  if (
    touched.endDate &&
    isIsoDate(values.startDate) &&
    isIsoDate(values.endDate) &&
    values.endDate < values.startDate
  ) {
    errors.endDate = td("validation.endDateAfterStart");
  }

  return errors;
}

function toneForRequestStatus(status: LeaveRequestStatus) {
  switch (status) {
    case "pending":
      return "pending" as const;
    case "approved":
      return "success" as const;
    case "rejected":
      return "error" as const;
    case "cancelled":
      return "warning" as const;
    default:
      return "draft" as const;
  }
}

function toneForBalance(balance: LeaveBalance) {
  const availableDays = balance.availableDays;

  if (availableDays <= 0) {
    return "error" as const;
  }

  if (availableDays <= balance.totalDays * 0.25) {
    return "warning" as const;
  }

  return "success" as const;
}

function shiftMonth(month: string, delta: number): string {
  const range = monthToDateRange(month);

  if (!range) {
    return getCurrentMonthKey();
  }

  const baseDate = isoDateToUtcDate(range.startDate);

  if (!baseDate) {
    return getCurrentMonthKey();
  }

  const shiftedDate = new Date(baseDate.getTime());
  shiftedDate.setUTCMonth(shiftedDate.getUTCMonth() + delta);

  const year = shiftedDate.getUTCFullYear();
  const monthValue = String(shiftedDate.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${monthValue}`;
}

function monthLabel(month: string, locale: AppLocale): string {
  const range = monthToDateRange(month);

  if (!range) {
    return month;
  }

  return formatMonth(range.startDate, locale);
}

type CalendarCell = {
  dateKey: string;
  dayNumber: number;
  isCurrentMonth: boolean;
};

function buildCalendarCells(month: string): CalendarCell[] {
  const range = monthToDateRange(month);

  if (!range) {
    return [];
  }

  const monthStart = isoDateToUtcDate(range.startDate);
  const monthEnd = isoDateToUtcDate(range.endDate);

  if (!monthStart || !monthEnd) {
    return [];
  }

  const monthStartDay = monthStart.getUTCDay();
  const gridStart = new Date(monthStart.getTime());
  gridStart.setUTCDate(gridStart.getUTCDate() - monthStartDay);

  const monthEndDay = monthEnd.getUTCDay();
  const trailingDays = 6 - monthEndDay;
  const gridEnd = new Date(monthEnd.getTime());
  gridEnd.setUTCDate(gridEnd.getUTCDate() + trailingDays);

  const cells: CalendarCell[] = [];
  const cursor = new Date(gridStart.getTime());

  while (cursor.getTime() <= gridEnd.getTime()) {
    const year = cursor.getUTCFullYear();
    const monthValue = String(cursor.getUTCMonth() + 1).padStart(2, "0");
    const day = String(cursor.getUTCDate()).padStart(2, "0");

    cells.push({
      dateKey: `${year}-${monthValue}-${day}`,
      dayNumber: cursor.getUTCDate(),
      isCurrentMonth: cursor.getUTCMonth() === monthStart.getUTCMonth()
    });

    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return cells;
}

function TimeOffSkeleton() {
  return (
    <section className="timeoff-skeleton-layout" aria-hidden="true">
      <div className="timeoff-balance-skeleton-grid">
        {Array.from({ length: 3 }, (_, index) => (
          <div key={`timeoff-balance-skeleton-${index}`} className="timeoff-balance-skeleton-card" />
        ))}
      </div>
      <div className="table-skeleton">
        <div className="table-skeleton-header" />
        {Array.from({ length: 6 }, (_, index) => (
          <div key={`timeoff-row-skeleton-${index}`} className="table-skeleton-row" />
        ))}
      </div>
      <div className="timeoff-calendar-skeleton" />
    </section>
  );
}

export function TimeOffClient({ embedded = false }: { embedded?: boolean }) {
  const t = useTranslations('timeOff');
  const tCommon = useTranslations('common');
  const locale = useLocale() as AppLocale;
  const td = t as (key: string, params?: Record<string, unknown>) => string;

  const requestFormSchema = useMemo(() => buildRequestFormSchema(td), [td]);
  const contextualHelpItems = useMemo(() => buildContextualHelpItems(td), [td]);

  const [activeMonth, setActiveMonth] = useState(getCurrentMonthKey());
  const [requestSortDirection, setRequestSortDirection] = useState<SortDirection>("desc");
  const [isRequestPanelOpen, setIsRequestPanelOpen] = useState(false);
  const [formValues, setFormValues] = useState<RequestFormValues>(INITIAL_FORM_VALUES);
  const [formTouched, setFormTouched] = useState<RequestFormTouched>(INITIAL_FORM_TOUCHED);
  const [formErrors, setFormErrors] = useState<RequestFormErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCancellingRequestId, setIsCancellingRequestId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [isAfkPanelOpen, setIsAfkPanelOpen] = useState(false);
  const [afkDate, setAfkDate] = useState("");
  const [afkStartTime, setAfkStartTime] = useState("");
  const [afkEndTime, setAfkEndTime] = useState("");
  const [afkNotes, setAfkNotes] = useState("");
  const [isAfkSubmitting, setIsAfkSubmitting] = useState(false);
  const { confirm, confirmDialog } = useConfirmAction();

  const afkQuery = useAfkLogs();

  const summaryQuery = useTimeOffSummary({
    month: activeMonth,
    year: Number.parseInt(activeMonth.slice(0, 4), 10)
  });

  const availableLeaveTypes = useMemo(() => {
    const policyTypes = summaryQuery.data?.policies.map((policy) => policy.leaveType) ?? [];
    const balanceTypes = summaryQuery.data?.balances.map((balance) => balance.leaveType) ?? [];
    return [...new Set([...policyTypes, ...balanceTypes])]
      .filter((leaveType) => !AUTO_GRANTED_LEAVE_TYPES.has(leaveType))
      .sort((leftValue, rightValue) => leftValue.localeCompare(rightValue));
  }, [summaryQuery.data?.balances, summaryQuery.data?.policies]);

  const isSelectedTypeUnlimited = useMemo(() => {
    if (!formValues.leaveType) return false;
    const policy = summaryQuery.data?.policies.find((p) => p.leaveType === formValues.leaveType);
    return policy?.isUnlimited || UNLIMITED_LEAVE_TYPES.has(formValues.leaveType);
  }, [formValues.leaveType, summaryQuery.data?.policies]);

  const selectedLeaveBalance = useMemo(
    () =>
      summaryQuery.data?.balances.find((balance) => balance.leaveType === formValues.leaveType) ??
      null,
    [formValues.leaveType, summaryQuery.data?.balances]
  );

  const holidayDateKeys = useMemo(
    () => new Set(summaryQuery.data?.holidays.map((holiday) => holiday.date) ?? []),
    [summaryQuery.data?.holidays]
  );

  const calculatedWorkingDays = useMemo(() => {
    if (!isIsoDate(formValues.startDate) || !isIsoDate(formValues.endDate)) {
      return 0;
    }

    return calculateWorkingDays(formValues.startDate, formValues.endDate, holidayDateKeys);
  }, [formValues.endDate, formValues.startDate, holidayDateKeys]);

  const balanceWarning = useMemo(() => {
    if (isSelectedTypeUnlimited) return null;
    if (!selectedLeaveBalance || calculatedWorkingDays <= 0) {
      return null;
    }

    if (calculatedWorkingDays <= selectedLeaveBalance.availableDays) {
      return null;
    }

    return td("requestPanel.balanceWarning", { requested: calculatedWorkingDays, available: selectedLeaveBalance.availableDays });
  }, [calculatedWorkingDays, isSelectedTypeUnlimited, selectedLeaveBalance, td]);

  const sortedRequests = useMemo(() => {
    const requests = summaryQuery.data?.requests ?? [];
    return [...requests].sort((leftRequest, rightRequest) => {
      const leftValue = Date.parse(`${leftRequest.startDate}T00:00:00.000Z`);
      const rightValue = Date.parse(`${rightRequest.startDate}T00:00:00.000Z`);

      return requestSortDirection === "asc"
        ? leftValue - rightValue
        : rightValue - leftValue;
    });
  }, [requestSortDirection, summaryQuery.data?.requests]);

  const calendarCells = useMemo(() => buildCalendarCells(activeMonth), [activeMonth]);

  const holidayMapByDate = useMemo(() => {
    const map = new Map<string, string[]>();

    for (const holiday of summaryQuery.data?.holidays ?? []) {
      const existingHolidays = map.get(holiday.date) ?? [];
      existingHolidays.push(holiday.name);
      map.set(holiday.date, existingHolidays);
    }

    return map;
  }, [summaryQuery.data?.holidays]);

  const requestStatusByDate = useMemo(() => {
    const map = new Map<string, LeaveRequestStatus[]>();
    const monthRange = monthToDateRange(activeMonth);

    if (!monthRange) {
      return map;
    }

    for (const request of summaryQuery.data?.requests ?? []) {
      const rangeStart =
        request.startDate > monthRange.startDate ? request.startDate : monthRange.startDate;
      const rangeEnd =
        request.endDate < monthRange.endDate ? request.endDate : monthRange.endDate;

      if (rangeStart > rangeEnd) {
        continue;
      }

      for (const dateKey of enumerateIsoDatesInRange(rangeStart, rangeEnd)) {
        const statuses = map.get(dateKey) ?? [];
        statuses.push(request.status);
        map.set(dateKey, statuses);
      }
    }

    return map;
  }, [activeMonth, summaryQuery.data?.requests]);

  const dismissToast = (toastId: string) => {
    setToasts((currentToasts) => currentToasts.filter((toast) => toast.id !== toastId));
  };

  const showToast = (variant: ToastVariant, rawMessage: string) => {
    const message = variant === "error" ? humanizeError(rawMessage) : rawMessage;
    const toastId = createToastId();
    setToasts((currentToasts) => [...currentToasts, { id: toastId, variant, message }]);

    window.setTimeout(() => {
      dismissToast(toastId);
    }, 4000);
  };

  const birthdayChoiceInfo = useMemo(() => {
    const profile = summaryQuery.data?.profile;
    if (!profile?.dateOfBirth) return null;

    const currentYear = new Date().getUTCFullYear();
    const options = getBirthdayLeaveOptions(profile.dateOfBirth, currentYear, holidayDateKeys);

    if (!options.needsChoice) return null;

    const existingBirthdayRequest = (summaryQuery.data?.requests ?? []).find(
      (r) => r.leaveType === "birthday_leave" && r.startDate.startsWith(String(currentYear))
    );

    if (existingBirthdayRequest) return null;

    return options;
  }, [summaryQuery.data?.profile, summaryQuery.data?.requests, holidayDateKeys]);

  const [isBirthdayChoosing, setIsBirthdayChoosing] = useState(false);

  const handleBirthdayChoice = async (chosenDate: string) => {
    setIsBirthdayChoosing(true);

    try {
      const response = await fetch("/api/v1/time-off/birthday-choice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chosenDate })
      });

      const payload = await response.json();

      if (!response.ok) {
        showToast("error", payload.error?.message ?? td("toast.unableToSelectBirthday"));
        return;
      }

      summaryQuery.refresh();
      showToast("success", td("toast.birthdaySelected"));
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : td("toast.unableToSelectBirthday"));
    } finally {
      setIsBirthdayChoosing(false);
    }
  };

  const afkDurationMinutes = useMemo(() => {
    if (!afkStartTime || !afkEndTime) return 0;
    const [sh, sm] = afkStartTime.split(":").map(Number);
    const [eh, em] = afkEndTime.split(":").map(Number);
    const start = (sh ?? 0) * 60 + (sm ?? 0);
    const end = (eh ?? 0) * 60 + (em ?? 0);
    return end > start ? end - start : 0;
  }, [afkStartTime, afkEndTime]);

  const openAfkPanel = () => {
    setAfkDate(todayIsoDate());
    setAfkStartTime("");
    setAfkEndTime("");
    setAfkNotes("");
    setIsAfkPanelOpen(true);
  };

  const closeAfkPanel = () => {
    setIsAfkPanelOpen(false);
    setAfkDate("");
    setAfkStartTime("");
    setAfkEndTime("");
    setAfkNotes("");
  };

  const handleSubmitAfk = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!afkDate || !afkStartTime || !afkEndTime) {
      showToast("error", td("validation.afkFieldsRequired"));
      return;
    }

    setIsAfkSubmitting(true);

    try {
      const response = await fetch("/api/v1/time-off/afk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: afkDate,
          startTime: afkStartTime,
          endTime: afkEndTime,
          notes: afkNotes.trim()
        })
      });

      const payload = await response.json();

      if (!response.ok) {
        showToast("error", payload.error?.message ?? td("toast.unableToLogAfk"));
        return;
      }

      closeAfkPanel();
      afkQuery.refresh();
      summaryQuery.refresh();
      showToast("success", afkDurationMinutes > 120
        ? td("toast.afkReclassified")
        : td("toast.afkLogged"));
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : td("toast.unableToLogAfk"));
    } finally {
      setIsAfkSubmitting(false);
    }
  };

  const openRequestPanel = () => {
    setFormValues({
      ...INITIAL_FORM_VALUES,
      leaveType: availableLeaveTypes[0] ?? ""
    });
    setFormTouched(INITIAL_FORM_TOUCHED);
    setFormErrors({});
    setSubmitError(null);
    setIsRequestPanelOpen(true);
  };

  const closeRequestPanel = () => {
    setIsRequestPanelOpen(false);
    setFormValues(INITIAL_FORM_VALUES);
    setFormTouched(INITIAL_FORM_TOUCHED);
    setFormErrors({});
    setSubmitError(null);
  };

  const handleFieldChange =
    (field: RequestFormField) =>
    (event: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
      const nextValues = {
        ...formValues,
        [field]: event.currentTarget.value
      };

      setFormValues(nextValues);

      if (formTouched[field]) {
        setFormErrors(getFormErrors(nextValues, formTouched, requestFormSchema, td));
      }

      if (submitError) {
        setSubmitError(null);
      }
    };

  const handleFieldBlur = (field: RequestFormField) => () => {
    const nextTouched = {
      ...formTouched,
      [field]: true
    };

    setFormTouched(nextTouched);
    setFormErrors(getFormErrors(formValues, nextTouched, requestFormSchema, td));
  };

  const handleSubmitRequest = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    setFormTouched(ALL_FORM_TOUCHED);
    const nextErrors = getFormErrors(formValues, ALL_FORM_TOUCHED, requestFormSchema, td);
    setFormErrors(nextErrors);
    setSubmitError(null);

    if (hasFormErrors(nextErrors)) {
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch("/api/v1/time-off/requests", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          leaveType: formValues.leaveType.trim(),
          startDate: formValues.startDate,
          endDate: formValues.endDate,
          reason: formValues.reason.trim()
        })
      });

      const payload = (await response.json()) as TimeOffRequestMutationResponse;

      if (!response.ok || !payload.data?.request) {
        const message = payload.error?.message ?? td("toast.unableToSubmitLeave");
        setSubmitError(message);
        showToast("error", message);
        return;
      }

      closeRequestPanel();
      summaryQuery.refresh();
      showToast("success", td("toast.leaveRequestSubmitted"));
    } catch (error) {
      const message = error instanceof Error ? error.message : td("toast.unableToSubmitLeave");
      setSubmitError(message);
      showToast("error", message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancelRequest = async (requestRecord: LeaveRequestRecord) => {
    const shouldCancel = await confirm({
      title: td("cancelDialog.title"),
      description: td("cancelDialog.description"),
      confirmLabel: td("cancelDialog.confirmLabel"),
      tone: "danger"
    });

    if (!shouldCancel) {
      return;
    }

    setIsCancellingRequestId(requestRecord.id);

    try {
      const response = await fetch(`/api/v1/time-off/requests/${requestRecord.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          action: "cancel"
        })
      });

      const payload = (await response.json()) as TimeOffRequestMutationResponse;

      if (!response.ok || !payload.data?.request) {
        showToast("error", payload.error?.message ?? td("toast.unableToCancelLeave"));
        return;
      }

      summaryQuery.refresh();
      showToast("info", td("toast.leaveRequestCancelled"));
    } catch (error) {
      showToast(
        "error",
        error instanceof Error ? error.message : td("toast.unableToCancelLeave")
      );
    } finally {
      setIsCancellingRequestId(null);
    }
  };

  if (summaryQuery.isLoading) {
    return (
      <>
        {!embedded ? (
          <PageHeader
            title={t('title')}
            description={t('description')}
          />
        ) : null}
        <TimeOffSkeleton />
      </>
    );
  }

  if (summaryQuery.errorMessage || !summaryQuery.data) {
    return (
      <>
        {!embedded ? (
          <PageHeader
            title={t('title')}
            description={t('description')}
          />
        ) : null}
        <ErrorState
          title={t('errorTitle')}
          message={summaryQuery.errorMessage ?? td('errorDefault')}
          onRetry={summaryQuery.refresh}
        />
      </>
    );
  }

  return (
    <>
      {!embedded ? (
        <PageHeader
          title={t('title')}
          description={t('description')}
        />
      ) : null}

      <ContextualHelp
        title={t('contextualHelp.title')}
        description={t('contextualHelp.description')}
        items={contextualHelpItems}
        ariaLabel={td('contextualHelp.title')}
      />

      <section className="timeoff-balance-grid" aria-label={td('title')}>
        {/* Unlimited leave type cards (e.g. sick leave) */}
        {(summaryQuery.data.policies ?? [])
          .filter((p) => p.isUnlimited)
          .map((policy) => {
            const usedRequests = (summaryQuery.data?.requests ?? []).filter(
              (r) => r.leaveType === policy.leaveType && (r.status === "approved" || r.status === "pending")
            );
            const usedDays = usedRequests.reduce((sum, r) => sum + r.totalDays, 0);

            return (
              <article key={policy.id} className="timeoff-balance-card">
                <header className="timeoff-balance-card-header">
                  <h2 className="section-title">{formatLeaveTypeLabel(policy.leaveType, locale)}</h2>
                  <StatusBadge tone="processing">{t('balances.unlimited')}</StatusBadge>
                </header>
                <div className="timeoff-balance-metric numeric">{t('balances.unlimited')}</div>
                <p className="settings-card-description">
                  {usedDays > 0 ? td('balances.daysUsedThisYear', { days: formatDays(usedDays, locale) }) : t('balances.noDaysUsed')}
                </p>
                <p className="settings-card-description">
                  {t('balances.doctorsNote')}
                </p>
              </article>
            );
          })}

        {/* Standard balance cards */}
        {summaryQuery.data.balances.length === 0 && summaryQuery.data.policies.filter((p) => p.isUnlimited).length === 0 ? (
          <EmptyState
            title={t('balances.emptyTitle')}
            description={t('balances.emptyDescription')}
          />
        ) : (
          summaryQuery.data.balances.map((balance) => {
            const scheduledDays = balance.pendingDays;
            const available = balance.totalDays - balance.usedDays - scheduledDays;

            return (
              <article key={balance.id} className="timeoff-balance-card">
                <header className="timeoff-balance-card-header">
                  <h2 className="section-title">{formatLeaveTypeLabel(balance.leaveType, locale)}</h2>
                  <StatusBadge tone={toneForBalance(balance)}>
                    {available > 0 ? t('balances.available') : t('balances.depleted')}
                  </StatusBadge>
                </header>
                <div className="timeoff-balance-metric numeric">
                  {td('balances.daysLabel', { days: formatDays(available, locale) })}
                </div>
                <p className="settings-card-description">
                  {td('balances.balanceExpiry', { year: balance.year })}
                </p>
                <dl className="timeoff-balance-breakdown">
                  <div>
                    <dt>{t('balances.allocated')}</dt>
                    <dd className="numeric">{formatDays(balance.totalDays, locale)}</dd>
                  </div>
                  <div>
                    <dt>{t('balances.used')}</dt>
                    <dd className="numeric">{formatDays(balance.usedDays, locale)}</dd>
                  </div>
                  {scheduledDays > 0 ? (
                    <div>
                      <dt>{t('balances.scheduled')}</dt>
                      <dd className="numeric">{formatDays(scheduledDays, locale)}</dd>
                    </div>
                  ) : null}
                </dl>
              </article>
            );
          })
        )}
      </section>

      {/* Birthday choice banner */}
      {birthdayChoiceInfo ? (
        <section className="settings-card" aria-label={td('birthdayLeave.title')}>
          <header className="timeoff-section-header">
            <h2 className="section-title">{t('birthdayLeave.title')}</h2>
            <StatusBadge tone="pending">{t('birthdayLeave.actionRequired')}</StatusBadge>
          </header>
          <p className="settings-card-description">
            {td('birthdayLeave.choiceDescription', { date: formatSingleDateHuman(birthdayChoiceInfo.birthdayDate, locale) })}
          </p>
          <div className="timeoff-row-actions" style={{ marginTop: "var(--spacing-sm)" }}>
            {birthdayChoiceInfo.options.map((dateOption) => (
              <button
                key={dateOption}
                type="button"
                className="button"
                disabled={isBirthdayChoosing}
                onClick={() => handleBirthdayChoice(dateOption)}
              >
                {formatSingleDateHuman(dateOption, locale)}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {/* Probation notice */}
      {summaryQuery.data.profile.status === "onboarding" ? (
        <section className="settings-card" aria-label={td('probation.notice')}>
          <p className="settings-card-description">
            {t('probation.notice')}
          </p>
        </section>
      ) : null}

      <section className="settings-card" aria-label={td('requests.title')}>
        <header className="timeoff-section-header">
          <h2 className="section-title">{t('requests.title')}</h2>
          <div className="documents-row-actions" style={{ opacity: 1, transform: "none", pointerEvents: "auto" }}>
            <button type="button" className="button button-accent" onClick={openRequestPanel}>
              {t('requests.requestTimeOff')}
            </button>
            <button type="button" className="button" onClick={openAfkPanel}>
              {t('requests.logAfk')}
            </button>
            <button
              type="button"
              className="table-sort-trigger"
              onClick={() =>
                setRequestSortDirection((currentDirection) =>
                  currentDirection === "asc" ? "desc" : "asc"
                )
              }
            >
              {t('requests.startDateSort')} {requestSortDirection === "asc" ? "↑" : "↓"}
            </button>
          </div>
        </header>

        {sortedRequests.length === 0 ? (
          <EmptyState
            icon={<CalendarOff size={32} />}
            title={t('requests.emptyTitle')}
            description={t('requests.emptyDescription')}
            ctaLabel={t('requests.requestTimeOffCta')}
            ctaHref="/time-off"
          />
        ) : (
          <div className="data-table-container">
            <table className="data-table" aria-label={td('requests.title')}>
              <thead>
                <tr>
                  <th>{t('requestTable.leaveType')}</th>
                  <th>{t('requestTable.dateRange')}</th>
                  <th>{t('requestTable.days')}</th>
                  <th>{t('requestTable.status')}</th>
                  <th>{t('requestTable.approver')}</th>
                  <th>{t('requestTable.submitted')}</th>
                  <th className="table-action-column">{t('requestTable.actionsColumn')}</th>
                </tr>
              </thead>
              <tbody>
                {sortedRequests.flatMap((requestRecord) => {
                  const rows = [
                    <tr key={requestRecord.id} className="data-table-row">
                      <td>{formatLeaveTypeLabel(requestRecord.leaveType, locale)}</td>
                      <td>
                        <time
                          dateTime={requestRecord.startDate}
                          title={formatDateTimeTooltip(requestRecord.startDate, locale)}
                        >
                          {formatDateRangeHuman(requestRecord.startDate, requestRecord.endDate, locale)}
                        </time>
                      </td>
                      <td className="numeric">{formatDays(requestRecord.totalDays, locale)}</td>
                      <td>
                        <StatusBadge tone={toneForRequestStatus(requestRecord.status)}>
                          {formatLeaveStatus(requestRecord.status, locale)}
                        </StatusBadge>
                      </td>
                      <td>{requestRecord.approverName ?? "--"}</td>
                      <td>
                        <time
                          dateTime={requestRecord.createdAt}
                          title={formatDateTimeTooltip(requestRecord.createdAt, locale)}
                        >
                          {formatRelativeTime(requestRecord.createdAt, locale)}
                        </time>
                      </td>
                      <td className="table-row-action-cell">
                        <div className="timeoff-row-actions">
                          {requestRecord.status === "pending" ? (
                            <button
                              type="button"
                              className="table-row-action"
                              onClick={() => handleCancelRequest(requestRecord)}
                              disabled={isCancellingRequestId === requestRecord.id}
                            >
                              {isCancellingRequestId === requestRecord.id ? t('requests.cancelling') : tCommon('cancel')}
                            </button>
                          ) : (
                            <span className="settings-card-description">{t('requests.noActions')}</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ];

                  if (requestRecord.status === "rejected" && requestRecord.rejectionReason) {
                    rows.push(
                      <tr key={`${requestRecord.id}-rejection`} className="rejection-callout-row">
                        <td colSpan={7}>
                          <div className="rejection-callout rejection-callout-inline">
                            <p><strong>{t('requestPanel.reasonLabel')}:</strong> {requestRecord.rejectionReason}</p>
                          </div>
                        </td>
                      </tr>
                    );
                  }

                  return rows;
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="settings-card" aria-label={td('calendar.title')}>
        <header className="timeoff-section-header">
          <h2 className="section-title">{t('calendar.title')}</h2>
          <div className="timeoff-month-controls">
            <button
              type="button"
              className="button"
              onClick={() => setActiveMonth((currentMonth) => shiftMonth(currentMonth, -1))}
            >
              {t('calendar.previous')}
            </button>
            <p className="numeric">{monthLabel(activeMonth, locale)}</p>
            <button
              type="button"
              className="button"
              onClick={() => setActiveMonth((currentMonth) => shiftMonth(currentMonth, 1))}
            >
              {t('calendar.next')}
            </button>
          </div>
        </header>

        <div className="timeoff-mini-calendar">
          {(["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const).map((dayKey) => (
            <p key={dayKey} className="timeoff-calendar-weekday">
              {t(`weekdays.${dayKey}`)}
            </p>
          ))}
          {calendarCells.map((cell) => {
            const holidays = holidayMapByDate.get(cell.dateKey) ?? [];
            const statuses = requestStatusByDate.get(cell.dateKey) ?? [];
            const hasApproved = statuses.includes("approved");
            const hasPending = statuses.includes("pending");
            const isHoliday = holidays.length > 0;

            const className = [
              "timeoff-calendar-day",
              cell.isCurrentMonth ? "timeoff-calendar-day-current" : "timeoff-calendar-day-muted",
              hasApproved ? "timeoff-calendar-day-approved" : "",
              hasPending ? "timeoff-calendar-day-pending" : "",
              isHoliday ? "timeoff-calendar-day-holiday" : ""
            ]
              .filter(Boolean)
              .join(" ");

            return (
              <article key={cell.dateKey} className={className} title={isHoliday ? holidays.join(", ") : undefined}>
                <p className="numeric">{cell.dayNumber}</p>
                <span className="timeoff-calendar-dots">
                  {hasApproved ? <span className="timeoff-calendar-badge timeoff-calendar-badge-approved" /> : null}
                  {hasPending ? <span className="timeoff-calendar-badge timeoff-calendar-badge-pending" /> : null}
                  {isHoliday ? <span className="timeoff-calendar-badge timeoff-calendar-badge-holiday" /> : null}
                </span>
              </article>
            );
          })}
        </div>

        <div className="timeoff-calendar-legend">
          <div className="timeoff-calendar-legend-item">
            <span className="timeoff-calendar-badge timeoff-calendar-badge-approved" />
            <span>{t('calendar.legendLeave')}</span>
          </div>
          <div className="timeoff-calendar-legend-item">
            <span className="timeoff-calendar-badge timeoff-calendar-badge-holiday" />
            <span>{t('calendar.legendHoliday')}</span>
          </div>
          <div className="timeoff-calendar-legend-item">
            <span className="timeoff-calendar-badge timeoff-calendar-badge-pending" />
            <span>{t('calendar.legendPending')}</span>
          </div>
        </div>

        <div className="timeoff-country-summary">
          <span>{countryFlagFromCode(summaryQuery.data.profile.countryCode)}</span>
          <span>{countryNameFromCode(summaryQuery.data.profile.countryCode, locale)}</span>
        </div>
      </section>

      <section className="settings-card" aria-label={td('afk.title')}>
        <header className="timeoff-section-header">
          <h2 className="section-title">{t('afk.title')}</h2>
          {afkQuery.data ? (
            <p className="settings-card-description">
              {td('afk.weeklyUsage', { used: afkQuery.data.weeklyCount, limit: afkQuery.data.weeklyLimit })}
            </p>
          ) : null}
        </header>

        {afkQuery.isLoading ? (
          <div className="table-skeleton">
            <div className="table-skeleton-header" />
            {Array.from({ length: 2 }, (_, index) => (
              <div key={`afk-skeleton-${index}`} className="table-skeleton-row" />
            ))}
          </div>
        ) : afkQuery.data && afkQuery.data.logs.length > 0 ? (
          <div className="data-table-container">
            <table className="data-table" aria-label={td('afk.title')}>
              <thead>
                <tr>
                  <th>{t('afkTable.date')}</th>
                  <th>{t('afkTable.time')}</th>
                  <th>{t('afkTable.duration')}</th>
                  <th>{t('afkTable.status')}</th>
                  <th>{t('afkTable.notes')}</th>
                </tr>
              </thead>
              <tbody>
                {afkQuery.data.logs.map((log) => (
                  <tr key={log.id} className="data-table-row">
                    <td>{formatSingleDateHuman(log.date, locale)}</td>
                    <td className="numeric">{log.startTime} – {log.endTime}</td>
                    <td className="numeric">
                      {log.durationMinutes >= 60
                        ? `${Math.floor(log.durationMinutes / 60)}h ${log.durationMinutes % 60}m`
                        : `${log.durationMinutes}m`}
                    </td>
                    <td>
                      {log.reclassifiedAs ? (
                        <StatusBadge tone="warning">{t('afk.reclassified')}</StatusBadge>
                      ) : (
                        <StatusBadge tone="success">{t('afk.logged')}</StatusBadge>
                      )}
                    </td>
                    <td>{log.notes || "--"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title={t('afk.emptyTitle')}
            description={t('afk.emptyDescription')}
            ctaLabel={t('afk.logAfkCta')}
            ctaHref="/time-off"
          />
        )}
      </section>

      <SlidePanel
        isOpen={isRequestPanelOpen}
        title={t('requestPanel.title')}
        description={t('requestPanel.description')}
        onClose={closeRequestPanel}
      >
        <form className="slide-panel-form-wrapper" onSubmit={handleSubmitRequest} noValidate>
          <label className="form-field" htmlFor="timeoff-leave-type">
            <span className="form-label">{t('requestPanel.leaveTypeLabel')}</span>
            <select
              id="timeoff-leave-type"
              className={formErrors.leaveType ? "form-input form-input-error" : "form-input"}
              value={formValues.leaveType}
              onChange={handleFieldChange("leaveType")}
              onBlur={handleFieldBlur("leaveType")}
            >
              <option value="">{t('requestPanel.selectLeaveType')}</option>
              {availableLeaveTypes.map((leaveType) => (
                <option key={leaveType} value={leaveType}>
                  {formatLeaveTypeLabel(leaveType, locale)}
                </option>
              ))}
            </select>
            {formErrors.leaveType ? <p className="form-field-error">{formErrors.leaveType}</p> : null}
          </label>

          <div className="timeoff-form-grid">
            <label className="form-field" htmlFor="timeoff-start-date">
              <span className="form-label">{t('requestPanel.startDate')}</span>
              <input
                id="timeoff-start-date"
                type="date"
                className={formErrors.startDate ? "form-input form-input-error" : "form-input"}
                value={formValues.startDate}
                onChange={handleFieldChange("startDate")}
                onBlur={handleFieldBlur("startDate")}
              />
              {formErrors.startDate ? <p className="form-field-error">{formErrors.startDate}</p> : null}
            </label>

            <label className="form-field" htmlFor="timeoff-end-date">
              <span className="form-label">{t('requestPanel.endDate')}</span>
              <input
                id="timeoff-end-date"
                type="date"
                className={formErrors.endDate ? "form-input form-input-error" : "form-input"}
                value={formValues.endDate}
                onChange={handleFieldChange("endDate")}
                onBlur={handleFieldBlur("endDate")}
              />
              {formErrors.endDate ? <p className="form-field-error">{formErrors.endDate}</p> : null}
            </label>
          </div>

          {isIsoDate(formValues.startDate) && isIsoDate(formValues.endDate) && formValues.endDate >= formValues.startDate ? (
            <TeamAvailabilityPanel startDate={formValues.startDate} endDate={formValues.endDate} />
          ) : null}

          <label className="form-field" htmlFor="timeoff-reason">
            <span className="form-label">{t('requestPanel.reasonLabel')}</span>
            <textarea
              id="timeoff-reason"
              rows={4}
              className={formErrors.reason ? "form-input form-input-error" : "form-input"}
              value={formValues.reason}
              onChange={handleFieldChange("reason")}
              onBlur={handleFieldBlur("reason")}
            />
            {formErrors.reason ? <p className="form-field-error">{formErrors.reason}</p> : null}
          </label>

          <section className="timeoff-request-summary">
            <p>
              {t('requestPanel.workingDays')}: <span className="numeric">{formatDays(calculatedWorkingDays, locale)}</span>
            </p>
            {isSelectedTypeUnlimited ? (
              <p className="settings-card-description">{t('requestPanel.unlimitedBalance')}</p>
            ) : selectedLeaveBalance ? (
              <p>
                {t('requestPanel.availableBalance')}:{" "}
                <span className="numeric">{formatDays(selectedLeaveBalance.availableDays, locale)}</span>
              </p>
            ) : null}
            {balanceWarning ? <p className="form-field-error">{balanceWarning}</p> : null}
            {formValues.leaveType === "sick_leave" && calculatedWorkingDays > 2 ? (
              <p className="settings-card-description">
                {t('requestPanel.sickLeaveNote')}
              </p>
            ) : null}
          </section>

          {submitError ? <p className="form-submit-error">{submitError}</p> : null}

          <div className="slide-panel-actions">
            <button type="button" className="button" onClick={closeRequestPanel}>
              {tCommon('cancel')}
            </button>
            <button type="submit" className="button button-accent" disabled={isSubmitting}>
              {isSubmitting ? t('requestPanel.submitting') : t('requestPanel.submitRequest')}
            </button>
          </div>
        </form>
      </SlidePanel>

      <SlidePanel
        isOpen={isAfkPanelOpen}
        title={t('afkPanel.title')}
        description={t('afkPanel.description')}
        onClose={closeAfkPanel}
      >
        <form className="slide-panel-form-wrapper" onSubmit={handleSubmitAfk} noValidate>
          <label className="form-field" htmlFor="afk-date">
            <span className="form-label">{t('afkPanel.dateLabel')}</span>
            <input
              id="afk-date"
              type="date"
              className="form-input"
              value={afkDate}
              onChange={(event) => setAfkDate(event.currentTarget.value)}
            />
          </label>

          <div className="timeoff-form-grid">
            <label className="form-field" htmlFor="afk-start-time">
              <span className="form-label">{t('afkPanel.startTime')}</span>
              <input
                id="afk-start-time"
                type="time"
                className="form-input"
                value={afkStartTime}
                onChange={(event) => setAfkStartTime(event.currentTarget.value)}
              />
            </label>

            <label className="form-field" htmlFor="afk-end-time">
              <span className="form-label">{t('afkPanel.endTime')}</span>
              <input
                id="afk-end-time"
                type="time"
                className="form-input"
                value={afkEndTime}
                onChange={(event) => setAfkEndTime(event.currentTarget.value)}
              />
            </label>
          </div>

          <label className="form-field" htmlFor="afk-notes">
            <span className="form-label">{t('afkPanel.notesLabel')}</span>
            <textarea
              id="afk-notes"
              rows={3}
              className="form-input"
              value={afkNotes}
              onChange={(event) => setAfkNotes(event.currentTarget.value)}
              maxLength={500}
            />
          </label>

          <section className="timeoff-request-summary">
            {afkDurationMinutes > 0 ? (
              <p>
                {t('afkPanel.duration')}:{" "}
                <span className="numeric">
                  {afkDurationMinutes >= 60
                    ? `${Math.floor(afkDurationMinutes / 60)}h ${afkDurationMinutes % 60}m`
                    : `${afkDurationMinutes}m`}
                </span>
              </p>
            ) : null}
            {afkDurationMinutes > 120 ? (
              <p className="form-field-error">
                {t('afkPanel.reclassifyWarning')}
              </p>
            ) : null}
            {afkQuery.data ? (
              <p className="settings-card-description">
                {td('afkPanel.weeklyUsage', { used: afkQuery.data.weeklyCount, limit: afkQuery.data.weeklyLimit })}
              </p>
            ) : null}
          </section>

          <div className="slide-panel-actions">
            <button type="button" className="button" onClick={closeAfkPanel}>
              {tCommon('cancel')}
            </button>
            <button type="submit" className="button button-accent" disabled={isAfkSubmitting}>
              {isAfkSubmitting ? t('afkPanel.logging') : t('afkPanel.logAfkButton')}
            </button>
          </div>
        </form>
      </SlidePanel>

      {confirmDialog}

      {toasts.length > 0 ? (
        <section className="toast-region" aria-live="polite">
          {toasts.map((toast) => (
            <article
              key={toast.id}
              className={`toast-message toast-message-${toast.variant}`}
              role="status"
            >
              <p>{toast.message}</p>
              <button
                type="button"
                className="toast-dismiss"
                onClick={() => dismissToast(toast.id)}
                aria-label={td('dismissNotification')}
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
