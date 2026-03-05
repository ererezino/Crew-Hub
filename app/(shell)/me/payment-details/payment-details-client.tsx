"use client";

import { type ChangeEvent, type FormEvent, useEffect, useMemo, useState } from "react";
import { z } from "zod";

import { EmptyState } from "../../../../components/shared/empty-state";
import { PageHeader } from "../../../../components/shared/page-header";
import { StatusBadge } from "../../../../components/shared/status-badge";
import { useMePaymentDetails } from "../../../../hooks/use-payment-details";
import { formatDateTimeTooltip, formatRelativeTime } from "../../../../lib/datetime";
import { formatHoldCountdown, methodLabel } from "../../../../lib/payment-details";
import {
  PAYMENT_METHODS,
  type MePaymentDetailsMutationResponse,
  type PaymentDetailsUpdatePayload,
  type PaymentMethod
} from "../../../../types/payment-details";

type ToastVariant = "success" | "error" | "info";

type ToastMessage = {
  id: string;
  variant: ToastVariant;
  message: string;
};

type PaymentDetailsFormValues = {
  paymentMethod: PaymentMethod;
  currency: string;
  bankName: string;
  bankAccountName: string;
  bankAccountNumber: string;
  bankRoutingNumber: string;
  mobileMoneyProvider: string;
  mobileMoneyNumber: string;
  wiseRecipientId: string;
};

type PaymentDetailsFormField = keyof PaymentDetailsFormValues;

type PaymentDetailsFormErrors = Partial<Record<PaymentDetailsFormField, string>>;

type PaymentDetailsFormTouched = Record<PaymentDetailsFormField, boolean>;

const paymentDetailsFormSchema = z.discriminatedUnion("paymentMethod", [
  z.object({
    paymentMethod: z.literal("bank_transfer"),
    currency: z.string().trim().regex(/^[A-Za-z]{3}$/, "Currency must be a 3-letter code."),
    bankName: z.string().trim().min(1, "Bank name is required.").max(200, "Bank name is too long."),
    bankAccountName: z
      .string()
      .trim()
      .min(1, "Account name is required.")
      .max(200, "Account name is too long."),
    bankAccountNumber: z
      .string()
      .trim()
      .regex(/^[0-9]{4,34}$/, "Account number must be 4-34 digits."),
    bankRoutingNumber: z.string().trim().max(100, "Routing number is too long.").optional(),
    mobileMoneyProvider: z.string().optional(),
    mobileMoneyNumber: z.string().optional(),
    wiseRecipientId: z.string().optional()
  }),
  z.object({
    paymentMethod: z.literal("mobile_money"),
    currency: z.string().trim().regex(/^[A-Za-z]{3}$/, "Currency must be a 3-letter code."),
    mobileMoneyProvider: z
      .string()
      .trim()
      .min(1, "Provider is required.")
      .max(120, "Provider is too long."),
    mobileMoneyNumber: z
      .string()
      .trim()
      .regex(/^\+?[0-9]{6,20}$/, "Mobile money number must be 6-20 digits."),
    bankName: z.string().optional(),
    bankAccountName: z.string().optional(),
    bankAccountNumber: z.string().optional(),
    bankRoutingNumber: z.string().optional(),
    wiseRecipientId: z.string().optional()
  }),
  z.object({
    paymentMethod: z.literal("wise"),
    currency: z.string().trim().regex(/^[A-Za-z]{3}$/, "Currency must be a 3-letter code."),
    wiseRecipientId: z
      .string()
      .trim()
      .min(4, "Wise recipient ID is required.")
      .max(200, "Wise recipient ID is too long."),
    bankName: z.string().optional(),
    bankAccountName: z.string().optional(),
    bankAccountNumber: z.string().optional(),
    bankRoutingNumber: z.string().optional(),
    mobileMoneyProvider: z.string().optional(),
    mobileMoneyNumber: z.string().optional()
  })
]);

const INITIAL_FORM_VALUES: PaymentDetailsFormValues = {
  paymentMethod: "bank_transfer",
  currency: "USD",
  bankName: "",
  bankAccountName: "",
  bankAccountNumber: "",
  bankRoutingNumber: "",
  mobileMoneyProvider: "",
  mobileMoneyNumber: "",
  wiseRecipientId: ""
};

