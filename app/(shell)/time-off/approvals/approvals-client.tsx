"use client";

import { type ChangeEvent, type FormEvent, useMemo, useState } from "react";
import { z } from "zod";
import { useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";

import { ConfirmDialog } from "../../../../components/shared/confirm-dialog";
import { EmptyState } from "../../../../components/shared/empty-state";
import { ErrorState } from "../../../../components/shared/error-state";
import { PageHeader } from "../../../../components/shared/page-header";
import { SlidePanel } from "../../../../components/shared/slide-panel";
import { StatusBadge } from "../../../../components/shared/status-badge";
import { TeamAvailabilityPanel } from "../../../../components/time-off/team-availability-panel";
import { useTimeOffApprovals } from "../../../../hooks/use-time-off";
import { countryFlagFromCode, countryNameFromCode } from "../../../../lib/countries";
import { formatDays, formatDateRangeHuman, formatDateTimeTooltip, formatRelativeTime } from "../../../../lib/datetime";
import { formatLeaveStatus } from "../../../../lib/format-labels";
import { formatLeaveTypeLabel } from "../../../../lib/time-off";
import type { LeaveRequestRecord, TimeOffRequestMutationResponse } from "../../../../types/time-off";
import { humanizeError } from "@/lib/errors";

type AppLocale = "en" | "fr";
type SortDirection = "asc" | "desc";
type ToastVariant = "success" | "error" | "info";

type ToastMessage = {
  id: string;
  message: string;
  variant: ToastVariant;
};

type RejectFormValues = {
  rejectionReason: string;
};

type RejectFormErrors = {
  rejectionReason?: string;
};

function createToastId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function ApprovalTableSkeleton() {
  return (
    <div className="table-skeleton" aria-hidden="true">
      <div className="table-skeleton-header" />
      {Array.from({ length: 6 }, (_, index) => (
        <div key={`timeoff-approval-skeleton-${index}`} className="table-skeleton-row" />
      ))}
    </div>
  );
}

function toneForStatus(status: LeaveRequestRecord["status"]) {
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

export function TimeOffApprovalsClient({ embedded = false }: { embedded?: boolean }) {
  const t = useTranslations('timeOffApprovals');
  const tCommon = useTranslations('common');
  const locale = useLocale() as AppLocale;

  const queryClient = useQueryClient();
  const approvalsQuery = useTimeOffApprovals();
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [isMutatingRequestId, setIsMutatingRequestId] = useState<string | null>(null);
  const [contextTarget, setContextTarget] = useState<LeaveRequestRecord | null>(null);
  const [rejectTarget, setRejectTarget] = useState<LeaveRequestRecord | null>(null);
  const [approveTarget, setApproveTarget] = useState<LeaveRequestRecord | null>(null);
  const [rejectValues, setRejectValues] = useState<RejectFormValues>({ rejectionReason: "" });
  const [rejectErrors, setRejectErrors] = useState<RejectFormErrors>({});
  const [isRejecting, setIsRejecting] = useState(false);

  const rejectSchema = useMemo(() => z.object({
    rejectionReason: z.string().trim().min(1, t('validationRejectionRequired')).max(2000, t('validationRejectionTooLong'))
  }), [t]);

  const requests = useMemo(() => {
    const rows = approvalsQuery.data?.requests ?? [];

    return [...rows].sort((leftRequest, rightRequest) => {
      const leftTime = Date.parse(`${leftRequest.startDate}T00:00:00.000Z`);
      const rightTime = Date.parse(`${rightRequest.startDate}T00:00:00.000Z`);

      return sortDirection === "asc" ? leftTime - rightTime : rightTime - leftTime;
    });
  }, [approvalsQuery.data?.requests, sortDirection]);

  const coveringForNames = useMemo(() => {
    const names = new Set<string>();
    for (const req of requests) {
      if (req.actingForName) names.add(req.actingForName);
    }
    return [...names];
  }, [requests]);

  const dismissToast = (toastId: string) => {
    setToasts((currentToasts) => currentToasts.filter((toast) => toast.id !== toastId));
  };

  const showToast = (variant: ToastVariant, rawMessage: string) => {
    const message = variant === "error" ? humanizeError(rawMessage, locale) : rawMessage;
    const toastId = createToastId();
    setToasts((currentToasts) => [...currentToasts, { id: toastId, variant, message }]);

    window.setTimeout(() => {
      dismissToast(toastId);
    }, 4000);
  };

  const handleApprove = async (requestRecord: LeaveRequestRecord) => {
    setIsMutatingRequestId(requestRecord.id);

    try {
      const response = await fetch(`/api/v1/time-off/requests/${requestRecord.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          action: "approve"
        })
      });

      const payload = (await response.json()) as TimeOffRequestMutationResponse;

      if (!response.ok || !payload.data?.request) {
        showToast("error", payload.error?.message ?? t('toastApproveError'));
        return;
      }

      approvalsQuery.refresh();
      void queryClient.invalidateQueries({ queryKey: ["approvals-tab-counts"] });
      if (contextTarget?.id === requestRecord.id) {
        setContextTarget(null);
      }
      showToast("success", t('toastApproved'));
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : t('toastApproveError'));
    } finally {
      setIsMutatingRequestId(null);
    }
  };

  const openRejectPanel = (requestRecord: LeaveRequestRecord) => {
    setRejectTarget(requestRecord);
    setRejectValues({ rejectionReason: "" });
    setRejectErrors({});
  };

  const closeRejectPanel = () => {
    setRejectTarget(null);
    setRejectValues({ rejectionReason: "" });
    setRejectErrors({});
  };

  const openContextPanel = (requestRecord: LeaveRequestRecord) => {
    setContextTarget(requestRecord);
  };

  const closeContextPanel = () => {
    setContextTarget(null);
  };

  const openApproveDialog = (requestRecord: LeaveRequestRecord) => {
    setApproveTarget(requestRecord);
  };

  const closeApproveDialog = () => {
    setApproveTarget(null);
  };

  const confirmApprove = async () => {
    if (!approveTarget) {
      return;
    }

    const target = approveTarget;
    closeApproveDialog();
    await handleApprove(target);
  };

  const handleRejectReasonChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const nextValues = {
      rejectionReason: event.currentTarget.value
    };

    setRejectValues(nextValues);
    const validation = rejectSchema.safeParse(nextValues);
    setRejectErrors(validation.success ? {} : { rejectionReason: validation.error.flatten().fieldErrors.rejectionReason?.[0] });
  };

  const handleSubmitReject = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!rejectTarget) {
      return;
    }

    const validation = rejectSchema.safeParse(rejectValues);

    if (!validation.success) {
      setRejectErrors({
        rejectionReason: validation.error.flatten().fieldErrors.rejectionReason?.[0]
      });
      return;
    }

    setIsRejecting(true);

    try {
      const response = await fetch(`/api/v1/time-off/requests/${rejectTarget.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          action: "reject",
          rejectionReason: rejectValues.rejectionReason.trim()
        })
      });

      const payload = (await response.json()) as TimeOffRequestMutationResponse;

      if (!response.ok || !payload.data?.request) {
        showToast("error", payload.error?.message ?? t('toastRejectError'));
        return;
      }

      approvalsQuery.refresh();
      void queryClient.invalidateQueries({ queryKey: ["approvals-tab-counts"] });
      closeRejectPanel();
      showToast("info", t('toastRejected'));
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : t('toastRejectError'));
    } finally {
      setIsRejecting(false);
    }
  };

  return (
    <>
      {!embedded ? (
        <PageHeader
          title={t('title')}
          description={t('description')}
        />
      ) : null}

      {approvalsQuery.isLoading ? <ApprovalTableSkeleton /> : null}

      {!approvalsQuery.isLoading && approvalsQuery.errorMessage ? (
        <ErrorState
          title={t('unavailable')}
          message={approvalsQuery.errorMessage}
          onRetry={approvalsQuery.refresh}
        />
      ) : null}

      {!approvalsQuery.isLoading && !approvalsQuery.errorMessage && requests.length === 0 ? (
        <EmptyState
          title={t('noApprovals')}
          description={t('noApprovalsDescription')}
          ctaLabel={t('noApprovalsCta')}
          ctaHref="/time-off"
        />
      ) : null}

      {!approvalsQuery.isLoading && !approvalsQuery.errorMessage && requests.length > 0 ? (
        <>
          {coveringForNames.length > 0 ? (
            <p className="delegation-banner">
              {coveringForNames.length === 1
                ? t('coveringForBanner', { name: coveringForNames[0] })
                : t('coveringForMultipleBanner', { names: coveringForNames.join(", ") })}
            </p>
          ) : null}
          <div className="data-table-container">
          <table className="data-table" aria-label={t('tableAriaLabel')}>
            <thead>
              <tr>
                <th>{t('thEmployee')}</th>
                <th>{t('thCountry')}</th>
                <th>{t('thLeaveType')}</th>
                <th>
                  <button
                    type="button"
                    className="table-sort-trigger"
                    onClick={() =>
                      setSortDirection((currentDirection) =>
                        currentDirection === "asc" ? "desc" : "asc"
                      )
                    }
                  >
                    {t('thDates')} {sortDirection === "asc" ? "↑" : "↓"}
                  </button>
                </th>
                <th>{t('thDays')}</th>
                <th>{t('thStatus')}</th>
                <th>{t('thRequested')}</th>
                <th className="table-action-column">{t('thActions')}</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((requestRecord) => (
                <tr key={requestRecord.id} className="data-table-row">
                  <td>
                    <div className="documents-cell-copy">
                      <p className="documents-cell-title">{requestRecord.employeeName}</p>
                      <p className="documents-cell-description">
                        {requestRecord.actingForName
                          ? t('delegatedTag', { name: requestRecord.actingForName })
                          : requestRecord.employeeDepartment ?? ""}
                      </p>
                    </div>
                  </td>
                  <td>
                    <span className="country-chip">
                      <span>{countryFlagFromCode(requestRecord.employeeCountryCode)}</span>
                      <span>{countryNameFromCode(requestRecord.employeeCountryCode, locale)}</span>
                    </span>
                  </td>
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
                    <StatusBadge tone={toneForStatus(requestRecord.status)}>
                      {formatLeaveStatus(requestRecord.status, locale)}
                    </StatusBadge>
                  </td>
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
                      <button
                        type="button"
                        className="table-row-action"
                        onClick={() => openContextPanel(requestRecord)}
                        disabled={isMutatingRequestId === requestRecord.id}
                      >
                        {t('review')}
                      </button>
                      <button
                        type="button"
                        className="table-row-action table-row-action-success"
                        onClick={() => openApproveDialog(requestRecord)}
                        disabled={isMutatingRequestId === requestRecord.id}
                      >
                        {isMutatingRequestId === requestRecord.id ? t('saving') : t('approve')}
                      </button>
                      <button
                        type="button"
                        className="table-row-action table-row-action-danger"
                        onClick={() => openRejectPanel(requestRecord)}
                        disabled={isMutatingRequestId === requestRecord.id}
                      >
                        {t('reject')}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      ) : null}

      <SlidePanel
        isOpen={Boolean(contextTarget)}
        title={t('reviewTitle')}
        description={
          contextTarget
            ? t('reviewDescription', { name: contextTarget.employeeName })
            : undefined
        }
        onClose={closeContextPanel}
      >
        {contextTarget ? (
          <div className="slide-panel-form-wrapper">
            <article className="settings-card">
              <h3 className="section-title">{contextTarget.employeeName}</h3>
              <p className="settings-card-description">
                {contextTarget.employeeDepartment ?? ""}
              </p>
              <p className="settings-card-description">
                <span className="country-chip">
                  <span>{countryFlagFromCode(contextTarget.employeeCountryCode)}</span>
                  <span>{countryNameFromCode(contextTarget.employeeCountryCode, locale)}</span>
                </span>
              </p>
              <p className="settings-card-description">
                {t('leaveTypeLabel')} {formatLeaveTypeLabel(contextTarget.leaveType, locale)}
              </p>
              <p className="settings-card-description">
                {t('dateRangeLabel')} {formatDateRangeHuman(contextTarget.startDate, contextTarget.endDate, locale)}
              </p>
              <p className="settings-card-description">
                {t('totalDaysLabel')} <span className="numeric">{formatDays(contextTarget.totalDays, locale)}</span>
              </p>
              <p className="settings-card-description">
                {t('submittedLabel')}{" "}
                <time
                  dateTime={contextTarget.createdAt}
                  title={formatDateTimeTooltip(contextTarget.createdAt, locale)}
                >
                  {formatRelativeTime(contextTarget.createdAt, locale)}
                </time>
              </p>
              <p className="settings-card-description">{t('reasonLabel')} {contextTarget.reason}</p>
            </article>

            <article className="settings-card">
              <h3 className="section-title">{t('teamContextTitle')}</h3>
              <p className="settings-card-description">
                {t('teamContextDescription')}
              </p>
              <TeamAvailabilityPanel
                startDate={contextTarget.startDate}
                endDate={contextTarget.endDate}
              />
            </article>

            <div className="slide-panel-actions">
              <button
                type="button"
                className="button"
                onClick={closeContextPanel}
              >
                {t('closePanel')}
              </button>
              <button
                type="button"
                className="button"
                onClick={() => {
                  closeContextPanel();
                  openRejectPanel(contextTarget);
                }}
                disabled={isMutatingRequestId === contextTarget.id}
              >
                {t('reject')}
              </button>
              <button
                type="button"
                className="button button-accent"
                onClick={() => {
                  closeContextPanel();
                  openApproveDialog(contextTarget);
                }}
                disabled={isMutatingRequestId === contextTarget.id}
              >
                {isMutatingRequestId === contextTarget.id ? t('saving') : t('approve')}
              </button>
            </div>
          </div>
        ) : null}
      </SlidePanel>

      <SlidePanel
        isOpen={Boolean(rejectTarget)}
        title={t('rejectTitle')}
        description={rejectTarget ? t('rejectDescription', { name: rejectTarget.employeeName }) : undefined}
        onClose={closeRejectPanel}
      >
        <form className="slide-panel-form-wrapper" onSubmit={handleSubmitReject} noValidate>
          <label className="form-field" htmlFor="timeoff-reject-reason">
            <span className="form-label">{t('rejectionReasonLabel')}</span>
            <textarea
              id="timeoff-reject-reason"
              className={rejectErrors.rejectionReason ? "form-input form-input-error" : "form-input"}
              value={rejectValues.rejectionReason}
              onChange={handleRejectReasonChange}
              rows={5}
            />
            {rejectErrors.rejectionReason ? (
              <p className="form-field-error">{rejectErrors.rejectionReason}</p>
            ) : null}
          </label>

          <div className="slide-panel-actions">
            <button type="button" className="button" onClick={closeRejectPanel}>
              {tCommon('cancel')}
            </button>
            <button type="submit" className="button button-accent" disabled={isRejecting}>
              {isRejecting ? t('rejecting') : t('rejectRequest')}
            </button>
          </div>
        </form>
      </SlidePanel>

      <ConfirmDialog
        isOpen={Boolean(approveTarget)}
        title={t('approveConfirmTitle')}
        description={
          approveTarget
            ? t('approveConfirmDescription', { name: approveTarget.employeeName })
            : undefined
        }
        confirmLabel={t('approveConfirmLabel')}
        cancelLabel={tCommon('cancel')}
        isConfirming={Boolean(isMutatingRequestId)}
        onCancel={closeApproveDialog}
        onConfirm={() => {
          void confirmApprove();
        }}
      />

      {toasts.length > 0 ? (
        <section className="toast-region" aria-label={t('toastAriaLabel')} aria-live="polite">
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
                aria-label={t('dismissAriaLabel')}
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
