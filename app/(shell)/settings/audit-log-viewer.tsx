"use client";

import { Fragment, type FormEvent, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { EmptyState } from "../../../components/shared/empty-state";
import { StatusBadge } from "../../../components/shared/status-badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../components/ui/select";
import { AUDIT_LOG_ACTIONS, type AuditLogsResponse } from "../../../types/settings";

type AppLocale = "en" | "fr";

type AuditFilters = {
  dateFrom: string;
  dateTo: string;
  actorId: string;
  action: string;
  tableName: string;
  sort: "asc" | "desc";
};

const initialFilters: AuditFilters = {
  dateFrom: "",
  dateTo: "",
  actorId: "__all__",
  action: "__all__",
  tableName: "__all__",
  sort: "desc"
};

const pageSize = 50;

type DiffLine = {
  key: string;
  kind: "added" | "removed" | "changed";
  previousValue?: string;
  nextValue?: string;
};

export function mergeFilterOptions(
  options: readonly string[],
  ...selectedValues: Array<string | null | undefined>
): string[] {
  const merged = new Set(options.filter((option) => option.length > 0));

  for (const value of selectedValues) {
    if (!value || value === "__all__") {
      continue;
    }

    merged.add(value);
  }

  return [...merged].sort((left, right) => left.localeCompare(right));
}

function badgeToneForAction(action: string) {
  switch (action) {
    case "created":
    case "approved":
    case "login":
      return "success" as const;
    case "updated":
    case "submitted":
      return "processing" as const;
    case "rejected":
    case "deleted":
      return "error" as const;
    case "cancelled":
    case "logout":
      return "warning" as const;
    default:
      return "info" as const;
  }
}

function toDisplayValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "null";
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  try {
    return JSON.stringify(value);
  } catch {
    return "[unserializable]";
  }
}

function safeRecord(value: Record<string, unknown> | null): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value;
}

function diffValues(
  oldValue: Record<string, unknown> | null,
  newValue: Record<string, unknown> | null
): DiffLine[] {
  const previous = safeRecord(oldValue);
  const next = safeRecord(newValue);

  const keys = [...new Set([...Object.keys(previous), ...Object.keys(next)])].sort();

  return keys.reduce<DiffLine[]>((lines, key) => {
    const hasPrevious = Object.prototype.hasOwnProperty.call(previous, key);
    const hasNext = Object.prototype.hasOwnProperty.call(next, key);

    if (!hasPrevious && hasNext) {
      lines.push({
        key,
        kind: "added",
        nextValue: toDisplayValue(next[key])
      });
      return lines;
    }

    if (hasPrevious && !hasNext) {
      lines.push({
        key,
        kind: "removed",
        previousValue: toDisplayValue(previous[key])
      });
      return lines;
    }

    const previousValue = toDisplayValue(previous[key]);
    const nextValue = toDisplayValue(next[key]);

    if (previousValue !== nextValue) {
      lines.push({
        key,
        kind: "changed",
        previousValue,
        nextValue
      });
    }

    return lines;
  }, []);
}

function formatRelativeTime(timestamp: string, localeTag: string, justNowText: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const seconds = Math.round((now.getTime() - date.getTime()) / 1000);

  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["year", 31_536_000],
    ["month", 2_592_000],
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60]
  ];

  for (const [unit, amount] of units) {
    if (Math.abs(seconds) >= amount) {
      const value = Math.round(seconds / amount) * -1;
      return new Intl.RelativeTimeFormat(localeTag, { numeric: "auto" }).format(value, unit);
    }
  }

  return justNowText;
}

