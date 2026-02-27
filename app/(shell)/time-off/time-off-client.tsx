"use client";

import { type ChangeEvent, type FormEvent, useMemo, useState } from "react";
import { z } from "zod";

import { EmptyState } from "../../../components/shared/empty-state";
import { PageHeader } from "../../../components/shared/page-header";
import { SlidePanel } from "../../../components/shared/slide-panel";
import { StatusBadge } from "../../../components/shared/status-badge";
import { useTimeOffSummary } from "../../../hooks/use-time-off";
import { countryFlagFromCode, countryNameFromCode } from "../../../lib/countries";
import { formatDateTimeTooltip, formatRelativeTime } from "../../../lib/datetime";
import {
  calculateWorkingDays,
  enumerateIsoDatesInRange,
  formatLeaveTypeLabel,
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
      <div className="timeoff-table-skeleton">
        <div className="timeoff-table-skeleton-header" />
        {Array.from({ length: 6 }, (_, index) => (
          <div key={`timeoff-row-skeleton-${index}`} className="timeoff-table-skeleton-row" />
        ))}
      </div>
      <div className="timeoff-calendar-skeleton" />
    </section>
  );
}

export function TimeOffClient() {
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

  const summaryQuery = useTimeOffSummary({
    month: activeMonth,
    year: Number.parseInt(activeMonth.slice(0, 4), 10)
  });

  const availableLeaveTypes = useMemo(() => {
    const policyTypes = summaryQuery.data?.policies.map((policy) => policy.leaveType) ?? [];
    const balanceTypes = summaryQuery.data?.balances.map((balance) => balance.leaveType) ?? [];
    return [...new Set([...policyTypes, ...balanceTypes])].sort((leftValue, rightValue) =>
      leftValue.localeCompare(rightValue)
    );
  }, [summaryQuery.data?.balances, summaryQuery.data?.policies]);

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
    if (!selectedLeaveBalance || calculatedWorkingDays <= 0) {
      return null;
    }

    if (calculatedWorkingDays <= selectedLeaveBalance.availableDays) {
      return null;
    }

    return `Requested days (${calculatedWorkingDays}) exceed available balance (${selectedLeaveBalance.availableDays}).`;
  }, [calculatedWorkingDays, selectedLeaveBalance]);

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
        <PageHeader
          title="Time Off"
          description="Track leave balances, submit requests, and monitor your monthly calendar."
        />
        <TimeOffSkeleton />
      </>
    );
  }

  if (summaryQuery.errorMessage || !summaryQuery.data) {
    return (
      <>
        <PageHeader
          title="Time Off"
          description="Track leave balances, submit requests, and monitor your monthly calendar."
        />
        <EmptyState
          title="Time Off data is unavailable"
          description={summaryQuery.errorMessage ?? "Unable to load time off summary."}
          ctaLabel="Retry"
          ctaHref="/time-off"
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Time Off"
        description="Track leave balances, submit requests, and monitor your monthly calendar."
        actions={
          <button type="button" className="button button-accent" onClick={openRequestPanel}>
            Request Time Off
          </button>
        }
      />

      <section className="timeoff-balance-grid" aria-label="Leave balances">
        {summaryQuery.data.balances.length === 0 ? (
          <EmptyState
            title="No leave balances available"
            description="Leave balances appear here once policies and allocations are configured."
            ctaLabel="Open dashboard"
            ctaHref="/dashboard"
          />
        ) : (
          summaryQuery.data.balances.map((balance) => (
            <article key={balance.id} className="timeoff-balance-card">
              <header className="timeoff-balance-card-header">
                <h2 className="section-title">{formatLeaveTypeLabel(balance.leaveType)}</h2>
                <StatusBadge tone={toneForBalance(balance)}>
                  {balance.availableDays > 0 ? "Available" : "Depleted"}
                </StatusBadge>
              </header>
              <div className="timeoff-balance-metric numeric">
                {balance.availableDays.toFixed(1)} days
              </div>
              <p className="settings-card-description">
                {balance.year} balance including carried days
              </p>
              <dl className="timeoff-balance-breakdown">
                <div>
                  <dt>Total</dt>
                  <dd className="numeric">{balance.totalDays.toFixed(1)}</dd>
                </div>
                <div>
                  <dt>Used</dt>
                  <dd className="numeric">{balance.usedDays.toFixed(1)}</dd>
                </div>
                <div>
                  <dt>Pending</dt>
                  <dd className="numeric">{balance.pendingDays.toFixed(1)}</dd>
                </div>
                <div>
                  <dt>Carried</dt>
                  <dd className="numeric">{balance.carriedDays.toFixed(1)}</dd>
                </div>
              </dl>
            </article>
          ))
        )}
      </section>

      <section className="settings-card" aria-label="My leave requests">
        <header className="timeoff-section-header">
          <h2 className="section-title">My Requests</h2>
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
                        {requestRecord.startDate}
                      </time>
                      {" - "}
                      <time
                        dateTime={requestRecord.endDate}
                        title={formatDateTimeTooltip(requestRecord.endDate)}
                      >
                        {requestRecord.endDate}
                      </time>
                    </td>
                    <td className="numeric">{requestRecord.totalDays.toFixed(1)}</td>
                    <td>
                      <StatusBadge tone={toneForRequestStatus(requestRecord.status)}>
                        {requestRecord.status}
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

            const className = [
              "timeoff-calendar-day",
              cell.isCurrentMonth ? "timeoff-calendar-day-current" : "timeoff-calendar-day-muted",
              hasApproved ? "timeoff-calendar-day-approved" : "",
              hasPending ? "timeoff-calendar-day-pending" : ""
            ]
              .filter(Boolean)
              .join(" ");

            return (
              <article key={cell.dateKey} className={className}>
                <p className="numeric">{cell.dayNumber}</p>
                {holidays.length > 0 ? (
                  <p className="timeoff-calendar-note" title={holidays.join(", ")}>
                    Holiday
                  </p>
                ) : null}
                {statuses.length > 0 ? (
                  <p className="timeoff-calendar-note">
                    {hasApproved ? "Approved" : hasPending ? "Pending" : "Request"}
                  </p>
                ) : null}
              </article>
            );
          })}
        </div>

        <div className="timeoff-country-summary">
          <span>{countryFlagFromCode(summaryQuery.data.profile.countryCode)}</span>
          <span>{countryNameFromCode(summaryQuery.data.profile.countryCode)}</span>
        </div>
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
              Working days: <span className="numeric">{calculatedWorkingDays.toFixed(1)}</span>
            </p>
            {selectedLeaveBalance ? (
              <p>
                Available balance:{" "}
                <span className="numeric">{selectedLeaveBalance.availableDays.toFixed(1)}</span>
              </p>
            ) : null}
            {balanceWarning ? <p className="form-field-error">{balanceWarning}</p> : null}
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
