"use client";

import { type ChangeEvent, type FormEvent, useEffect, useMemo, useState } from "react";
import { z } from "zod";

import { EmptyState } from "../../../components/shared/empty-state";
import { ErrorState } from "../../../components/shared/error-state";
import { PageHeader } from "../../../components/shared/page-header";
import { SlidePanel } from "../../../components/shared/slide-panel";
import { StatusBadge } from "../../../components/shared/status-badge";
import { useAfkLogs, useTimeOffSummary } from "../../../hooks/use-time-off";
import { countryFlagFromCode, countryNameFromCode } from "../../../lib/countries";
import { formatDays, formatDateRangeHuman, formatDateTimeTooltip, formatRelativeTime } from "../../../lib/datetime";
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
import { formatSingleDateHuman } from "../../../lib/datetime";
import type {
  LeaveBalance,
  LeaveRequestRecord,
  LeaveRequestStatus,
  TimeOffRequestMutationResponse
} from "../../../types/time-off";
import { AUTO_GRANTED_LEAVE_TYPES, UNLIMITED_LEAVE_TYPES } from "../../../types/time-off";

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

const requestFormSchema = z.object({
  leaveType: z.string().trim().min(1, "Leave type is required"),
  startDate: z
    .string()
    .min(1, "Start date is required")
    .refine((value) => isIsoDate(value), "Start date must be in YYYY-MM-DD format"),
  endDate: z
    .string()
    .min(1, "End date is required")
    .refine((value) => isIsoDate(value), "End date must be in YYYY-MM-DD format"),
  reason: z.string().trim().min(1, "Reason is required").max(2000, "Reason is too long")
});

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

function createToastId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function hasFormErrors(errors: RequestFormErrors): boolean {
  return Boolean(errors.leaveType || errors.startDate || errors.endDate || errors.reason);
}