export function AuditLogViewer() {
  const t = useTranslations('settings');
  const tCommon = useTranslations('common');
  const locale = useLocale() as AppLocale;
  const localeTag = locale === "fr" ? "fr-FR" : "en-US";

  const [draftFilters, setDraftFilters] = useState<AuditFilters>(initialFilters);
  const [appliedFilters, setAppliedFilters] = useState<AuditFilters>(initialFilters);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [responseData, setResponseData] = useState<AuditLogsResponse["data"]>(null);
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const abortController = new AbortController();

    const fetchAuditLogs = async () => {
      setIsLoading(true);
      setErrorMessage(null);

      try {
        const params = new URLSearchParams();
        params.set("page", String(page));
        params.set("pageSize", String(pageSize));
        params.set("sort", appliedFilters.sort);

        if (appliedFilters.dateFrom) {
          params.set("dateFrom", appliedFilters.dateFrom);
        }

        if (appliedFilters.dateTo) {
          params.set("dateTo", appliedFilters.dateTo);
        }

        if (appliedFilters.actorId && appliedFilters.actorId !== "__all__") {
          params.set("actorId", appliedFilters.actorId);
        }

        if (appliedFilters.action && appliedFilters.action !== "__all__") {
          params.set("action", appliedFilters.action);
        }

        if (appliedFilters.tableName && appliedFilters.tableName !== "__all__") {
          params.set("table", appliedFilters.tableName);
        }

        const response = await fetch(`/api/v1/audit/logs?${params.toString()}`, {
          method: "GET",
          signal: abortController.signal
        });

        const payload = (await response.json()) as AuditLogsResponse;

        if (!response.ok || !payload.data) {
          setErrorMessage(payload.error?.message ?? t('audit.unableToLoad'));
          setResponseData(null);
          return;
        }

        setResponseData(payload.data);
      } catch (error) {
        if (abortController.signal.aborted) {
          return;
        }

        setErrorMessage(
          error instanceof Error ? error.message : t('audit.unableToLoad')
        );
        setResponseData(null);
      } finally {
        if (!abortController.signal.aborted) {
          setIsLoading(false);
        }
      }
    };

    void fetchAuditLogs();

    return () => {
      abortController.abort();
    };
  }, [appliedFilters, page, t]);

  const totalPages = useMemo(() => {
    if (!responseData) {
      return 1;
    }

    return Math.max(1, Math.ceil(responseData.total / responseData.pageSize));
  }, [responseData]);

  const actionOptions = responseData?.actionOptions ?? [...AUDIT_LOG_ACTIONS];
  const actorOptions = responseData?.actors ?? [];
  const tableOptions = useMemo(
    () =>
      mergeFilterOptions(
        responseData?.tableOptions ?? [],
        draftFilters.tableName,
        appliedFilters.tableName
      ),
    [responseData?.tableOptions, draftFilters.tableName, appliedFilters.tableName]
  );

  const handleFilterSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAppliedFilters(draftFilters);
    setPage(1);
    setExpandedRows({});
  };

  const handleFilterReset = () => {
    setDraftFilters(initialFilters);
    setAppliedFilters(initialFilters);
    setPage(1);
    setExpandedRows({});
  };

  const toggleRow = (entryId: string) => {
    setExpandedRows((previous) => ({
      ...previous,
      [entryId]: !previous[entryId]
    }));
  };

  return (
    <section className="settings-card" aria-label={t('audit.ariaLabel')}>
      <h2 className="section-title">{t('audit.heading')}</h2>
      <p className="settings-card-description">
        {t('audit.viewerDescription')}
      </p>

      <form className="audit-filters" onSubmit={handleFilterSubmit}>
        <label className="form-field">
          <span className="form-label">{t('audit.dateFrom')}</span>
          <input
            className="form-input"
            type="date"
            value={draftFilters.dateFrom}
            onChange={(event) =>
              setDraftFilters((previous) => ({
                ...previous,
                dateFrom: event.currentTarget.value
              }))
            }
          />
        </label>

        <label className="form-field">
          <span className="form-label">{t('audit.dateTo')}</span>
          <input
            className="form-input"
            type="date"
            value={draftFilters.dateTo}
            onChange={(event) =>
              setDraftFilters((previous) => ({
                ...previous,
                dateTo: event.currentTarget.value
              }))
            }
          />
        </label>

        <div className="form-field">
          <span className="form-label">{t('audit.actor')}</span>
          <Select
            value={draftFilters.actorId}
            onValueChange={(value) =>
              setDraftFilters((previous) => ({
                ...previous,
                actorId: value
              }))
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">{t('audit.allActors')}</SelectItem>
              {actorOptions.map((actor) => (
                <SelectItem key={actor.id} value={actor.id}>
                  {actor.fullName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="form-field">
          <span className="form-label">{t('audit.action')}</span>
          <Select
            value={draftFilters.action}
            onValueChange={(value) =>
              setDraftFilters((previous) => ({
                ...previous,
                action: value
              }))
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">{t('audit.allActions')}</SelectItem>
              {actionOptions.map((action) => (
                <SelectItem key={action} value={action}>
                  {action}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="form-field">
          <span className="form-label">{t('audit.table')}</span>
          <Select
            value={draftFilters.tableName}
            onValueChange={(value) =>
              setDraftFilters((previous) => ({
                ...previous,
                tableName: value
              }))
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">{t('audit.allTables')}</SelectItem>
              {tableOptions.map((tableName) => (
                <SelectItem key={tableName} value={tableName}>
                  {tableName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="form-field">
          <span className="form-label">{t('audit.sort')}</span>
          <Select
            value={draftFilters.sort}
            onValueChange={(value) =>
              setDraftFilters((previous) => ({
                ...previous,
                sort: value as "asc" | "desc"
              }))
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="desc">{t('audit.newestFirst')}</SelectItem>
              <SelectItem value="asc">{t('audit.oldestFirst')}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="audit-filter-actions">
          <button type="submit" className="button button-accent">
            {t('audit.applyFilters')}
          </button>
          <button type="button" className="button" onClick={handleFilterReset}>
            {t('audit.reset')}
          </button>
        </div>
      </form>

      {isLoading ? (
        <div className="table-skeleton" aria-hidden="true">
          {Array.from({ length: 8 }, (_, index) => (
            <div key={`skeleton-${index}`} className="table-skeleton-row" />
          ))}
        </div>
      ) : null}

      {!isLoading && errorMessage ? (
        <EmptyState
          title={t('audit.unavailable')}
          description={errorMessage}
          ctaLabel={tCommon('retry')}
          ctaHref="/settings"
        />
      ) : null}

      {!isLoading && !errorMessage && responseData && responseData.entries.length === 0 ? (
        <EmptyState
          title={t('audit.noMatchTitle')}
          description={t('audit.noMatchDescription')}
          ctaLabel={t('audit.resetFilters')}
          ctaHref="/settings"
        />
      ) : null}

      {!isLoading && !errorMessage && responseData && responseData.entries.length > 0 ? (
        <>
          <div className="data-table-container">
            <table className="data-table" aria-label={t('audit.tableAriaLabel')}>
              <thead>
                <tr>
                  <th>{t('audit.colTimestamp')}</th>
                  <th>{t('audit.colActor')}</th>
                  <th>{t('audit.colAction')}</th>
                  <th>{t('audit.colTable')}</th>
                  <th>{t('audit.colRecord')}</th>
                  <th className="table-action-column">{t('audit.colDiff')}</th>
                </tr>
              </thead>
              <tbody>
                {responseData.entries.map((entry) => {
                  const isExpanded = Boolean(expandedRows[entry.id]);

                  let diffLines: DiffLine[] = [];

                  if (isExpanded) {
                    try {
                      diffLines = diffValues(entry.oldValue, entry.newValue);
                    } catch {
                      diffLines = [];
                    }
                  }

                  return (
                    <Fragment key={entry.id}>
                      <tr className="data-table-row">
                        <td>
                          <time
                            title={new Date(entry.timestamp).toLocaleString(localeTag)}
                            dateTime={entry.timestamp}
                          >
                            {formatRelativeTime(entry.timestamp, localeTag, t('audit.justNow'))}
                          </time>
                        </td>
                        <td>{entry.actorName}</td>
                        <td>
                          <StatusBadge tone={badgeToneForAction(entry.action)}>
                            {entry.action}
                          </StatusBadge>
                        </td>
                        <td>{entry.tableName}</td>
                        <td className="numeric">{entry.recordId ?? "--"}</td>
                        <td className="table-row-action-cell">
                          <button
                            type="button"
                            className="table-row-action"
                            onClick={() => toggleRow(entry.id)}
                          >
                            {isExpanded ? t('audit.hideDiff') : t('audit.showDiff')}
                          </button>
                        </td>
                      </tr>

                      {isExpanded ? (
                        <tr className="audit-diff-row">
                          <td colSpan={6}>
                            {diffLines.length > 0 ? (
                              <ul className="audit-diff-list">
                                {diffLines.map((line) => {
                                  if (line.kind === "added") {
                                    return (
                                      <li key={`${entry.id}-${line.key}-added`} className="audit-diff-added">
                                        + {line.key}: {line.nextValue}
                                      </li>
                                    );
                                  }

                                  if (line.kind === "removed") {
                                    return (
                                      <li key={`${entry.id}-${line.key}-removed`} className="audit-diff-removed">
                                        - {line.key}: {line.previousValue}
                                      </li>
                                    );
                                  }

                                  return (
                                    <li key={`${entry.id}-${line.key}-changed`} className="audit-diff-changed">
                                      <span className="audit-diff-removed">
                                        - {line.key}: {line.previousValue}
                                      </span>
                                      <span className="audit-diff-added">
                                        + {line.key}: {line.nextValue}
                                      </span>
                                    </li>
                                  );
                                })}
                              </ul>
                            ) : (
                              <p className="audit-diff-empty">{t('audit.noDiffChanges')}</p>
                            )}
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          <footer className="audit-pagination">
            <p className="audit-pagination-summary numeric">
              {t('audit.paginationSummary', {
                total: responseData.total,
                page: responseData.page,
                totalPages
              })}
            </p>
            <div className="audit-pagination-actions">
              <button
                type="button"
                className="button"
                onClick={() => setPage((previous) => Math.max(1, previous - 1))}
                disabled={responseData.page <= 1}
              >
                {t('audit.previous')}
              </button>
              <button
                type="button"
                className="button"
                onClick={() =>
                  setPage((previous) =>
                    responseData.page >= totalPages ? previous : previous + 1
                  )
                }
                disabled={responseData.page >= totalPages}
              >
                {tCommon('next')}
              </button>
            </div>
          </footer>
        </>
      ) : null}
    </section>
  );
}
