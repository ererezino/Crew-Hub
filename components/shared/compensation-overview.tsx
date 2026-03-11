"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import type { CompensationSnapshot } from "../../types/compensation";
import type { AppLocale } from "../../i18n/locales";
import { countryFlagFromCode, countryNameFromCode } from "../../lib/countries";
import { formatDateTimeTooltip, formatRelativeTime } from "../../lib/datetime";
import {
  calculateVestingProgress,
  formatAllowanceTypeLabel,
  formatEmploymentTypeLabel,
  formatPayFrequencyLabel,
  toneForEquityStatus
} from "../../lib/compensation";
import { CurrencyDisplay } from "../ui/currency-display";
import { EmptyState } from "./empty-state";
import { ProgressRing } from "./progress-ring";
import { StatusBadge } from "./status-badge";
import { VestingBar } from "./vesting-bar";

type SortDirection = "asc" | "desc";

type CompensationOverviewProps = {
  snapshot: CompensationSnapshot;
  showEmployeeSummary?: boolean;
};

type TimelineEvent = {
  id: string;
  timestamp: string;
  label: string;
  description: string;
  tone: "success" | "warning" | "error" | "info" | "pending" | "draft" | "processing";
};

function approvalTone(approvedBy: string | null) {
  return approvedBy ? "success" : "pending";
}

type CompensationTranslator = ReturnType<typeof useTranslations<"compensation">>;

function approvalLabel(
  approvedBy: string | null,
  approvedByName: string | null,
  t: CompensationTranslator
) {
  if (!approvedBy) {
    return t("pendingApproval");
  }

  return approvedByName ? t("approvedBy", { name: approvedByName } as Record<string, string>) : t("approved");
}

function taxableTone(isTaxable: boolean) {
  return isTaxable ? "warning" : "success";
}

function taxableLabel(isTaxable: boolean, t: CompensationTranslator) {
  return isTaxable ? t("taxable") : t("nonTaxable");
}

