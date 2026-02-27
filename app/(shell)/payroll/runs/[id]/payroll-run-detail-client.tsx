"use client";

import { Fragment, type FormEvent, useMemo, useState } from "react";
import { z } from "zod";

import { EmptyState } from "../../../../../components/shared/empty-state";
import { PageHeader } from "../../../../../components/shared/page-header";
import { StatusBadge } from "../../../../../components/shared/status-badge";
import { CurrencyDisplay } from "../../../../../components/ui/currency-display";
import { usePayrollRunDetail } from "../../../../../hooks/use-payroll-runs";
import { countryFlagFromCode, countryNameFromCode } from "../../../../../lib/countries";
import { formatDateTimeTooltip } from "../../../../../lib/datetime";
import {
  getCurrencyTotal,
  labelForPayrollRunStatus,
  toneForPayrollRunStatus
} from "../../../../../lib/payroll/runs";
import type {
  AddPayrollAdjustmentResponse,
  CalculatePayrollRunResponse,
  PayrollAdjustmentType,
  PayrollRunItem,
  PayrollRunStatus
} from "../../../../../types/payroll-runs";

type SortDirection = "asc" | "desc";
type ToastVariant = "success" | "error" | "info";

type ToastMessage = {
  id: string;
  variant: ToastVariant;
  message: string;
};

type AdjustmentFormValues = {
  adjustmentType: PayrollAdjustmentType;
  label: string;
  amount: string;
  notes: string;
};

type AdjustmentFormField = keyof AdjustmentFormValues;
type AdjustmentFormErrors = Partial<Record<AdjustmentFormField, string>>;

const RUN_STATUS_FLOW: PayrollRunStatus[] = [
  "draft",
  "calculated",
  "pending_first_approval",
  "pending_final_approval",
  "approved",
  "processing",
  "completed"
];

const adjustmentSchema = z.object({
  adjustmentType: z.enum(["bonus", "deduction", "correction"]),
  label: z.string().trim().min(1, "Label is required.").max(120, "Label is too long."),
  amount: z.string().trim().regex(/^-?\d+$/, "Amount must be a whole number."),
  notes: z.string().max(300, "Notes must be 300 characters or fewer.")
});

const INITIAL_ADJUSTMENT_VALUES: AdjustmentFormValues = {
  adjustmentType: "bonus",
  label: "",
  amount: "",
  notes: ""
};

function createToastId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function itemTableSkeleton() {
  return (
    <section className="payroll-run-skeleton" aria-hidden="true">
      <div className="payroll-run-skeleton-timeline" />
      <div className="payroll-run-skeleton-metrics" />
      <div className="payroll-run-skeleton-table-header" />
      {Array.from({ length: 8 }, (_, index) => (
        <div key={`payroll-run-row-skeleton-${index}`} className="payroll-run-skeleton-table-row" />
      ))}
    </section>
  );
}

function contractorNote() {
  return "This person is a contractor. Taxes are not withheld by Crew Hub. The contractor is responsible for their own tax obligations.";
}

function summarizeStatusStep(
  runStatus: PayrollRunStatus
): {
  step: PayrollRunStatus;
  state: "complete" | "active" | "upcoming";
}[] {
  const currentIndex = RUN_STATUS_FLOW.indexOf(runStatus);

  return RUN_STATUS_FLOW.map((status, index) => {
    if (currentIndex === -1) {
      return {
        step: status,
        state: "upcoming"
      };
    }

    if (index < currentIndex) {
      return { step: status, state: "complete" };
    }

    if (index === currentIndex) {
      return { step: status, state: "active" };
    }

    return { step: status, state: "upcoming" };
  });
}

function getAdjustmentErrors(values: AdjustmentFormValues): AdjustmentFormErrors {
  const parsed = adjustmentSchema.safeParse(values);

  if (!parsed.success) {
    const errors = parsed.error.flatten().fieldErrors;
    return {
      adjustmentType: errors.adjustmentType?.[0],
      label: errors.label?.[0],
      amount: errors.amount?.[0],
      notes: errors.notes?.[0]
    };
  }

  const integerAmount = Number.parseInt(values.amount.trim(), 10);

  if (!Number.isSafeInteger(integerAmount)) {
    return {
      amount: "Amount is out of supported range."
    };
  }

  if (values.adjustmentType === "correction" && integerAmount === 0) {
    return {
      amount: "Correction amount cannot be zero."
    };
  }

  if (
    (values.adjustmentType === "bonus" || values.adjustmentType === "deduction") &&
    integerAmount <= 0
  ) {
    return {
      amount: "Bonus and deduction amounts must be greater than zero."
    };
  }

  return {};
}

