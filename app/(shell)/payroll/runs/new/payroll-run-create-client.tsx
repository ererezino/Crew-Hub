"use client";

import { useRouter } from "next/navigation";
import { type ChangeEvent, type FormEvent, useMemo, useState } from "react";
import { z } from "zod";

import { EmptyState } from "../../../../../components/shared/empty-state";
import { ErrorState } from "../../../../../components/shared/error-state";
import { PageHeader } from "../../../../../components/shared/page-header";
import { StatusBadge } from "../../../../../components/shared/status-badge";
import { usePayrollRunsDashboard } from "../../../../../hooks/use-payroll-runs";
import { currentMonthPeriod } from "../../../../../lib/payroll/runs";
import type {
  CreatePayrollRunPayload,
  CreatePayrollRunResponse
} from "../../../../../types/payroll-runs";

type CreateRunFormValues = {
  payPeriodStart: string;
  payPeriodEnd: string;
  payDate: string;
  notes: string;
};

type FormField = keyof CreateRunFormValues;
type FormErrors = Partial<Record<FormField, string>>;
type FormTouched = Record<FormField, boolean>;

const createRunFormSchema = z
  .object({
    payPeriodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pay period start is required."),
    payPeriodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pay period end is required."),
    payDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pay date is required."),
    notes: z.string().max(500, "Notes must be 500 characters or fewer.")
  })
  .superRefine((value, context) => {
    if (value.payPeriodEnd < value.payPeriodStart) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["payPeriodEnd"],
        message: "Pay period end cannot be before pay period start."
      });
    }
  });

function initialValues(): CreateRunFormValues {
  const period = currentMonthPeriod();

  return {
    payPeriodStart: period.payPeriodStart,
    payPeriodEnd: period.payPeriodEnd,
    payDate: period.payDate,
    notes: ""
  };
}

const INITIAL_TOUCHED: FormTouched = {
  payPeriodStart: false,
  payPeriodEnd: false,
  payDate: false,
  notes: false
};

function getFormErrors(values: CreateRunFormValues, touched: FormTouched): FormErrors {
  const parsed = createRunFormSchema.safeParse(values);

  if (parsed.success) {
    return {};
  }

  const fieldErrors = parsed.error.flatten().fieldErrors;
  const errors: FormErrors = {};

  for (const field of Object.keys(touched) as FormField[]) {
    if (touched[field]) {
      errors[field] = fieldErrors[field]?.[0];
    }
  }

  return errors;
}

function hasErrors(errors: FormErrors): boolean {
  return Object.values(errors).some((value) => Boolean(value));
}

