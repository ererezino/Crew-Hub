"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";

import { DeltaBadge } from "../../../../components/dashboard/delta-badge";
import { DocumentViewer } from "../../../../components/shared/document-viewer";
import { EmptyState } from "../../../../components/shared/empty-state";
import { PageHeader } from "../../../../components/shared/page-header";
import { StatusBadge } from "../../../../components/shared/status-badge";
import { CurrencyDisplay } from "../../../../components/ui/currency-display";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../../components/ui/select";
import { useMePayslips } from "../../../../hooks/use-payslips";
import { formatMonth, formatDateTimeTooltip, formatRelativeTime } from "../../../../lib/datetime";
import type {
  ItemPaymentStatus,
  PaymentStatementRecord,
  PaymentStatementSignedUrlResponse,
  PayMonth
} from "../../../../types/payslips";
import { humanizeError } from "@/lib/errors";

type AppLocale = "en" | "fr";
type ToastVariant = "success" | "error" | "info";

type ToastMessage = {
  id: string;
  variant: ToastVariant;
  message: string;
};

function createToastId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function formatPayPeriod(payPeriod: string, locale: AppLocale): string {
  const [yearValue, monthValue] = payPeriod.split("-");
  const year = Number.parseInt(yearValue ?? "", 10);
  const month = Number.parseInt(monthValue ?? "", 10);

  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    return payPeriod;
  }

  const isoDate = `${yearValue}-${monthValue}-01`;
  return formatMonth(isoDate, locale);
}

function statementCardSkeleton() {
  return (
    <section className="payslips-skeleton-grid" aria-hidden="true">
      {Array.from({ length: 6 }, (_, index) => (
        <div key={`payslip-card-skeleton-${index}`} className="payslips-skeleton-card" />
      ))}
    </section>
  );
}

function metricsSkeleton() {
  return (
    <section className="metric-grid" aria-hidden="true">
      {Array.from({ length: 4 }, (_, index) => (
        <div key={`payslip-metric-skeleton-${index}`} className="payslips-skeleton-metric" />
      ))}
    </section>
  );
}

function signedCurrencyPrefix(value: number | null): string {
  if (value === null || value === 0) {
    return "";
  }

  return value > 0 ? "+" : "-";
}

function absoluteAmount(value: number | null): number {
  if (value === null) {
    return 0;
  }

  return Math.abs(value);
}

function paymentStatusTone(status: ItemPaymentStatus): "success" | "pending" | "processing" | "warning" | "error" | "draft" {
  switch (status) {
    case "paid":
      return "success";
    case "partially_paid":
      return "warning";
    case "processing":
      return "processing";
    case "pending":
      return "pending";
    case "failed":
      return "error";
    case "cancelled":
      return "draft";
    default:
      return "pending";
  }
}

const PAYMENT_STATUS_KEYS = {
  paid: "fullyPaid",
  partially_paid: "partiallyPaid",
  processing: "paymentProcessing",
  pending: "paymentPending",
  failed: "paymentFailed",
  cancelled: "paymentCancelled"
} as const;

type PaymentStatusI18nKey = typeof PAYMENT_STATUS_KEYS[keyof typeof PAYMENT_STATUS_KEYS];

function paymentStatusKey(status: ItemPaymentStatus): PaymentStatusI18nKey {
  return PAYMENT_STATUS_KEYS[status] ?? "paymentPending";
}