function hasErrors(errors: AdjustmentFormErrors): boolean {
  return Object.values(errors).some((value) => Boolean(value));
}

export function PayrollRunDetailClient({
  runId,
  canManage
}: {
  runId: string;
  canManage: boolean;
}) {
  const runQuery = usePayrollRunDetail({ runId, enabled: true });
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  const [isCalculating, setIsCalculating] = useState(false);
  const [adjustmentItemId, setAdjustmentItemId] = useState<string | null>(null);
  const [adjustmentValues, setAdjustmentValues] = useState<AdjustmentFormValues>(
    INITIAL_ADJUSTMENT_VALUES
  );
  const [adjustmentErrors, setAdjustmentErrors] = useState<AdjustmentFormErrors>({});
  const [isSubmittingAdjustment, setIsSubmittingAdjustment] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const sortedItems = useMemo(() => {
    const rows = runQuery.data?.items ?? [];

    return [...rows].sort((left, right) => {
      const comparison = left.fullName.localeCompare(right.fullName);
      return sortDirection === "asc" ? comparison : comparison * -1;
    });
  }, [runQuery.data?.items, sortDirection]);

  const dismissToast = (toastId: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== toastId));
  };

  const showToast = (variant: ToastVariant, message: string) => {
    const toastId = createToastId();

    setToasts((current) => [...current, { id: toastId, variant, message }]);

    window.setTimeout(() => {
      dismissToast(toastId);
    }, 4000);
  };

  const calculateRun = async () => {
    setIsCalculating(true);

    try {
      const response = await fetch(`/api/v1/payroll/runs/${runId}/calculate`, {
        method: "POST"
      });

      const payload = (await response.json()) as CalculatePayrollRunResponse;

      if (!response.ok || !payload.data) {
        showToast("error", payload.error?.message ?? "Unable to calculate payroll run.");
        return;
      }

      showToast(
        "success",
        `Calculation complete for ${payload.data.employeeCount} employees.`
      );
      runQuery.refresh();
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : "Unable to calculate payroll run.");
    } finally {
      setIsCalculating(false);
    }
  };

  const openAdjustmentPanel = (item: PayrollRunItem) => {
    setAdjustmentItemId(item.id);
    setAdjustmentValues(INITIAL_ADJUSTMENT_VALUES);
    setAdjustmentErrors({});
  };

  const submitAdjustment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!adjustmentItemId) {
      return;
    }

    const errors = getAdjustmentErrors(adjustmentValues);
    setAdjustmentErrors(errors);

    if (hasErrors(errors)) {
      return;
    }

    setIsSubmittingAdjustment(true);

    try {
      const response = await fetch(
        `/api/v1/payroll/runs/${runId}/items/${adjustmentItemId}/adjustments`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            adjustmentType: adjustmentValues.adjustmentType,
            label: adjustmentValues.label.trim(),
            amount: Number.parseInt(adjustmentValues.amount.trim(), 10),
            notes: adjustmentValues.notes.trim() ? adjustmentValues.notes.trim() : null
          })
        }
      );

      const payload = (await response.json()) as AddPayrollAdjustmentResponse;

      if (!response.ok || !payload.data) {
        showToast("error", payload.error?.message ?? "Unable to add payroll adjustment.");
        return;
      }

      showToast("success", "Payroll adjustment applied.");
      setAdjustmentItemId(null);
      setAdjustmentValues(INITIAL_ADJUSTMENT_VALUES);
      setAdjustmentErrors({});
      runQuery.refresh();
    } catch (error) {
      showToast(
        "error",
        error instanceof Error ? error.message : "Unable to add payroll adjustment."
      );
    } finally {
      setIsSubmittingAdjustment(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Payroll Run"
        description="Review contractor payroll calculations and manage item-level adjustments."
        actions={
          canManage ? (
            <button
              type="button"
              className="button button-accent"
              onClick={calculateRun}
              disabled={isCalculating}
            >
              {isCalculating ? "Calculating..." : "Calculate run"}
            </button>
          ) : null
        }
      />

      {runQuery.isLoading ? itemTableSkeleton() : null}

      {!runQuery.isLoading && runQuery.errorMessage ? (
        <section className="payroll-dashboard-error">
          <EmptyState
            title="Payroll run is unavailable"
            description={runQuery.errorMessage}
            ctaLabel="Back to payroll"
            ctaHref="/payroll"
          />
          <button
            type="button"
            className="button button-accent"
            onClick={() => runQuery.refresh()}
          >
            Retry
          </button>
        </section>
      ) : null}

      {!runQuery.isLoading && !runQuery.errorMessage && runQuery.data ? (
        <>
          <section className="payroll-status-timeline" aria-label="Payroll status timeline">
            {summarizeStatusStep(runQuery.data.run.status).map((step) => (
              <article
                key={step.step}
                className={`payroll-status-step payroll-status-step-${step.state}`}
              >
                <span className="payroll-status-step-dot" />
                <p className="payroll-status-step-label">{labelForPayrollRunStatus(step.step)}</p>
              </article>
            ))}
          </section>

          <section className="payroll-run-summary-grid" aria-label="Payroll run summary">
            <article className="metric-card">
              <p className="metric-label">Status</p>
              <p className="metric-value">
                <StatusBadge tone={toneForPayrollRunStatus(runQuery.data.run.status)}>
                  {labelForPayrollRunStatus(runQuery.data.run.status)}
                </StatusBadge>
              </p>
              <p className="metric-hint">
                Pay date{" "}
                <time
                  dateTime={runQuery.data.run.payDate}
                  title={formatDateTimeTooltip(runQuery.data.run.payDate)}
                >
                  {new Date(`${runQuery.data.run.payDate}T00:00:00.000Z`).toLocaleDateString()}
                </time>
              </p>
            </article>

            <article className="metric-card">
              <p className="metric-label">Gross Total</p>
              <p className="metric-value">
                <CurrencyDisplay
                  amount={getCurrencyTotal(runQuery.data.run.totalGross, "USD")}
                  currency="USD"
                />
              </p>
              <p className="metric-hint">Calculated gross across items</p>
            </article>

            <article className="metric-card">
              <p className="metric-label">Net Total</p>
              <p className="metric-value">
                <CurrencyDisplay
                  amount={getCurrencyTotal(runQuery.data.run.totalNet, "USD")}
                  currency="USD"
                />
              </p>
              <p className="metric-hint">All adjustments included</p>
            </article>

            <article className="metric-card">
              <p className="metric-label">Employees</p>
              <p className="metric-value numeric">{runQuery.data.run.employeeCount}</p>
              <p className="metric-hint">Items currently in this run</p>
            </article>
          </section>

          {runQuery.data.flaggedCount > 0 ? (
            <section className="payroll-flag-banner">
              <StatusBadge tone="warning">
                {runQuery.data.flaggedCount} flagged item
                {runQuery.data.flaggedCount === 1 ? "" : "s"}
              </StatusBadge>
              <p className="settings-card-description">
                Review flagged rows before moving to approvals.
              </p>
            </section>
          ) : null}

          {sortedItems.length === 0 ? (
            <EmptyState
              title="No payroll items yet"
              description="Run calculation to populate employees in this payroll run."
              ctaLabel="Back to payroll"
              ctaHref="/payroll"
            />
          ) : (
            <section className="data-table-container" aria-label="Payroll run items">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>
                      <button
                        type="button"
                        className="table-sort-trigger"
                        onClick={() =>
                          setSortDirection((current) => (current === "asc" ? "desc" : "asc"))
                        }
                      >
                        Name
                        <span className="numeric">{sortDirection === "asc" ? "↑" : "↓"}</span>
                      </button>
                    </th>
                    <th>Dept</th>
                    <th>Country</th>
                    <th>Gross</th>
                    <th>Deductions</th>
                    <th>Net</th>
                    <th>Withholding</th>
                    <th className="table-action-column">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedItems.map((item) => (
                    <Fragment key={item.id}>
                      <tr
                        className={`data-table-row${item.flagged ? " payroll-flagged-row" : ""}`}
                      >
                        <td>
                          <p>{item.fullName}</p>
                          {item.flagged ? (
                            <p className="settings-card-description">
                              <StatusBadge tone="warning">Flagged</StatusBadge>
                            </p>
                          ) : null}
                        </td>
                        <td>{item.department ?? "--"}</td>
                        <td>
                          <p className="country-chip">
                            <span>{countryFlagFromCode(item.countryCode)}</span>
                            <span>{countryNameFromCode(item.countryCode)}</span>
                          </p>
                        </td>
                        <td>
                          <CurrencyDisplay amount={item.grossAmount} currency="USD" />
                        </td>
                        <td>
                          <CurrencyDisplay amount={item.deductionTotal} currency="USD" />
                        </td>
                        <td>
                          <CurrencyDisplay amount={item.netAmount} currency="USD" />
                        </td>
                        <td>
                          <StatusBadge tone="info">No withholding</StatusBadge>
                        </td>
                        <td className="table-row-action-cell">
                          <div className="payroll-row-actions">
                            <button
                              type="button"
                              className="table-row-action"
                              onClick={() =>
                                setExpandedItemId((current) =>
                                  current === item.id ? null : item.id
                                )
                              }
                            >
                              {expandedItemId === item.id ? "Collapse" : "Expand"}
                            </button>
                          </div>
                        </td>
                      </tr>

                      {expandedItemId === item.id ? (
                        <tr className="payroll-item-expanded-row">
                          <td colSpan={8}>
                            <section className="payroll-item-expanded-content">
                              {item.flagged && item.flagReason ? (
                                <article className="payroll-item-flag-note">
                                  <StatusBadge tone="warning">Flag reason</StatusBadge>
                                  <p>{item.flagReason}</p>
                                </article>
                              ) : null}

                              <div className="payroll-item-detail-grid">
                                <article className="settings-card">
                                  <h3 className="section-title">Breakdown</h3>
                                  <p>
                                    Base salary:{" "}
                                    <CurrencyDisplay amount={item.baseSalaryAmount} currency="USD" />
                                  </p>
                                  <ul className="payroll-allowance-list">
                                    {item.allowances.length > 0 ? (
                                      item.allowances.map((allowance, allowanceIndex) => (
                                        <li key={`${item.id}-allowance-${allowanceIndex}`}>
                                          <span>{allowance.label}</span>
                                          <CurrencyDisplay
                                            amount={allowance.amount}
                                            currency={allowance.currency}
                                          />
                                        </li>
                                      ))
                                    ) : (
                                      <li>No allowances</li>
                                    )}
                                  </ul>
                                  <p className="settings-card-description">{contractorNote()}</p>
                                  <p>
                                    Net pay:{" "}
                                    <CurrencyDisplay amount={item.netAmount} currency="USD" />
                                  </p>
                                </article>

                                <article className="settings-card">
                                  <h3 className="section-title">Adjustments</h3>
                                  <ul className="payroll-adjustment-list">
                                    {item.adjustments.length > 0 ? (
                                      item.adjustments.map((adjustment) => (
                                        <li key={adjustment.id}>
                                          <span>
                                            {adjustment.label} ({adjustment.type})
                                          </span>
                                          <CurrencyDisplay amount={adjustment.amount} currency="USD" />
                                        </li>
                                      ))
                                    ) : (
                                      <li>No adjustments</li>
                                    )}
                                  </ul>

                                  {canManage ? (
                                    adjustmentItemId === item.id ? (
                                      <form className="settings-form" onSubmit={submitAdjustment} noValidate>
                                        <label className="form-field" htmlFor={`adjustment-type-${item.id}`}>
                                          <span className="form-label">Type</span>
                                          <select
                                            id={`adjustment-type-${item.id}`}
                                            className={
                                              adjustmentErrors.adjustmentType
                                                ? "form-input form-input-error"
                                                : "form-input"
                                            }
                                            value={adjustmentValues.adjustmentType}
                                            onChange={(event) =>
                                              setAdjustmentValues((current) => ({
                                                ...current,
                                                adjustmentType: event.currentTarget
                                                  .value as PayrollAdjustmentType
                                              }))
                                            }
                                          >
                                            <option value="bonus">Bonus</option>
                                            <option value="deduction">Deduction</option>
                                            <option value="correction">Correction</option>
                                          </select>
                                          {adjustmentErrors.adjustmentType ? (
                                            <p className="form-field-error">
                                              {adjustmentErrors.adjustmentType}
                                            </p>
                                          ) : null}
                                        </label>

                                        <label className="form-field" htmlFor={`adjustment-label-${item.id}`}>
                                          <span className="form-label">Label</span>
                                          <input
                                            id={`adjustment-label-${item.id}`}
                                            className={
                                              adjustmentErrors.label
                                                ? "form-input form-input-error"
                                                : "form-input"
                                            }
                                            value={adjustmentValues.label}
                                            onChange={(event) =>
                                              setAdjustmentValues((current) => ({
                                                ...current,
                                                label: event.currentTarget.value
                                              }))
                                            }
                                          />
                                          {adjustmentErrors.label ? (
                                            <p className="form-field-error">{adjustmentErrors.label}</p>
                                          ) : null}
                                        </label>

                                        <label className="form-field" htmlFor={`adjustment-amount-${item.id}`}>
                                          <span className="form-label">Amount (smallest unit)</span>
                                          <input
                                            id={`adjustment-amount-${item.id}`}
                                            className={
                                              adjustmentErrors.amount
                                                ? "form-input form-input-error"
                                                : "form-input"
                                            }
                                            value={adjustmentValues.amount}
                                            onChange={(event) =>
                                              setAdjustmentValues((current) => ({
                                                ...current,
                                                amount: event.currentTarget.value
                                              }))
                                            }
                                          />
                                          {adjustmentErrors.amount ? (
                                            <p className="form-field-error">{adjustmentErrors.amount}</p>
                                          ) : null}
                                        </label>

                                        <label className="form-field" htmlFor={`adjustment-notes-${item.id}`}>
                                          <span className="form-label">Notes (optional)</span>
                                          <textarea
                                            id={`adjustment-notes-${item.id}`}
                                            className={
                                              adjustmentErrors.notes
                                                ? "form-input form-input-error"
                                                : "form-input"
                                            }
                                            rows={2}
                                            value={adjustmentValues.notes}
                                            onChange={(event) =>
                                              setAdjustmentValues((current) => ({
                                                ...current,
                                                notes: event.currentTarget.value
                                              }))
                                            }
                                          />
                                          {adjustmentErrors.notes ? (
                                            <p className="form-field-error">{adjustmentErrors.notes}</p>
                                          ) : null}
                                        </label>

                                        <div className="settings-actions">
                                          <button
                                            type="submit"
                                            className="button button-accent"
                                            disabled={isSubmittingAdjustment}
                                          >
                                            {isSubmittingAdjustment ? "Saving..." : "Apply adjustment"}
                                          </button>
                                          <button
                                            type="button"
                                            className="button button-subtle"
                                            onClick={() => {
                                              setAdjustmentItemId(null);
                                              setAdjustmentValues(INITIAL_ADJUSTMENT_VALUES);
                                              setAdjustmentErrors({});
                                            }}
                                          >
                                            Cancel
                                          </button>
                                        </div>
                                      </form>
                                    ) : (
                                      <button
                                        type="button"
                                        className="button button-accent"
                                        onClick={() => openAdjustmentPanel(item)}
                                      >
                                        Add adjustment
                                      </button>
                                    )
                                  ) : null}
                                </article>
                              </div>
                            </section>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </>
      ) : null}

      {toasts.length > 0 ? (
        <section className="toast-region" aria-live="polite" aria-label="Payroll toasts">
          {toasts.map((toast) => (
            <article key={toast.id} className={`toast-message toast-message-${toast.variant}`}>
              <p>{toast.message}</p>
              <button
                type="button"
                className="toast-dismiss"
                onClick={() => dismissToast(toast.id)}
                aria-label="Dismiss toast"
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