export function CompensationOverview({
  snapshot,
  showEmployeeSummary = false
}: CompensationOverviewProps) {
  const locale = useLocale() as AppLocale;
  const t = useTranslations("compensation");
  const [allowanceSortDirection, setAllowanceSortDirection] =
    useState<SortDirection>("desc");
  const [salarySortDirection, setSalarySortDirection] = useState<SortDirection>("desc");
  const [activeAllowanceId, setActiveAllowanceId] = useState<string | null>(null);

  const currentSalary = snapshot.salaryRecords[0] ?? null;

  const sortedSalaryRecords = useMemo(
    () =>
      [...snapshot.salaryRecords].sort((leftRecord, rightRecord) => {
        const leftTime = Date.parse(`${leftRecord.effectiveFrom}T00:00:00.000Z`);
        const rightTime = Date.parse(`${rightRecord.effectiveFrom}T00:00:00.000Z`);

        if (salarySortDirection === "asc") {
          return leftTime - rightTime;
        }

        return rightTime - leftTime;
      }),
    [salarySortDirection, snapshot.salaryRecords]
  );

  const sortedAllowances = useMemo(
    () =>
      [...snapshot.allowances].sort((leftRecord, rightRecord) => {
        if (allowanceSortDirection === "asc") {
          return leftRecord.amount - rightRecord.amount;
        }

        return rightRecord.amount - leftRecord.amount;
      }),
    [allowanceSortDirection, snapshot.allowances]
  );

  const activeAllowance =
    sortedAllowances.find((allowance) => allowance.id === activeAllowanceId) ?? null;

  const timeline = useMemo(() => {
    const salaryEvents: TimelineEvent[] = snapshot.salaryRecords.map((record) => ({
      id: `salary-${record.id}`,
      timestamp: record.effectiveFrom,
      label: t("salaryRecord"),
      description: t("salaryRecordDescription", { frequency: formatPayFrequencyLabel(record.payFrequency), currency: record.currency }),
      tone: record.approvedBy ? "success" : "pending"
    }));

    const allowanceEvents: TimelineEvent[] = snapshot.allowances.map((record) => ({
      id: `allowance-${record.id}`,
      timestamp: record.effectiveFrom,
      label: t("allowance"),
      description: t("allowanceDescription", { label: record.label, type: formatAllowanceTypeLabel(record.type) }),
      tone: record.isTaxable ? "warning" : "info"
    }));

    const equityEvents: TimelineEvent[] = snapshot.equityGrants.map((record) => ({
      id: `equity-${record.id}`,
      timestamp: record.grantDate,
      label: t("equityGrant"),
      description: t("equityGrantDescription", { shares: record.numberOfShares.toLocaleString(), type: record.grantType }),
      tone: toneForEquityStatus(record.status)
    }));

    return [...salaryEvents, ...allowanceEvents, ...equityEvents]
      .sort((leftEvent, rightEvent) => {
        const leftTime = Date.parse(`${leftEvent.timestamp}T00:00:00.000Z`);
        const rightTime = Date.parse(`${rightEvent.timestamp}T00:00:00.000Z`);
        return rightTime - leftTime;
      })
      .slice(0, 12);
  }, [snapshot.allowances, snapshot.equityGrants, snapshot.salaryRecords, t]);

  return (
    <section className="compensation-layout" aria-label={t("compensationOverviewAriaLabel")}>
      {showEmployeeSummary ? (
        <article className="compensation-summary-card" aria-label={t("employeeSummaryAriaLabel")}>
          <div>
            <h2 className="section-title">{snapshot.employee.fullName}</h2>
            <p className="settings-card-description">
              {snapshot.employee.title ?? t("noTitle")} • {snapshot.employee.department ?? ""}
            </p>
          </div>
          <div className="compensation-summary-meta">
            <p className="country-chip">
              <span>{countryFlagFromCode(snapshot.employee.countryCode)}</span>
              <span>{countryNameFromCode(snapshot.employee.countryCode, locale)}</span>
            </p>
            <StatusBadge tone="info">{formatEmploymentTypeLabel(snapshot.employee.employmentType)}</StatusBadge>
          </div>
        </article>
      ) : null}

      <section className="compensation-section" aria-label={t("salaryHeading")}>
        <div className="timeoff-section-header">
          <h2 className="section-title">{t("salaryHeading")}</h2>
          <p className="settings-card-description">{t("salaryDescription")}</p>
        </div>

        {currentSalary ? (
          <article className="compensation-salary-card">
            <header className="compensation-salary-header">
              <div>
                <p className="metric-label">{t("currentBaseSalary")}</p>
                <p className="compensation-salary-value">
                  <CurrencyDisplay
                    amount={currentSalary.baseSalaryAmount}
                    currency={currentSalary.currency}
                  />
                </p>
              </div>
              <StatusBadge tone={approvalTone(currentSalary.approvedBy)}>
                {approvalLabel(currentSalary.approvedBy, currentSalary.approvedByName, t)}
              </StatusBadge>
            </header>

            <dl className="compensation-salary-meta">
              <div>
                <dt>{t("frequency")}</dt>
                <dd>{formatPayFrequencyLabel(currentSalary.payFrequency)}</dd>
              </div>
              <div>
                <dt>{t("employment")}</dt>
                <dd>{formatEmploymentTypeLabel(currentSalary.employmentType)}</dd>
              </div>
              <div>
                <dt>{t("effective")}</dt>
                <dd>
                  <time
                    dateTime={currentSalary.effectiveFrom}
                    title={formatDateTimeTooltip(currentSalary.effectiveFrom)}
                  >
                    {formatRelativeTime(currentSalary.effectiveFrom)}
                  </time>
                </dd>
              </div>
            </dl>
          </article>
        ) : (
          <EmptyState
            title={t("noSalaryRecordTitle")}
            description={t("noSalaryRecordDescription")}
          />
        )}

        {sortedSalaryRecords.length > 0 ? (
          <div className="data-table-container">
            <table className="data-table" aria-label={t("salaryHistoryTableAriaLabel")}>
              <thead>
                <tr>
                  <th>
                    <button
                      type="button"
                      className="table-sort-trigger"
                      onClick={() =>
                        setSalarySortDirection((currentDirection) =>
                          currentDirection === "desc" ? "asc" : "desc"
                        )
                      }
                    >
                      {t("effective")}
                      <span className="numeric">
                        {salarySortDirection === "desc" ? "↓" : "↑"}
                      </span>
                    </button>
                  </th>
                  <th>{t("amount")}</th>
                  <th>{t("frequency")}</th>
                  <th>{t("status")}</th>
                  <th className="table-action-column">{t("actions")}</th>
                </tr>
              </thead>
              <tbody>
                {sortedSalaryRecords.map((record) => (
                  <tr key={record.id} className="data-table-row">
                    <td>
                      <time
                        dateTime={record.effectiveFrom}
                        title={formatDateTimeTooltip(record.effectiveFrom)}
                      >
                        {formatRelativeTime(record.effectiveFrom)}
                      </time>
                    </td>
                    <td>
                      <CurrencyDisplay amount={record.baseSalaryAmount} currency={record.currency} />
                    </td>
                    <td>{formatPayFrequencyLabel(record.payFrequency)}</td>
                    <td>
                      <StatusBadge tone={approvalTone(record.approvedBy)}>
                        {record.approvedBy ? t("approved") : t("pending")}
                      </StatusBadge>
                    </td>
                    <td className="table-row-action-cell">
                      <div className="compensation-row-actions">
                        <button
                          type="button"
                          className="table-row-action"
                          onClick={() => {
                            if (!navigator.clipboard) {
                              return;
                            }

                            void navigator.clipboard.writeText(record.id);
                          }}
                        >
                          {t("copyId")}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      <section className="compensation-section" aria-label={t("allowancesHeading")}>
        <div className="timeoff-section-header">
          <h2 className="section-title">{t("allowancesHeading")}</h2>
          <p className="settings-card-description">{t("allowancesDescription")}</p>
        </div>

        {sortedAllowances.length === 0 ? (
          <EmptyState
            title={t("noAllowancesTitle")}
            description={t("noAllowancesDescription")}
          />
        ) : (
          <>
            <div className="data-table-container">
              <table className="data-table" aria-label={t("allowancesTableAriaLabel")}>
                <thead>
                  <tr>
                    <th>{t("label")}</th>
                    <th>{t("type")}</th>
                    <th>
                      <button
                        type="button"
                        className="table-sort-trigger"
                        onClick={() =>
                          setAllowanceSortDirection((currentDirection) =>
                            currentDirection === "desc" ? "asc" : "desc"
                          )
                        }
                      >
                        {t("amount")}
                        <span className="numeric">
                          {allowanceSortDirection === "desc" ? "↓" : "↑"}
                        </span>
                      </button>
                    </th>
                    <th>{t("tax")}</th>
                    <th>{t("effective")}</th>
                    <th className="table-action-column">{t("actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedAllowances.map((allowance) => (
                    <tr key={allowance.id} className="data-table-row">
                      <td>{allowance.label}</td>
                      <td>{formatAllowanceTypeLabel(allowance.type)}</td>
                      <td>
                        <CurrencyDisplay amount={allowance.amount} currency={allowance.currency} />
                      </td>
                      <td>
                        <StatusBadge tone={taxableTone(allowance.isTaxable)}>
                          {taxableLabel(allowance.isTaxable, t)}
                        </StatusBadge>
                      </td>
                      <td>
                        <time
                          dateTime={allowance.effectiveFrom}
                          title={formatDateTimeTooltip(allowance.effectiveFrom)}
                        >
                          {formatRelativeTime(allowance.effectiveFrom)}
                        </time>
                      </td>
                      <td className="table-row-action-cell">
                        <div className="compensation-row-actions">
                          <button
                            type="button"
                            className="table-row-action"
                            onClick={() => setActiveAllowanceId(allowance.id)}
                          >
                            {t("details")}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {activeAllowance ? (
              <article className="compensation-allowance-details" aria-live="polite">
                <h3 className="section-title">{t("allowanceDetails")}</h3>
                <p className="settings-card-description">
                  {t("allowanceDescription", { label: activeAllowance.label, type: formatAllowanceTypeLabel(activeAllowance.type) })}
                </p>
                <p className="settings-card-description">
                  {t("effectiveFrom", { date: formatRelativeTime(activeAllowance.effectiveFrom) })}
                  {activeAllowance.effectiveTo ? ` ${t("through", { date: formatRelativeTime(activeAllowance.effectiveTo) })}` : ""}
                </p>
              </article>
            ) : null}
          </>
        )}
      </section>

      <section className="compensation-section" aria-label={t("equityGrantsAriaLabel")}>
        <div className="timeoff-section-header">
          <h2 className="section-title">{t("equityHeading")}</h2>
          <p className="settings-card-description">{t("equityDescription")}</p>
        </div>

        {snapshot.equityGrants.length === 0 ? (
          <EmptyState
            title={t("noEquityGrantsTitle")}
            description={t("noEquityGrantsDescription")}
          />
        ) : (
          <div className="compensation-equity-grid">
            {snapshot.equityGrants.map((grant) => {
              const vesting = calculateVestingProgress(grant);

              return (
                <article key={grant.id} className="compensation-equity-card">
                  <header className="compensation-equity-header">
                    <div>
                      <h3 className="section-title">{t("grantTypeLabel", { type: grant.grantType })}</h3>
                      <p className="settings-card-description numeric">
                        {t("sharesCount", { count: grant.numberOfShares.toLocaleString() })}
                      </p>
                    </div>
                    <StatusBadge tone={toneForEquityStatus(grant.status)}>{grant.status}</StatusBadge>
                  </header>

                  <div className="compensation-equity-progress">
                    <ProgressRing value={vesting.vestedPercent} label={t("vested")} />
                    <dl className="compensation-equity-meta">
                      <div>
                        <dt>{t("grantDate")}</dt>
                        <dd>
                          <time dateTime={grant.grantDate} title={formatDateTimeTooltip(grant.grantDate)}>
                            {formatRelativeTime(grant.grantDate)}
                          </time>
                        </dd>
                      </div>
                      <div>
                        <dt>{t("exercisePrice")}</dt>
                        <dd>
                          {grant.exercisePriceCents === null ? (
                            "--"
                          ) : (
                            <CurrencyDisplay
                              amount={grant.exercisePriceCents}
                              currency={snapshot.employee.primaryCurrency}
                            />
                          )}
                        </dd>
                      </div>
                      <div>
                        <dt>{t("approval")}</dt>
                        <dd>{approvalLabel(grant.approvedBy, grant.approvedByName, t)}</dd>
                      </div>
                    </dl>
                  </div>

                  <VestingBar
                    vestedPercent={vesting.vestedPercent}
                    cliffPercent={vesting.cliffPercent}
                    todayOffsetPercent={vesting.todayOffsetPercent}
                  />
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="compensation-section" aria-label={t("timelineAriaLabel")}>
        <div className="timeoff-section-header">
          <h2 className="section-title">{t("timelineHeading")}</h2>
          <p className="settings-card-description">{t("timelineDescription")}</p>
        </div>

        {timeline.length === 0 ? (
          <EmptyState
            title={t("noTimelineEventsTitle")}
            description={t("noTimelineEventsDescription")}
          />
        ) : (
          <ol className="compensation-timeline">
            {timeline.map((event) => (
              <li key={event.id} className="compensation-timeline-item">
                <div className="compensation-timeline-main">
                  <p className="compensation-timeline-label">{event.label}</p>
                  <p className="settings-card-description">{event.description}</p>
                  <time
                    className="compensation-timeline-time"
                    dateTime={event.timestamp}
                    title={formatDateTimeTooltip(event.timestamp)}
                  >
                    {formatRelativeTime(event.timestamp)}
                  </time>
                </div>
                <StatusBadge tone={event.tone}>{event.label}</StatusBadge>
              </li>
            ))}
          </ol>
        )}
      </section>
    </section>
  );
}
