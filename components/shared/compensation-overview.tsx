"use client";

import { useMemo, useState } from "react";

import type { CompensationSnapshot } from "../../types/compensation";
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

function approvalLabel(approvedBy: string | null, approvedByName: string | null) {
  if (!approvedBy) {
    return "Pending approval";
  }

  return approvedByName ? `Approved by ${approvedByName}` : "Approved";
}

function taxableTone(isTaxable: boolean) {
  return isTaxable ? "warning" : "success";
}

function taxableLabel(isTaxable: boolean) {
  return isTaxable ? "Taxable" : "Non-taxable";
}

export function CompensationOverview({
  snapshot,
  showEmployeeSummary = false
}: CompensationOverviewProps) {
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
      label: "Salary record",
      description: `${formatPayFrequencyLabel(record.payFrequency)} ${record.currency} compensation`,
      tone: record.approvedBy ? "success" : "pending"
    }));

    const allowanceEvents: TimelineEvent[] = snapshot.allowances.map((record) => ({
      id: `allowance-${record.id}`,
      timestamp: record.effectiveFrom,
      label: "Allowance",
      description: `${record.label} (${formatAllowanceTypeLabel(record.type)})`,
      tone: record.isTaxable ? "warning" : "info"
    }));

    const equityEvents: TimelineEvent[] = snapshot.equityGrants.map((record) => ({
      id: `equity-${record.id}`,
      timestamp: record.grantDate,
      label: "Equity grant",
      description: `${record.numberOfShares.toLocaleString()} shares (${record.grantType})`,
      tone: toneForEquityStatus(record.status)
    }));

    return [...salaryEvents, ...allowanceEvents, ...equityEvents]
      .sort((leftEvent, rightEvent) => {
        const leftTime = Date.parse(`${leftEvent.timestamp}T00:00:00.000Z`);
        const rightTime = Date.parse(`${rightEvent.timestamp}T00:00:00.000Z`);
        return rightTime - leftTime;
      })
      .slice(0, 12);
  }, [snapshot.allowances, snapshot.equityGrants, snapshot.salaryRecords]);

  return (
    <section className="compensation-layout" aria-label="Compensation overview">
      {showEmployeeSummary ? (
        <article className="compensation-summary-card" aria-label="Employee summary">
          <div>
            <h2 className="section-title">{snapshot.employee.fullName}</h2>
            <p className="settings-card-description">
              {snapshot.employee.title ?? "No title"} • {snapshot.employee.department ?? ""}
            </p>
          </div>
          <div className="compensation-summary-meta">
            <p className="country-chip">
              <span>{countryFlagFromCode(snapshot.employee.countryCode)}</span>
              <span>{countryNameFromCode(snapshot.employee.countryCode)}</span>
            </p>
            <StatusBadge tone="info">{formatEmploymentTypeLabel(snapshot.employee.employmentType)}</StatusBadge>
          </div>
        </article>
      ) : null}

      <section className="compensation-section" aria-label="Salary">
        <div className="timeoff-section-header">
          <h2 className="section-title">Salary</h2>
          <p className="settings-card-description">Current compensation and historical salary records.</p>
        </div>

        {currentSalary ? (
          <article className="compensation-salary-card">
            <header className="compensation-salary-header">
              <div>
                <p className="metric-label">Current base salary</p>
                <p className="compensation-salary-value">
                  <CurrencyDisplay
                    amount={currentSalary.baseSalaryAmount}
                    currency={currentSalary.currency}
                  />
                </p>
              </div>
              <StatusBadge tone={approvalTone(currentSalary.approvedBy)}>
                {approvalLabel(currentSalary.approvedBy, currentSalary.approvedByName)}
              </StatusBadge>
            </header>

            <dl className="compensation-salary-meta">
              <div>
                <dt>Frequency</dt>
                <dd>{formatPayFrequencyLabel(currentSalary.payFrequency)}</dd>
              </div>
              <div>
                <dt>Employment</dt>
                <dd>{formatEmploymentTypeLabel(currentSalary.employmentType)}</dd>
              </div>
              <div>
                <dt>Effective</dt>
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
            title="No salary record yet"
            description="Compensation administrators can add the first salary record."
          />
        )}

        {sortedSalaryRecords.length > 0 ? (
          <div className="data-table-container">
            <table className="data-table" aria-label="Salary history table">
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
                      Effective
                      <span className="numeric">
                        {salarySortDirection === "desc" ? "↓" : "↑"}
                      </span>
                    </button>
                  </th>
                  <th>Amount</th>
                  <th>Frequency</th>
                  <th>Status</th>
                  <th className="table-action-column">Actions</th>
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
                        {record.approvedBy ? "Approved" : "Pending"}
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
                          Copy ID
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

      <section className="compensation-section" aria-label="Allowances">
        <div className="timeoff-section-header">
          <h2 className="section-title">Allowances</h2>
          <p className="settings-card-description">Recurring benefits and cash allowances.</p>
        </div>

        {sortedAllowances.length === 0 ? (
          <EmptyState
            title="No allowances configured"
            description="Allowances will appear here once they are added for this employee."
          />
        ) : (
          <>
            <div className="data-table-container">
              <table className="data-table" aria-label="Allowances table">
                <thead>
                  <tr>
                    <th>Label</th>
                    <th>Type</th>
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
                        Amount
                        <span className="numeric">
                          {allowanceSortDirection === "desc" ? "↓" : "↑"}
                        </span>
                      </button>
                    </th>
                    <th>Tax</th>
                    <th>Effective</th>
                    <th className="table-action-column">Actions</th>
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
                          {taxableLabel(allowance.isTaxable)}
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
                            Details
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
                <h3 className="section-title">Allowance details</h3>
                <p className="settings-card-description">
                  {activeAllowance.label} ({formatAllowanceTypeLabel(activeAllowance.type)})
                </p>
                <p className="settings-card-description">
                  Effective {formatRelativeTime(activeAllowance.effectiveFrom)}
                  {activeAllowance.effectiveTo ? ` through ${formatRelativeTime(activeAllowance.effectiveTo)}` : ""}
                </p>
              </article>
            ) : null}
          </>
        )}
      </section>

      <section className="compensation-section" aria-label="Equity grants">
        <div className="timeoff-section-header">
          <h2 className="section-title">Equity</h2>
          <p className="settings-card-description">Grant schedule, vesting, and approval state.</p>
        </div>

        {snapshot.equityGrants.length === 0 ? (
          <EmptyState
            title="No equity grants yet"
            description="Equity grants and vesting progress will appear here when issued."
          />
        ) : (
          <div className="compensation-equity-grid">
            {snapshot.equityGrants.map((grant) => {
              const vesting = calculateVestingProgress(grant);

              return (
                <article key={grant.id} className="compensation-equity-card">
                  <header className="compensation-equity-header">
                    <div>
                      <h3 className="section-title">{grant.grantType} grant</h3>
                      <p className="settings-card-description numeric">
                        {grant.numberOfShares.toLocaleString()} shares
                      </p>
                    </div>
                    <StatusBadge tone={toneForEquityStatus(grant.status)}>{grant.status}</StatusBadge>
                  </header>

                  <div className="compensation-equity-progress">
                    <ProgressRing value={vesting.vestedPercent} label="Vested" />
                    <dl className="compensation-equity-meta">
                      <div>
                        <dt>Grant date</dt>
                        <dd>
                          <time dateTime={grant.grantDate} title={formatDateTimeTooltip(grant.grantDate)}>
                            {formatRelativeTime(grant.grantDate)}
                          </time>
                        </dd>
                      </div>
                      <div>
                        <dt>Exercise price</dt>
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
                        <dt>Approval</dt>
                        <dd>{approvalLabel(grant.approvedBy, grant.approvedByName)}</dd>
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

      <section className="compensation-section" aria-label="Compensation timeline">
        <div className="timeoff-section-header">
          <h2 className="section-title">Timeline</h2>
          <p className="settings-card-description">Recent salary, allowance, and equity events.</p>
        </div>

        {timeline.length === 0 ? (
          <EmptyState
            title="No compensation timeline events"
            description="Timeline events will appear after compensation changes are recorded."
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
