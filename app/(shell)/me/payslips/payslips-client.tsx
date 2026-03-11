"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";

import { DeltaBadge } from "../../../../components/dashboard/delta-badge";
import { EmptyState } from "../../../../components/shared/empty-state";
import { PageHeader } from "../../../../components/shared/page-header";
import { StatusBadge } from "../../../../components/shared/status-badge";
import { CurrencyDisplay } from "../../../../components/ui/currency-display";
import { useMePayslips } from "../../../../hooks/use-payslips";
import { formatMonth, formatDateTimeTooltip, formatRelativeTime } from "../../../../lib/datetime";
import type {
  PaymentStatementRecord,
  PaymentStatementSignedUrlResponse
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

  const statements = payslipsQuery.data?.statements ?? [];
  const summary = payslipsQuery.data?.summary ?? {
    grossAmount: 0,
    deductionsAmount: 0,
    netAmount: 0,
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
        <label className="form-field" htmlFor="payslips-year-filter">
          <span className="form-label">{t('yearLabel')}</span>
          <select
            id="payslips-year-filter"
            className="form-input"
            value={selectedYear}
            onChange={(event) => {
              const nextYear = Number.parseInt(event.currentTarget.value, 10);
              if (Number.isFinite(nextYear)) {
                setSelectedYear(nextYear);
              }
            }}
          >
            {availableYears.map((yearOption) => (
              <option key={`payslip-year-${yearOption}`} value={yearOption}>
                {yearOption}
              </option>
            ))}
          </select>
        </label>
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
              <CurrencyDisplay amount={summary.netAmount} currency={summary.currency} />
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
      statements.length === 0 ? (
        <EmptyState
          title={t('noStatements')}
          description={t('noStatementsDescription')}
        />
      ) : null}

      {!payslipsQuery.isLoading &&
      !payslipsQuery.errorMessage &&
      statements.length > 0 ? (
        <section className="payslip-card-grid" aria-label={t('statementsAriaLabel')}>
          {statements.map((statement) => (
            <article
              key={statement.id}
              className={
                activeStatementId === statement.id
                  ? "payslip-card payslip-card-active"
                  : "payslip-card"
              }
            >
              <header className="payslip-card-header">
                <div>
                  <h2 className="section-title">{formatPayPeriod(statement.payPeriod, locale)}</h2>
                  <p className="settings-card-description">
                    {t('generated', { date: formatRelativeTime(statement.generatedAt, locale) })}
                  </p>
                </div>

                <StatusBadge tone={statement.withholdingApplied ? "processing" : "draft"}>
                  {statement.withholdingApplied ? t('payslipType') : t('paymentStatementType')}
                </StatusBadge>
              </header>

              <div className="payslip-card-amount">
                <CurrencyDisplay amount={statement.netAmount} currency={statement.currency} />
              </div>

              {statement.previousNetAmount !== null ? (
                <p className="payslip-variance-copy">
                  {t('varianceCopy', { period: formatPayPeriod(statement.previousPayPeriod ?? "", locale) })}
                </p>
              ) : (
                <p className="payslip-variance-copy">{t('noVariance')}</p>
              )}

              <dl className="payslip-card-meta">
                <div>
                  <dt>{t('gross')}</dt>
                  <dd>
                    <CurrencyDisplay amount={statement.grossAmount} currency={statement.currency} />
                  </dd>
                </div>
                <div>
                  <dt>{t('deductions')}</dt>
                  <dd>
                    <CurrencyDisplay
                      amount={statement.deductionsAmount}
                      currency={statement.currency}
                    />
                  </dd>
                </div>
                <div>
                  <dt>{t('statusLabel')}</dt>
                  <dd>
                    {statement.viewedAt ? (
                      <span
                        className="numeric"
                        title={formatDateTimeTooltip(statement.viewedAt, locale)}
                      >
                        {t('viewedAt', { date: formatRelativeTime(statement.viewedAt, locale) })}
                      </span>
                    ) : (
                      t('notViewed')
                    )}
                  </dd>
                </div>
                <div>
                  <dt>{t('netChange')}</dt>
                  <dd className="payslip-variance-value">
                    {statement.previousNetAmount !== null ? (
                      <>
                        <DeltaBadge
                          current={statement.netAmount}
                          previous={statement.previousNetAmount}
                        />
                        <span className="numeric">
                          {signedCurrencyPrefix(statement.netVarianceAmount)}
                          <CurrencyDisplay
                            amount={absoluteAmount(statement.netVarianceAmount)}
                            currency={statement.currency}
                          />
                        </span>
                      </>
                    ) : (
                      <span className="settings-card-description">{t('noBaseline')}</span>
                    )}
                  </dd>
                </div>
              </dl>

              <div className="payslip-card-actions">
                <button
                  type="button"
                  className="table-row-action"
                  onClick={() => {
                    void openStatement(statement, "view");
                  }}
                  disabled={Boolean(isOpeningById[statement.id])}
                >
                  {isOpeningById[statement.id] && activeStatementId === statement.id
                    ? t('opening')
                    : t('view')}
                </button>
                <button
                  type="button"
                  className="table-row-action"
                  onClick={() => {
                    void openStatement(statement, "download");
                  }}
                  disabled={Boolean(isOpeningById[statement.id])}
                >
                  {isOpeningById[statement.id] && activeStatementId !== statement.id
                    ? t('preparing')
                    : t('download')}
                </button>
              </div>
            </article>
          ))}
        </section>
      ) : null}

      {activeStatementId ? (
        <section className="settings-card payslip-viewer-card" aria-label={t('viewerTitle')}>
          <header className="payslip-viewer-header">
            <div>
              <h2 className="section-title">
                {viewerPayPeriod
                  ? t('viewerTitleWithPeriod', { period: formatPayPeriod(viewerPayPeriod, locale) })
                  : t('viewerTitle')}
              </h2>
              <p className="settings-card-description">
                {t('viewerDescription')}
              </p>
            </div>
            <button
              type="button"
              className="button button-subtle"
              onClick={() => {
                setActiveStatementId(null);
                setViewerUrl(null);
                setViewerPayPeriod(null);
              }}
            >
              {t('closeViewer')}
            </button>
          </header>

          {isViewerLoading ? <div className="payslip-viewer-skeleton" aria-hidden="true" /> : null}

          {!isViewerLoading && viewerUrl ? (
            <iframe
              className="payslip-viewer-frame"
              src={viewerUrl}
              title={t('viewerTitle')}
            />
          ) : null}

          {!isViewerLoading && !viewerUrl ? (
            <p className="settings-card-description">
              {t('viewerUnavailable')}
            </p>
          ) : null}
        </section>
      ) : null}

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