function getFormErrors(values: RequestFormValues, touched: RequestFormTouched): RequestFormErrors {
  const parsed = requestFormSchema.safeParse(values);
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
    errors.endDate = "End date must be on or after start date.";
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

function monthLabel(month: string): string {
  const range = monthToDateRange(month);

  if (!range) {
    return month;
  }

  const monthStart = isoDateToUtcDate(range.startDate);

  if (!monthStart) {
    return month;
  }

  return monthStart.toLocaleString(undefined, {
    month: "long",
    year: "numeric",
    timeZone: "UTC"
  });
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
  const [teamOverlap, setTeamOverlap] = useState<{ name: string; leaveType: string }[]>([]);

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

    return `Requested days (${calculatedWorkingDays}) exceed available balance (${selectedLeaveBalance.availableDays}).`;
  }, [calculatedWorkingDays, isSelectedTypeUnlimited, selectedLeaveBalance]);

  useEffect(() => {
    if (!isIsoDate(formValues.startDate) || !isIsoDate(formValues.endDate)) {
      setTeamOverlap([]);
      return;
    }

    if (formValues.endDate < formValues.startDate) {
      setTeamOverlap([]);
      return;
    }

    const controller = new AbortController();
    const params = new URLSearchParams({
      startDate: formValues.startDate,
      endDate: formValues.endDate
    });

    fetch(`/api/v1/time-off/overlap?${params.toString()}`, {
      signal: controller.signal
    })
      .then((res) => res.json())
      .then((payload) => {
        if (payload.data?.overlap) {
          setTeamOverlap(payload.data.overlap);
        }
      })
      .catch(() => {
        // Silently ignore overlap fetch errors
      });

    return () => controller.abort();
  }, [formValues.startDate, formValues.endDate]);

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

  const showToast = (variant: ToastVariant, message: string) => {
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
        showToast("error", payload.error?.message ?? "Unable to select birthday leave date.");
        return;
      }

      summaryQuery.refresh();
      showToast("success", "Birthday leave date selected!");
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : "Unable to select birthday leave date.");
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
    setAfkDate(new Date().toISOString().slice(0, 10));
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
      showToast("error", "Date, start time, and end time are required.");
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
        showToast("error", payload.error?.message ?? "Unable to log AFK entry.");
        return;
      }

      closeAfkPanel();
      afkQuery.refresh();
      summaryQuery.refresh();
      showToast("success", afkDurationMinutes > 120
        ? "AFK logged and auto-reclassified as a personal day request."
        : "AFK entry logged.");
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : "Unable to log AFK entry.");
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
    setTeamOverlap([]);
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
        setFormErrors(getFormErrors(nextValues, formTouched));
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
    setFormErrors(getFormErrors(formValues, nextTouched));
  };

  const handleSubmitRequest = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    setFormTouched(ALL_FORM_TOUCHED);
    const nextErrors = getFormErrors(formValues, ALL_FORM_TOUCHED);
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
        const message = payload.error?.message ?? "Unable to submit leave request.";
        setSubmitError(message);
        showToast("error", message);
        return;
      }

      closeRequestPanel();
      summaryQuery.refresh();
      showToast("success", "Leave request submitted.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to submit leave request.";
      setSubmitError(message);
      showToast("error", message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancelRequest = async (requestRecord: LeaveRequestRecord) => {
    const shouldCancel = window.confirm("Cancel this leave request?");

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
        showToast("error", payload.error?.message ?? "Unable to cancel leave request.");
        return;
      }

      summaryQuery.refresh();
      showToast("info", "Leave request cancelled.");
    } catch (error) {
      showToast(
        "error",
        error instanceof Error ? error.message : "Unable to cancel leave request."
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
            title="Time Off"
            description="Track leave balances, submit requests, and monitor your monthly calendar."
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
            title="Time Off"
            description="Track leave balances, submit requests, and monitor your monthly calendar."
          />
        ) : null}
        <ErrorState
          title="Time Off data is unavailable"
          message={summaryQuery.errorMessage ?? "Unable to load time off summary."}
          onRetry={summaryQuery.refresh}
        />
      </>
    );
  }

  return (
    <>
      {!embedded ? (
        <PageHeader
          title="Time Off"
          description="Track leave balances, submit requests, and monitor your monthly calendar."
        />
      ) : null}

      <section className="timeoff-balance-grid" aria-label="Leave balances">
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
                  <h2 className="section-title">{formatLeaveTypeLabel(policy.leaveType)}</h2>
                  <StatusBadge tone="processing">Unlimited</StatusBadge>
                </header>
                <div className="timeoff-balance-metric numeric">Unlimited</div>
                <p className="settings-card-description">
                  {usedDays > 0 ? `${formatDays(usedDays)} days used this year` : "No days used this year"}
                </p>
                <p className="settings-card-description">
                  Doctor&apos;s note required after 2 consecutive working days.
                </p>
              </article>
            );
          })}

        {/* Standard balance cards */}
        {summaryQuery.data.balances.length === 0 && summaryQuery.data.policies.filter((p) => p.isUnlimited).length === 0 ? (
          <EmptyState
            title="No leave balances available"
            description="Leave balances appear here once policies and allocations are configured."
            ctaLabel="Open dashboard"
            ctaHref="/dashboard"
          />
        ) : (
          summaryQuery.data.balances.map((balance) => {
            const scheduledDays = balance.pendingDays;
            const available = balance.totalDays - balance.usedDays - scheduledDays + balance.carriedDays;

            return (
              <article key={balance.id} className="timeoff-balance-card">
                <header className="timeoff-balance-card-header">
                  <h2 className="section-title">{formatLeaveTypeLabel(balance.leaveType)}</h2>
                  <StatusBadge tone={toneForBalance(balance)}>
                    {available > 0 ? "Available" : "Depleted"}
                  </StatusBadge>
                </header>
                <div className="timeoff-balance-metric numeric">
                  {formatDays(available)} days
                </div>
                <p className="settings-card-description">
                  {balance.year} balance including carried days
                </p>
                <dl className="timeoff-balance-breakdown">
                  <div>
                    <dt>Total</dt>
                    <dd className="numeric">{formatDays(balance.totalDays)}</dd>
                  </div>
                  <div>
                    <dt>Used</dt>
                    <dd className="numeric">{formatDays(balance.usedDays)}</dd>
                  </div>
                  {scheduledDays > 0 ? (
                    <div>
                      <dt>Scheduled</dt>
                      <dd className="numeric">{formatDays(scheduledDays)}</dd>
                    </div>
                  ) : null}
                  {balance.carriedDays > 0 ? (
                    <div>
                      <dt>Carried</dt>
                      <dd className="numeric">{formatDays(balance.carriedDays)}</dd>
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
        <section className="settings-card" aria-label="Birthday leave selection">
          <header className="timeoff-section-header">
            <h2 className="section-title">Birthday Leave</h2>
            <StatusBadge tone="pending">Action required</StatusBadge>
          </header>
          <p className="settings-card-description">
            Your birthday falls on a non-working day this year ({formatSingleDateHuman(birthdayChoiceInfo.birthdayDate)}). Choose a day for your birthday leave:
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
                {formatSingleDateHuman(dateOption)}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {/* Probation notice */}
      {summaryQuery.data.profile.status === "onboarding" ? (
        <section className="settings-card" aria-label="Probation notice">
          <p className="settings-card-description">
            During probation, only unpaid personal days are available for leave requests.
          </p>
        </section>
      ) : null}

      <section className="settings-card" aria-label="My leave requests">
        <header className="timeoff-section-header">
          <h2 className="section-title">My Requests</h2>
          <div className="documents-row-actions" style={{ opacity: 1, transform: "none", pointerEvents: "auto" }}>
            <button type="button" className="button button-accent" onClick={openRequestPanel}>
              Request Time Off
            </button>
            <button type="button" className="button" onClick={openAfkPanel}>
              Log AFK
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
              Start date {requestSortDirection === "asc" ? "↑" : "↓"}
            </button>
          </div>
        </header>

        {sortedRequests.length === 0 ? (
          <EmptyState
            title="No leave requests yet"
            description="Submit your first leave request to start tracking approvals here."
            ctaLabel="Request time off"
            ctaHref="/time-off"
          />
        ) : (
          <div className="data-table-container">
            <table className="data-table" aria-label="My leave requests">
              <thead>
                <tr>
                  <th>Leave type</th>
                  <th>Date range</th>
                  <th>Days</th>
                  <th>Status</th>
                  <th>Approver</th>
                  <th>Submitted</th>
                  <th className="table-action-column">Actions</th>
                </tr>
              </thead>
              <tbody>
                {sortedRequests.map((requestRecord) => (
                  <tr key={requestRecord.id} className="data-table-row">
                    <td>{formatLeaveTypeLabel(requestRecord.leaveType)}</td>
                    <td>
                      <time
                        dateTime={requestRecord.startDate}
                        title={formatDateTimeTooltip(requestRecord.startDate)}
                      >
                        {formatDateRangeHuman(requestRecord.startDate, requestRecord.endDate)}
                      </time>
                    </td>
                    <td className="numeric">{formatDays(requestRecord.totalDays)}</td>
                    <td>
                      <StatusBadge tone={toneForRequestStatus(requestRecord.status)}>
                        {formatLeaveStatus(requestRecord.status)}
                      </StatusBadge>
                    </td>
                    <td>{requestRecord.approverName ?? "--"}</td>
                    <td>
                      <time
                        dateTime={requestRecord.createdAt}
                        title={formatDateTimeTooltip(requestRecord.createdAt)}
                      >
                        {formatRelativeTime(requestRecord.createdAt)}
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
                            {isCancellingRequestId === requestRecord.id ? "Cancelling..." : "Cancel"}
                          </button>
                        ) : (
                          <span className="settings-card-description">No actions</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="settings-card" aria-label="Monthly mini calendar">
        <header className="timeoff-section-header">
          <h2 className="section-title">Mini Calendar</h2>
          <div className="timeoff-month-controls">
            <button
              type="button"
              className="button"
              onClick={() => setActiveMonth((currentMonth) => shiftMonth(currentMonth, -1))}
            >
              Previous
            </button>
            <p className="numeric">{monthLabel(activeMonth)}</p>
            <button
              type="button"
              className="button"
              onClick={() => setActiveMonth((currentMonth) => shiftMonth(currentMonth, 1))}
            >
              Next
            </button>
          </div>
        </header>

        <div className="timeoff-mini-calendar">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((label) => (
            <p key={label} className="timeoff-calendar-weekday">
              {label}
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
            <span>Leave</span>
          </div>
          <div className="timeoff-calendar-legend-item">
            <span className="timeoff-calendar-badge timeoff-calendar-badge-holiday" />
            <span>Public holiday</span>
          </div>
          <div className="timeoff-calendar-legend-item">
            <span className="timeoff-calendar-badge timeoff-calendar-badge-pending" />
            <span>Pending</span>
          </div>
        </div>

        <div className="timeoff-country-summary">
          <span>{countryFlagFromCode(summaryQuery.data.profile.countryCode)}</span>
          <span>{countryNameFromCode(summaryQuery.data.profile.countryCode)}</span>
        </div>
      </section>

      <section className="settings-card" aria-label="AFK log">
        <header className="timeoff-section-header">
          <h2 className="section-title">AFK Log</h2>
          {afkQuery.data ? (
            <p className="settings-card-description">
              {afkQuery.data.weeklyCount} of {afkQuery.data.weeklyLimit} entries this week
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
            <table className="data-table" aria-label="AFK log entries">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Time</th>
                  <th>Duration</th>
                  <th>Status</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {afkQuery.data.logs.map((log) => (
                  <tr key={log.id} className="data-table-row">
                    <td>{formatSingleDateHuman(log.date)}</td>
                    <td className="numeric">{log.startTime} – {log.endTime}</td>
                    <td className="numeric">
                      {log.durationMinutes >= 60
                        ? `${Math.floor(log.durationMinutes / 60)}h ${log.durationMinutes % 60}m`
                        : `${log.durationMinutes}m`}
                    </td>
                    <td>
                      {log.reclassifiedAs ? (
                        <StatusBadge tone="warning">Reclassified</StatusBadge>
                      ) : (
                        <StatusBadge tone="success">Logged</StatusBadge>
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
            title="No AFK entries this week"
            description="Log short absences during working hours here."
            ctaLabel="Log AFK"
            ctaHref="/time-off"
          />
        )}
      </section>

      <SlidePanel
        isOpen={isRequestPanelOpen}
        title="Request Time Off"
        description="Select leave type and dates. Working days exclude weekends and holidays."
        onClose={closeRequestPanel}
      >
        <form className="slide-panel-form-wrapper" onSubmit={handleSubmitRequest} noValidate>
          <label className="form-field" htmlFor="timeoff-leave-type">
            <span className="form-label">Leave type</span>
            <select
              id="timeoff-leave-type"
              className={formErrors.leaveType ? "form-input form-input-error" : "form-input"}
              value={formValues.leaveType}
              onChange={handleFieldChange("leaveType")}
              onBlur={handleFieldBlur("leaveType")}
            >
              <option value="">Select leave type</option>
              {availableLeaveTypes.map((leaveType) => (
                <option key={leaveType} value={leaveType}>
                  {formatLeaveTypeLabel(leaveType)}
                </option>
              ))}
            </select>
            {formErrors.leaveType ? <p className="form-field-error">{formErrors.leaveType}</p> : null}
          </label>

          <div className="timeoff-form-grid">
            <label className="form-field" htmlFor="timeoff-start-date">
              <span className="form-label">Start date</span>
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
              <span className="form-label">End date</span>
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

          <label className="form-field" htmlFor="timeoff-reason">
            <span className="form-label">Reason</span>
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
              Working days: <span className="numeric">{formatDays(calculatedWorkingDays)}</span>
            </p>
            {isSelectedTypeUnlimited ? (
              <p className="settings-card-description">This leave type has unlimited balance.</p>
            ) : selectedLeaveBalance ? (
              <p>
                Available balance:{" "}
                <span className="numeric">{formatDays(selectedLeaveBalance.availableDays)}</span>
              </p>
            ) : null}
            {balanceWarning ? <p className="form-field-error">{balanceWarning}</p> : null}
            {formValues.leaveType === "sick_leave" && calculatedWorkingDays > 2 ? (
              <p className="settings-card-description">
                A doctor&apos;s note may be required for sick leave exceeding 2 consecutive working days.
              </p>
            ) : null}
            {teamOverlap.length > 0 ? (
              <div className="timeoff-overlap-notice">
                <p className="timeoff-overlap-heading">
                  {teamOverlap.length} team member{teamOverlap.length !== 1 ? "s" : ""} off during this period
                </p>
                <ul className="timeoff-overlap-list">
                  {teamOverlap.map((member, index) => (
                    <li key={`overlap-${index}`} className="settings-card-description">
                      {member.name} ({formatLeaveTypeLabel(member.leaveType)})
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>

          {submitError ? <p className="form-submit-error">{submitError}</p> : null}

          <div className="slide-panel-actions">
            <button type="button" className="button" onClick={closeRequestPanel}>
              Cancel
            </button>
            <button type="submit" className="button button-accent" disabled={isSubmitting}>
              {isSubmitting ? "Submitting..." : "Submit request"}
            </button>
          </div>
        </form>
      </SlidePanel>

      <SlidePanel
        isOpen={isAfkPanelOpen}
        title="Log AFK"
        description="Record a short absence during working hours. Maximum 2 entries per week."
        onClose={closeAfkPanel}
      >
        <form className="slide-panel-form-wrapper" onSubmit={handleSubmitAfk} noValidate>
          <label className="form-field" htmlFor="afk-date">
            <span className="form-label">Date</span>
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
              <span className="form-label">Start time</span>
              <input
                id="afk-start-time"
                type="time"
                className="form-input"
                value={afkStartTime}
                onChange={(event) => setAfkStartTime(event.currentTarget.value)}
              />
            </label>

            <label className="form-field" htmlFor="afk-end-time">
              <span className="form-label">End time</span>
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
            <span className="form-label">Notes (optional)</span>
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
                Duration:{" "}
                <span className="numeric">
                  {afkDurationMinutes >= 60
                    ? `${Math.floor(afkDurationMinutes / 60)}h ${afkDurationMinutes % 60}m`
                    : `${afkDurationMinutes}m`}
                </span>
              </p>
            ) : null}
            {afkDurationMinutes > 120 ? (
              <p className="form-field-error">
                AFK over 2 hours will be automatically reclassified as a personal day request.
              </p>
            ) : null}
            {afkQuery.data ? (
              <p className="settings-card-description">
                {afkQuery.data.weeklyCount} of {afkQuery.data.weeklyLimit} AFK entries used this week.
              </p>
            ) : null}
          </section>

          <div className="slide-panel-actions">
            <button type="button" className="button" onClick={closeAfkPanel}>
              Cancel
            </button>
            <button type="submit" className="button button-accent" disabled={isAfkSubmitting}>
              {isAfkSubmitting ? "Logging..." : "Log AFK"}
            </button>
          </div>
        </form>
      </SlidePanel>

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
                aria-label="Dismiss notification"
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