const INITIAL_TOUCHED: PaymentDetailsFormTouched = {
  paymentMethod: false,
  currency: false,
  bankName: false,
  bankAccountName: false,
  bankAccountNumber: false,
  bankRoutingNumber: false,
  mobileMoneyProvider: false,
  mobileMoneyNumber: false,
  wiseRecipientId: false
};

function createToastId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function activeFieldsForMethod(method: PaymentMethod): PaymentDetailsFormField[] {
  if (method === "bank_transfer") {
    return [
      "paymentMethod",
      "currency",
      "bankName",
      "bankAccountName",
      "bankAccountNumber",
      "bankRoutingNumber"
    ];
  }

  if (method === "mobile_money") {
    return ["paymentMethod", "currency", "mobileMoneyProvider", "mobileMoneyNumber"];
  }

  return ["paymentMethod", "currency", "wiseRecipientId"];
}

function buildPayloadFromForm(values: PaymentDetailsFormValues): PaymentDetailsUpdatePayload {
  const normalizedCurrency = values.currency.trim().toUpperCase();

  if (values.paymentMethod === "bank_transfer") {
    return {
      paymentMethod: "bank_transfer",
      currency: normalizedCurrency,
      bankName: values.bankName.trim(),
      bankAccountName: values.bankAccountName.trim(),
      bankAccountNumber: values.bankAccountNumber.trim(),
      bankRoutingNumber: values.bankRoutingNumber.trim() || null
    };
  }

  if (values.paymentMethod === "mobile_money") {
    return {
      paymentMethod: "mobile_money",
      currency: normalizedCurrency,
      mobileMoneyProvider: values.mobileMoneyProvider.trim(),
      mobileMoneyNumber: values.mobileMoneyNumber.trim()
    };
  }

  return {
    paymentMethod: "wise",
    currency: normalizedCurrency,
    wiseRecipientId: values.wiseRecipientId.trim()
  };
}

function getFormErrors(
  values: PaymentDetailsFormValues,
  touched: PaymentDetailsFormTouched
): PaymentDetailsFormErrors {
  const payload = {
    ...values,
    currency: values.currency.trim().toUpperCase()
  };

  const parsed = paymentDetailsFormSchema.safeParse(payload);

  if (parsed.success) {
    return {};
  }

  const errors: PaymentDetailsFormErrors = {};
  const fieldErrors = parsed.error.flatten().fieldErrors;

  const activeFields = activeFieldsForMethod(values.paymentMethod);

  for (const field of activeFields) {
    if (touched[field]) {
      errors[field] = fieldErrors[field]?.[0];
    }
  }

  return errors;
}

function hasErrors(errors: PaymentDetailsFormErrors): boolean {
  return Object.values(errors).some((value) => Boolean(value));
}

function detailsCardSkeleton() {
  return (
    <section className="payment-details-skeleton-layout" aria-hidden="true">
      <div className="payment-details-skeleton-card" />
      <div className="payment-details-skeleton-form" />
    </section>
  );
}