export function MePayslipsClient({ embedded = false }: { embedded?: boolean }) {
  const t = useTranslations('payslips');
  const tCommon = useTranslations('common');
  const locale = useLocale() as AppLocale;

  const [selectedYear, setSelectedYear] = useState(new Date().getUTCFullYear());
  const [activeStatementId, setActiveStatementId] = useState<string | null>(null);
  const [viewerUrl, setViewerUrl] = useState<string | null>(null);
  const [viewerPayPeriod, setViewerPayPeriod] = useState<string | null>(null);
  const [isViewerLoading, setIsViewerLoading] = useState(false);
  const [isOpeningById, setIsOpeningById] = useState<Record<string, boolean>>({});
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const payslipsQuery = useMePayslips(selectedYear);

  const availableYears = useMemo(() => {
    if (!payslipsQuery.data?.availableYears || payslipsQuery.data.availableYears.length === 0) {
      return [selectedYear];
    }

    const yearOptions = new Set(payslipsQuery.data.availableYears);
    yearOptions.add(selectedYear);

    return [...yearOptions].sort((leftYear, rightYear) => rightYear - leftYear);
  }, [payslipsQuery.data?.availableYears, selectedYear]);

  const months: PayMonth[] = payslipsQuery.data?.months ?? [];
  const statements = payslipsQuery.data?.statements ?? [];
  const summary = payslipsQuery.data?.summary ?? {
    grossAmount: 0,
    deductionsAmount: 0,
    netAmount: 0,
    amountDisbursed: 0,
    monthsPaid: 0,
    currency: "USD"
  };

  useEffect(() => {
    setActiveStatementId(null);
    setViewerUrl(null);
    setViewerPayPeriod(null);
    setIsViewerLoading(false);
  }, [selectedYear]);

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

  const openStatement = async (
    statement: PaymentStatementRecord,
    usage: "view" | "download"
  ) => {
    setIsOpeningById((currentMap) => ({
      ...currentMap,
      [statement.id]: true
    }));

    if (usage === "view") {
      setIsViewerLoading(true);
      setActiveStatementId(statement.id);
      setViewerUrl(null);
      setViewerPayPeriod(statement.payPeriod);
    }

    try {
      const searchParams = new URLSearchParams({
        usage,
        expiresIn: usage === "view" ? "240" : "180"
      });

      const response = await fetch(
        `/api/v1/me/payslips/${statement.id}/download?${searchParams.toString()}`,
        {
          method: "GET"
        }
      );

      const payload = (await response.json()) as PaymentStatementSignedUrlResponse;

      if (!response.ok || !payload.data?.url) {
        showToast("error", payload.error?.message ?? t('toastOpenError'));
        if (usage === "view") {
          setActiveStatementId(null);
          setViewerPayPeriod(null);
          setViewerUrl(null);
        }
        return;
      }

      if (usage === "download") {
        window.open(payload.data.url, "_blank", "noopener,noreferrer");
        showToast("success", t('toastDownloadOpened'));
        return;
      }

      setViewerUrl(payload.data.url);
      showToast("info", t('toastLoaded'));
      payslipsQuery.refresh();
    } catch (error) {
      showToast(
        "error",
        error instanceof Error ? error.message : t('toastOpenError')
      );

      if (usage === "view") {
        setActiveStatementId(null);
        setViewerPayPeriod(null);
        setViewerUrl(null);
      }
    } finally {
      setIsOpeningById((currentMap) => {
        const nextMap = { ...currentMap };
        delete nextMap[statement.id];
        return nextMap;
      });

      if (usage === "view") {
        setIsViewerLoading(false);
      }
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

      <section className="payslips-toolbar" aria-label={t('title')}>
        <div className="form-field">
          <span className="form-label">{t('yearLabel')}</span>
          <Select
            value={String(selectedYear)}
            onValueChange={(value) => {
              const nextYear = Number.parseInt(value, 10);
              if (Number.isFinite(nextYear)) {
                setSelectedYear(nextYear);
              }
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {availableYears.map((yearOption) => (
                <SelectItem key={`payslip-year-${yearOption}`} value={String(yearOption)}>
                  {yearOption}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </section>

      {payslipsQuery.isLoading ? metricsSkeleton() : null}

      {!payslipsQuery.isLoading && payslipsQuery.errorMessage ? (
        <>
          <EmptyState
            title={t('unavailable')}
            description={payslipsQuery.errorMessage}
          />
          <button
            type="button"
            className="button button-accent"
            onClick={() => payslipsQuery.refresh()}
          >
            {tCommon('retry')}
          </button>
        </>
      ) : null}

      {!payslipsQuery.isLoading && !payslipsQuery.errorMessage ? (
        <section className="metric-grid" aria-label={t('summaryAriaLabel')}>
          <article className="metric-card">
            <p className="metric-label">{t('ytdGross')}</p>
            <p className="metric-value">
              <CurrencyDisplay amount={summary.grossAmount} currency={summary.currency} />
            </p>
            <p className="metric-hint">{t('ytdGrossHint', { year: selectedYear })}</p>
          </article>

          <article className="metric-card">
            <p className="metric-label">{t('ytdDeductions')}</p>
            <p className="metric-value">
              <CurrencyDisplay amount={summary.deductionsAmount} currency={summary.currency} />
            </p>
            <p className="metric-hint">{t('ytdDeductionsHint')}</p>
          </article>

          <article className="metric-card">
            <p className="metric-label">{t('ytdNet')}</p>
            <p className="metric-value">
              <CurrencyDisplay amount={summary.amountDisbursed} currency={summary.currency} />
            </p>
            <p className="metric-hint">{t('ytdNetHint', { year: selectedYear })}</p>
          </article>

          <article className="metric-card">
            <p className="metric-label">{t('monthsPaid')}</p>
            <p className="metric-value numeric">{summary.monthsPaid}</p>
            <p className="metric-hint">{t('monthsPaidHint')}</p>
          </article>
        </section>
      ) : null}

      {payslipsQuery.isLoading ? statementCardSkeleton() : null}

      {!payslipsQuery.isLoading &&
      !payslipsQuery.errorMessage &&
      months.length === 0 ? (
        <EmptyState
          title={t('noStatements')}
          description={t('noStatementsDescription')}
        />
      ) : null}

      {/* ── Month-grouped pay cards ── */}
      {!payslipsQuery.isLoading &&
      !payslipsQuery.errorMessage &&
      months.length > 0 ? (
        <section className="pay-month-list" aria-label={t('statementsAriaLabel')}>
          {months.map((month) => {
            const primaryStatement = month.statements[0];
            if (!primaryStatement) return null;

            const monthLabel = formatPayPeriod(month.payPeriod, locale);
            const hasMultipleStatements = month.statements.length > 1;
            const isPartiallyDisbursed =
              month.paymentStatus === "partially_paid" ||
              (month.amountDisbursed > 0 && month.amountDisbursed < month.totalNet);

            return (
              <article
                key={month.payPeriod}
                className="pay-month-card"
                aria-label={t('monthAriaLabel', { month: monthLabel })}
              >
                {/* ── Month header ── */}
                <header className="pay-month-header">
                  <div>
                    <h2 className="section-title">{monthLabel}</h2>
                    <p className="settings-card-description">
                      {t('generated', { date: formatRelativeTime(primaryStatement.generatedAt, locale) })}
                    </p>
                  </div>

                  <div className="payslip-card-badges">
                    <StatusBadge tone={paymentStatusTone(month.paymentStatus)}>
                      {t(paymentStatusKey(month.paymentStatus))}
                    </StatusBadge>
                    {month.hasHistorical ? (
                      <StatusBadge tone="info">{t('historicalBadge')}</StatusBadge>
                    ) : null}
                    {month.hasAmendment ? (
                      <StatusBadge tone="warning">{t('amendmentBadge')}</StatusBadge>
                    ) : null}
                  </div>
                </header>

                {/* ── Amount (hero) — show confirmed disbursed for partial months ── */}
                <div className="payslip-card-amount">
                  <CurrencyDisplay
                    amount={month.paymentStatus === "paid" ? month.totalNet : month.amountDisbursed}
                    currency={month.currency}
                  />
                  {month.paymentStatus !== "paid" && month.totalNet > 0 ? (
                    <span className="pay-month-of-total">
                      {" / "}<CurrencyDisplay amount={month.totalNet} currency={month.currency} />
                    </span>
                  ) : null}
                </div>

                {/* ── Disbursement progress (partial/pending) ── */}
                {month.paymentStatus !== "paid" && month.totalNet > 0 ? (
                  <div className="pay-month-disbursement">
                    <div className="pay-month-progress-track">
                      <div
                        className="pay-month-progress-fill"
                        style={{
                          width: `${Math.min(100, Math.round((month.amountDisbursed / month.totalNet) * 100))}%`
                        }}
                      />
                    </div>
                    <p className="pay-month-disbursement-copy">
                      {isPartiallyDisbursed ? (
                        <>
                          <CurrencyDisplay amount={month.amountDisbursed} currency={month.currency} />
                          {" "}{t('remainingAmount', { amount: '' })}
                          <CurrencyDisplay amount={month.amountRemaining} currency={month.currency} />
                        </>
                      ) : (
                        t('paymentPending')
                      )}
                    </p>
                  </div>
                ) : null}

                {/* ── Variance copy ── */}
                {primaryStatement.previousNetAmount !== null ? (
                  <p className="payslip-variance-copy">
                    {t('varianceCopy', { period: formatPayPeriod(primaryStatement.previousPayPeriod ?? "", locale) })}
                  </p>
                ) : (
                  <p className="payslip-variance-copy">{t('noVariance')}</p>
                )}

                {/* ── Month-level breakdown ── */}
                <dl className="payslip-card-meta">
                  <div>
                    <dt>{t('gross')}</dt>
                    <dd>
                      <CurrencyDisplay amount={month.totalGross} currency={month.currency} />
                    </dd>
                  </div>
                  <div>
                    <dt>{t('deductions')}</dt>
                    <dd>
                      <CurrencyDisplay amount={month.totalDeductions} currency={month.currency} />
                    </dd>
                  </div>
                  <div>
                    <dt>{t('paymentLabel')}</dt>
                    <dd>
                      <StatusBadge tone={paymentStatusTone(month.paymentStatus)}>
                        {t(paymentStatusKey(month.paymentStatus))}
                      </StatusBadge>
                    </dd>
                  </div>
                  <div>
                    <dt>{t('netChange')}</dt>
                    <dd className="payslip-variance-value">
                      {primaryStatement.previousNetAmount !== null ? (
                        <>
                          <DeltaBadge
                            current={month.totalNet}
                            previous={primaryStatement.previousNetAmount}
                          />
                          <span className="numeric">
                            {signedCurrencyPrefix(primaryStatement.netVarianceAmount)}
                            <CurrencyDisplay
                              amount={absoluteAmount(primaryStatement.netVarianceAmount)}
                              currency={month.currency}
                            />
                          </span>
                        </>
                      ) : (
                        <span className="settings-card-description">{t('noBaseline')}</span>
                      )}
                    </dd>
                  </div>
                </dl>

                {/* ── Per-statement rows (visible when month has multiple) ── */}
                {hasMultipleStatements ? (
                  <div className="pay-month-statements">
                    <p className="pay-month-statements-label">
                      {t('statementsInMonth', { count: month.statements.length })}
                    </p>
                    {month.statements.map((statement) => (
                      <div
                        key={statement.id}
                        className={`pay-month-statement-row${
                          activeStatementId === statement.id ? " pay-month-statement-row-active" : ""
                        }`}
                      >
                        <div className="pay-month-statement-info">
                          <span className="pay-month-statement-amount">
                            <CurrencyDisplay amount={statement.netAmount} currency={statement.currency} />
                          </span>
                          <span className="pay-month-statement-type">
                            {statement.isAmendment ? (
                              <StatusBadge tone="warning">{t('amendmentStatement')}</StatusBadge>
                            ) : (
                              <StatusBadge tone={statement.withholdingApplied ? "success" : "draft"}>
                                {statement.withholdingApplied ? t('payslipType') : t('paymentStatementType')}
                              </StatusBadge>
                            )}
                          </span>
                          {statement.viewedAt ? null : (
                            <StatusBadge tone="pending">{t('notViewed')}</StatusBadge>
                          )}
                        </div>
                        <div className="pay-month-statement-actions">
                          <button
                            type="button"
                            className="button button-accent button-sm"
                            onClick={() => { void openStatement(statement, "view"); }}
                            disabled={Boolean(isOpeningById[statement.id])}
                          >
                            {isOpeningById[statement.id] ? t('opening') : t('view')}
                          </button>
                          <button
                            type="button"
                            className="button button-subtle button-sm"
                            onClick={() => { void openStatement(statement, "download"); }}
                            disabled={Boolean(isOpeningById[statement.id])}
                          >
                            {t('download')}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}

                {/* ── Actions for single-statement months ── */}
                {!hasMultipleStatements ? (
                  <div className="payslip-card-actions">
                    <button
                      type="button"
                      className="button button-accent"
                      onClick={() => {
                        void openStatement(primaryStatement, "view");
                      }}
                      disabled={Boolean(isOpeningById[primaryStatement.id])}
                    >
                      {isOpeningById[primaryStatement.id] && activeStatementId === primaryStatement.id
                        ? t('opening')
                        : t('view')}
                    </button>
                    <button
                      type="button"
                      className="button button-subtle"
                      onClick={() => {
                        void openStatement(primaryStatement, "download");
                      }}
                      disabled={Boolean(isOpeningById[primaryStatement.id])}
                    >
                      {isOpeningById[primaryStatement.id] && activeStatementId !== primaryStatement.id
                        ? t('preparing')
                        : t('download')}
                    </button>
                  </div>
                ) : null}
              </article>
            );
          })}
        </section>
      ) : null}

      <DocumentViewer
        isOpen={activeStatementId !== null && !isViewerLoading}
        title={
          viewerPayPeriod
            ? t('viewerTitleWithPeriod', { period: formatPayPeriod(viewerPayPeriod, locale) })
            : t('viewerTitle')
        }
        documentUrl={viewerUrl}
        fileName={
          viewerPayPeriod
            ? `payslip-${viewerPayPeriod}.pdf`
            : "payslip.pdf"
        }
        mimeType="application/pdf"
        onClose={() => {
          setActiveStatementId(null);
          setViewerUrl(null);
          setViewerPayPeriod(null);
        }}
        onRefreshUrl={
          activeStatementId
            ? async () => {
                const activeStatement = statements.find(
                  (s) => s.id === activeStatementId
                );
                if (!activeStatement) return null;
                const searchParams = new URLSearchParams({
                  usage: "view",
                  expiresIn: "240"
                });
                try {
                  const response = await fetch(
                    `/api/v1/me/payslips/${activeStatement.id}/download?${searchParams.toString()}`
                  );
                  const payload =
                    (await response.json()) as PaymentStatementSignedUrlResponse;
                  if (response.ok && payload.data?.url) {
                    setViewerUrl(payload.data.url);
                    return payload.data.url;
                  }
                } catch {
                  // refresh failed
                }
                return null;
              }
            : undefined
        }
      />

      {toasts.length > 0 ? (
        <section className="toast-region" aria-live="polite" aria-label={t('toastAriaLabel')}>
          {toasts.map((toast) => (
            <article key={toast.id} className={`toast-message toast-message-${toast.variant}`}>
              <p>{toast.message}</p>
              <button
                type="button"
                className="toast-dismiss"
                onClick={() => dismissToast(toast.id)}
                aria-label={tCommon('close')}
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