export function CreatePayrollRunClient() {
  const router = useRouter();
  const dashboardQuery = usePayrollRunsDashboard();

  const [formValues, setFormValues] = useState<CreateRunFormValues>(initialValues);
  const [formTouched, setFormTouched] = useState<FormTouched>(INITIAL_TOUCHED);
  const [formErrors, setFormErrors] = useState<FormErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const activeContractorCount = useMemo(
    () => dashboardQuery.data?.metrics.activeContractorCount ?? 0,
    [dashboardQuery.data?.metrics.activeContractorCount]
  );

  const markTouched = (field: FormField) => {
    setFormTouched((currentTouched) => {
      const nextTouched = { ...currentTouched, [field]: true };
      setFormErrors(getFormErrors(formValues, nextTouched));
      return nextTouched;
    });
  };

  const handleChange =
    (field: FormField) => (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const value = event.currentTarget.value;

      setFormValues((currentValues) => {
        const nextValues = { ...currentValues, [field]: value };
        setFormErrors(getFormErrors(nextValues, formTouched));
        return nextValues;
      });
    };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const nextTouched: FormTouched = {
      payPeriodStart: true,
      payPeriodEnd: true,
      payDate: true,
      notes: true
    };

    setFormTouched(nextTouched);

    const errors = getFormErrors(formValues, nextTouched);
    setFormErrors(errors);
    setSubmitError(null);

    if (hasErrors(errors)) {
      return;
    }

    const payload: CreatePayrollRunPayload = {
      payPeriodStart: formValues.payPeriodStart,
      payPeriodEnd: formValues.payPeriodEnd,
      payDate: formValues.payDate,
      notes: formValues.notes.trim() ? formValues.notes.trim() : null
    };

    setIsSubmitting(true);

    try {
      const response = await fetch("/api/v1/payroll/runs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      const responsePayload = (await response.json()) as CreatePayrollRunResponse;

      if (!response.ok || !responsePayload.data) {
        setSubmitError(responsePayload.error?.message ?? "Unable to create payroll run.");
        return;
      }

      router.push(`/payroll/runs/${responsePayload.data.run.id}`);
      router.refresh();
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Unable to create payroll run.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Create Payroll Run"
        description="Set pay period boundaries and pay date, then calculate contractor payroll."
      />

      {dashboardQuery.isLoading ? (
        <section className="payroll-create-skeleton" aria-hidden="true">
          <div className="payroll-create-skeleton-banner" />
          <div className="payroll-create-skeleton-form" />
        </section>
      ) : null}

      {!dashboardQuery.isLoading && dashboardQuery.errorMessage ? (
        <ErrorState
          title="Contractor count unavailable"
          message={dashboardQuery.errorMessage}
          onRetry={() => dashboardQuery.refresh()}
        />
      ) : null}

      {!dashboardQuery.isLoading && !dashboardQuery.errorMessage ? (
        <section className="settings-layout" aria-label="Create payroll run form">
          <article className="settings-card">
            <h2 className="section-title">Eligibility snapshot</h2>
            <p className="settings-card-description">
              <span className="numeric">{activeContractorCount}</span> active contractors are
              currently eligible for calculation.
            </p>
            <StatusBadge tone="info">Contractor mode: net equals gross</StatusBadge>
          </article>

          <form className="settings-card settings-form" onSubmit={handleSubmit} noValidate>
            <h2 className="section-title">Run details</h2>
            <p className="settings-card-description">
              Crew Hub calculates contractors with no tax withholding in this phase.
            </p>

            <div className="timeoff-form-grid">
              <label className="form-field" htmlFor="pay-period-start">
                <span className="form-label">Pay period start</span>
                <input
                  id="pay-period-start"
                  type="date"
                  className={
                    formErrors.payPeriodStart ? "form-input form-input-error" : "form-input"
                  }
                  value={formValues.payPeriodStart}
                  onChange={handleChange("payPeriodStart")}
                  onBlur={() => markTouched("payPeriodStart")}
                />
                {formErrors.payPeriodStart ? (
                  <p className="form-field-error">{formErrors.payPeriodStart}</p>
                ) : null}
              </label>

              <label className="form-field" htmlFor="pay-period-end">
                <span className="form-label">Pay period end</span>
                <input
                  id="pay-period-end"
                  type="date"
                  className={formErrors.payPeriodEnd ? "form-input form-input-error" : "form-input"}
                  value={formValues.payPeriodEnd}
                  onChange={handleChange("payPeriodEnd")}
                  onBlur={() => markTouched("payPeriodEnd")}
                />
                {formErrors.payPeriodEnd ? (
                  <p className="form-field-error">{formErrors.payPeriodEnd}</p>
                ) : null}
              </label>
            </div>

            <label className="form-field" htmlFor="pay-date">
              <span className="form-label">Pay date</span>
              <input
                id="pay-date"
                type="date"
                className={formErrors.payDate ? "form-input form-input-error" : "form-input"}
                value={formValues.payDate}
                onChange={handleChange("payDate")}
                onBlur={() => markTouched("payDate")}
              />
              {formErrors.payDate ? <p className="form-field-error">{formErrors.payDate}</p> : null}
            </label>

            <label className="form-field" htmlFor="run-notes">
              <span className="form-label">Notes (optional)</span>
              <textarea
                id="run-notes"
                className={formErrors.notes ? "form-input form-input-error" : "form-input"}
                value={formValues.notes}
                onChange={handleChange("notes")}
                onBlur={() => markTouched("notes")}
                rows={3}
              />
              {formErrors.notes ? <p className="form-field-error">{formErrors.notes}</p> : null}
            </label>

            {submitError ? (
              <p className="form-field-error" role="alert">
                {submitError}
              </p>
            ) : null}

            <div className="settings-actions">
              <button type="submit" className="button button-accent" disabled={isSubmitting}>
                {isSubmitting ? "Creating..." : "Create payroll run"}
              </button>
            </div>
          </form>
        </section>
      ) : null}
    </>
  );
}