export function MePaymentDetailsClient({ embedded = false }: { embedded?: boolean }) {
  const paymentDetailsQuery = useMePaymentDetails();

  const [formValues, setFormValues] = useState<PaymentDetailsFormValues>(INITIAL_FORM_VALUES);
  const [formTouched, setFormTouched] = useState<PaymentDetailsFormTouched>(INITIAL_TOUCHED);
  const [formErrors, setFormErrors] = useState<PaymentDetailsFormErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [liveHoldSeconds, setLiveHoldSeconds] = useState(0);

  useEffect(() => {
    const holdEndsAt = paymentDetailsQuery.data?.holdEndsAt;

    if (!holdEndsAt) {
      setLiveHoldSeconds(0);
      return;
    }

    const tick = () => {
      const remaining = Math.max(0, Math.ceil((Date.parse(holdEndsAt) - Date.now()) / 1000));
      setLiveHoldSeconds(remaining);
    };

    tick();

    const intervalId = window.setInterval(tick, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [paymentDetailsQuery.data?.holdEndsAt]);

  const holdActive = liveHoldSeconds > 0;

  const activeFields = useMemo(
    () => activeFieldsForMethod(formValues.paymentMethod),
    [formValues.paymentMethod]
  );

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

  const markTouched = (field: PaymentDetailsFormField) => {
    setFormTouched((currentTouched) => {
      const nextTouched = {
        ...currentTouched,
        [field]: true
      };

      setFormErrors(getFormErrors(formValues, nextTouched));
      return nextTouched;
    });
  };

  const handleChange =
    (field: PaymentDetailsFormField) =>
    (
      event: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
    ) => {
      const value = event.currentTarget.value;

      setFormValues((currentValues) => {
        const nextValues = {
          ...currentValues,
          [field]: value
        };

        setFormErrors(getFormErrors(nextValues, formTouched));
        return nextValues;
      });
    };

  const handleMethodChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const nextMethod = event.currentTarget.value as PaymentMethod;

    const nextValues = {
      ...formValues,
      paymentMethod: nextMethod
    };

    const nextTouched: PaymentDetailsFormTouched = {
      ...INITIAL_TOUCHED,
      paymentMethod: true,
      currency: formTouched.currency
    };

    setFormValues(nextValues);
    setFormTouched(nextTouched);
    setFormErrors(getFormErrors(nextValues, nextTouched));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const nextTouched: PaymentDetailsFormTouched = {
      ...formTouched
    };

    for (const field of activeFields) {
      nextTouched[field] = true;
    }

    setFormTouched(nextTouched);

    const errors = getFormErrors(formValues, nextTouched);
    setFormErrors(errors);

    if (hasErrors(errors)) {
      return;
    }

    const payload = buildPayloadFromForm(formValues);

    setIsSubmitting(true);

    try {
      const response = await fetch("/api/v1/me/payment-details", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      const responsePayload = (await response.json()) as MePaymentDetailsMutationResponse;

      if (!response.ok || !responsePayload.data) {
        showToast("error", responsePayload.error?.message ?? "Unable to update payment details.");
        return;
      }

      showToast("success", "Payment details saved. Changes will apply after a 48-hour hold.");

      setFormValues((currentValues) => ({
        ...currentValues,
        bankName: "",
        bankAccountName: "",
        bankAccountNumber: "",
        bankRoutingNumber: "",
        mobileMoneyProvider: "",
        mobileMoneyNumber: "",
        wiseRecipientId: ""
      }));
      setFormTouched(INITIAL_TOUCHED);
      setFormErrors({});
      paymentDetailsQuery.refresh();
    } catch (error) {
      showToast(
        "error",
        error instanceof Error ? error.message : "Unable to update payment details."
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      {!embedded ? (
        <PageHeader
          title="Payment Details"
          description="Manage payout destination details for Crew Hub payroll disbursements."
        />
      ) : null}

      {paymentDetailsQuery.isLoading ? detailsCardSkeleton() : null}

      {!paymentDetailsQuery.isLoading && paymentDetailsQuery.errorMessage ? (
        <section className="error-state">
          <EmptyState
            title="Payment details are unavailable"
            description={paymentDetailsQuery.errorMessage}
            ctaLabel="Back to dashboard"
            ctaHref="/dashboard"
          />
          <button
            type="button"
            className="button button-accent"
            onClick={() => paymentDetailsQuery.refresh()}
          >
            Retry
          </button>
        </section>
      ) : null}

      {!paymentDetailsQuery.isLoading && !paymentDetailsQuery.errorMessage ? (
        <section className="payment-details-layout" aria-label="Payment detail settings">
          {paymentDetailsQuery.data?.paymentDetail ? (
            <article className="payment-details-card" aria-live="polite">
              <header className="payment-details-card-header">
                <div>
                  <h2 className="section-title">Current payout destination</h2>
                  <p className="settings-card-description">
                    {methodLabel(paymentDetailsQuery.data.paymentDetail.paymentMethod)} •{" "}
                    {paymentDetailsQuery.data.paymentDetail.maskedDestination}
                  </p>
                </div>
                <div className="payment-details-card-status">
                  <StatusBadge
                    tone={paymentDetailsQuery.data.paymentDetail.isVerified ? "success" : "pending"}
                  >
                    {paymentDetailsQuery.data.paymentDetail.isVerified ? "Verified" : "Pending verification"}
                  </StatusBadge>
                  <StatusBadge tone="info">{paymentDetailsQuery.data.paymentDetail.currency}</StatusBadge>
                </div>
              </header>

              <dl className="payment-details-meta-grid">
                <div>
                  <dt>Method</dt>
                  <dd>{methodLabel(paymentDetailsQuery.data.paymentDetail.paymentMethod)}</dd>
                </div>
                <div>
                  <dt>Masked destination</dt>
                  <dd className="numeric">{paymentDetailsQuery.data.paymentDetail.maskedDestination}</dd>
                </div>
                <div>
                  <dt>Last updated</dt>
                  <dd>
                    <time
                      dateTime={paymentDetailsQuery.data.paymentDetail.updatedAt}
                      title={formatDateTimeTooltip(paymentDetailsQuery.data.paymentDetail.updatedAt)}
                    >
                      {formatRelativeTime(paymentDetailsQuery.data.paymentDetail.updatedAt)}
                    </time>
                  </dd>
                </div>
              </dl>
            </article>
          ) : (
            <EmptyState
              title="No payment details on file"
              description="Add your payout destination below. Changes are held for 48 hours before activation."
              ctaLabel="Go to dashboard"
              ctaHref="/dashboard"
            />
          )}

          {holdActive ? (
            <article className="payment-details-hold-warning" aria-live="polite">
              <h3 className="section-title">48-hour hold in effect</h3>
              <p className="settings-card-description">
                Updated details become active in <span className="numeric">{formatHoldCountdown(liveHoldSeconds)}</span>.
              </p>
              {paymentDetailsQuery.data?.holdEndsAt ? (
                <p className="settings-card-description">
                  Effective at{" "}
                  <time
                    dateTime={paymentDetailsQuery.data.holdEndsAt}
                    title={formatDateTimeTooltip(paymentDetailsQuery.data.holdEndsAt)}
                  >
                    {formatRelativeTime(paymentDetailsQuery.data.holdEndsAt)}
                  </time>
                  .
                </p>
              ) : null}
            </article>
          ) : null}

          <section className="settings-card" aria-label="Edit payment details">
            <h2 className="section-title">Edit payment details</h2>
            <p className="settings-card-description">
              Crew Hub encrypts sensitive payout fields with AES-256-GCM. Updates always apply after 48 hours.
            </p>

            <form className="settings-form" onSubmit={handleSubmit} noValidate>
              <div className="timeoff-form-grid">
                <label className="form-field" htmlFor="payment-method">
                  <span className="form-label">Payment method</span>
                  <select
                    id="payment-method"
                    className={
                      formErrors.paymentMethod ? "form-input form-input-error" : "form-input"
                    }
                    value={formValues.paymentMethod}
                    onChange={handleMethodChange}
                    onBlur={() => markTouched("paymentMethod")}
                  >
                    {PAYMENT_METHODS.map((method) => (
                      <option key={method} value={method}>
                        {methodLabel(method)}
                      </option>
                    ))}
                  </select>
                  {formErrors.paymentMethod ? (
                    <p className="form-field-error">{formErrors.paymentMethod}</p>
                  ) : null}
                </label>

                <label className="form-field" htmlFor="payment-currency">
                  <span className="form-label">Currency</span>
                  <input
                    id="payment-currency"
                    className={formErrors.currency ? "form-input form-input-error" : "form-input"}
                    value={formValues.currency}
                    onChange={handleChange("currency")}
                    onBlur={() => markTouched("currency")}
                  />
                  {formErrors.currency ? <p className="form-field-error">{formErrors.currency}</p> : null}
                </label>
              </div>

              {formValues.paymentMethod === "bank_transfer" ? (
                <>
                  <label className="form-field" htmlFor="bank-name">
                    <span className="form-label">Bank name</span>
                    <input
                      id="bank-name"
                      className={formErrors.bankName ? "form-input form-input-error" : "form-input"}
                      value={formValues.bankName}
                      onChange={handleChange("bankName")}
                      onBlur={() => markTouched("bankName")}
                    />
                    {formErrors.bankName ? <p className="form-field-error">{formErrors.bankName}</p> : null}
                  </label>

                  <div className="timeoff-form-grid">
                    <label className="form-field" htmlFor="bank-account-name">
                      <span className="form-label">Account name</span>
                      <input
                        id="bank-account-name"
                        className={
                          formErrors.bankAccountName ? "form-input form-input-error" : "form-input"
                        }
                        value={formValues.bankAccountName}
                        onChange={handleChange("bankAccountName")}
                        onBlur={() => markTouched("bankAccountName")}
                      />
                      {formErrors.bankAccountName ? (
                        <p className="form-field-error">{formErrors.bankAccountName}</p>
                      ) : null}
                    </label>

                    <label className="form-field" htmlFor="bank-account-number">
                      <span className="form-label">Account number</span>
                      <input
                        id="bank-account-number"
                        className={
                          formErrors.bankAccountNumber ? "form-input form-input-error" : "form-input"
                        }
                        value={formValues.bankAccountNumber}
                        onChange={handleChange("bankAccountNumber")}
                        onBlur={() => markTouched("bankAccountNumber")}
                      />
                      {formErrors.bankAccountNumber ? (
                        <p className="form-field-error">{formErrors.bankAccountNumber}</p>
                      ) : null}
                    </label>
                  </div>

                  <label className="form-field" htmlFor="bank-routing-number">
                    <span className="form-label">Routing number (optional)</span>
                    <input
                      id="bank-routing-number"
                      className={
                        formErrors.bankRoutingNumber ? "form-input form-input-error" : "form-input"
                      }
                      value={formValues.bankRoutingNumber}
                      onChange={handleChange("bankRoutingNumber")}
                      onBlur={() => markTouched("bankRoutingNumber")}
                    />
                    {formErrors.bankRoutingNumber ? (
                      <p className="form-field-error">{formErrors.bankRoutingNumber}</p>
                    ) : null}
                  </label>
                </>
              ) : null}

              {formValues.paymentMethod === "mobile_money" ? (
                <>
                  <div className="timeoff-form-grid">
                    <label className="form-field" htmlFor="mobile-provider">
                      <span className="form-label">Provider</span>
                      <input
                        id="mobile-provider"
                        className={
                          formErrors.mobileMoneyProvider ? "form-input form-input-error" : "form-input"
                        }
                        value={formValues.mobileMoneyProvider}
                        onChange={handleChange("mobileMoneyProvider")}
                        onBlur={() => markTouched("mobileMoneyProvider")}
                      />
                      {formErrors.mobileMoneyProvider ? (
                        <p className="form-field-error">{formErrors.mobileMoneyProvider}</p>
                      ) : null}
                    </label>

                    <label className="form-field" htmlFor="mobile-number">
                      <span className="form-label">Mobile money number</span>
                      <input
                        id="mobile-number"
                        className={
                          formErrors.mobileMoneyNumber ? "form-input form-input-error" : "form-input"
                        }
                        value={formValues.mobileMoneyNumber}
                        onChange={handleChange("mobileMoneyNumber")}
                        onBlur={() => markTouched("mobileMoneyNumber")}
                      />
                      {formErrors.mobileMoneyNumber ? (
                        <p className="form-field-error">{formErrors.mobileMoneyNumber}</p>
                      ) : null}
                    </label>
                  </div>
                </>
              ) : null}

              {formValues.paymentMethod === "wise" ? (
                <label className="form-field" htmlFor="wise-recipient-id">
                  <span className="form-label">Wise recipient ID</span>
                  <input
                    id="wise-recipient-id"
                    className={
                      formErrors.wiseRecipientId ? "form-input form-input-error" : "form-input"
                    }
                    value={formValues.wiseRecipientId}
                    onChange={handleChange("wiseRecipientId")}
                    onBlur={() => markTouched("wiseRecipientId")}
                  />
                  {formErrors.wiseRecipientId ? (
                    <p className="form-field-error">{formErrors.wiseRecipientId}</p>
                  ) : null}
                </label>
              ) : null}

              <div className="settings-actions">
                <button type="submit" className="button button-accent" disabled={isSubmitting}>
                  {isSubmitting ? "Saving..." : "Save payment details"}
                </button>
              </div>
            </form>
          </section>
        </section>
      ) : null}

      {toasts.length > 0 ? (
        <section className="toast-region" aria-live="polite" aria-label="Payment detail toasts">
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
