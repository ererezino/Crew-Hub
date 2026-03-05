"use client";

import { Fragment, type ReactNode } from "react";
import Link from "next/link";

import { EmptyState } from "./empty-state";

/* ── Types ── */

export type DataTableColumn<T> = {
  key: string;
  label: string;
  render: (row: T) => ReactNode;
  sortable?: boolean;
  className?: string;
  headerClassName?: string;
};

export type DataTableAction<T> = {
  label: string | ((row: T) => string);
  onClick?: (row: T) => void;
  /** Render as a Next.js Link instead of a button. */
  href?: string | ((row: T) => string);
  hidden?: (row: T) => boolean;
  disabled?: (row: T) => boolean;
  className?: string;
};

export type DataTableEmptyState = {
  title: string;
  description: string;
  ctaLabel?: string;
  ctaHref?: string;
  onCtaClick?: () => void;
};

export type DataTableSort = {
  key: string;
  direction: "asc" | "desc";
};

export type DataTableProps<T> = {
  rows: T[];
  columns: DataTableColumn<T>[];
  rowKey: (row: T) => string;
  ariaLabel: string;

  /** Row-level actions shown in a trailing column. */
  actions?: DataTableAction<T>[];

  /** Sorting state and handler. */
  sort?: DataTableSort;
  onSort?: (key: string) => void;

  /** Optional click handler for the entire row. */
  onRowClick?: (row: T) => void;

  /** Loading skeleton. */
  isLoading?: boolean;
  skeletonRows?: number;

  /** Empty state when rows.length === 0 and not loading. */
  emptyState?: DataTableEmptyState;

  /** Custom class on <table>. */
  className?: string;

  /** Expandable row support. */
  isRowExpanded?: (row: T) => boolean;
  renderExpandedRow?: (row: T) => ReactNode;
  expandedRowClassName?: string;
};

/* ── Skeleton ── */

function TableSkeleton({ rows }: { rows: number }) {
  return (
    <div className="table-skeleton" role="status" aria-label="Loading">
      <div className="table-skeleton-header" />
      {Array.from({ length: rows }, (_, index) => (
        <div key={`skeleton-${index}`} className="table-skeleton-row" />
      ))}
    </div>
  );
}

/* ── Component ── */

export function DataTable<T>({
  rows,
  columns,
  rowKey,
  ariaLabel,
  actions,
  sort,
  onSort,
  onRowClick,
  isLoading = false,
  skeletonRows = 8,
  emptyState,
  className,
  isRowExpanded,
  renderExpandedRow,
  expandedRowClassName
}: DataTableProps<T>) {
  if (isLoading) {
    return <TableSkeleton rows={skeletonRows} />;
  }

  if (rows.length === 0 && emptyState) {
    return (
      <EmptyState
        title={emptyState.title}
        description={emptyState.description}
        ctaLabel={emptyState.ctaLabel}
        ctaHref={emptyState.ctaHref}
        onCtaClick={emptyState.onCtaClick}
      />
    );
  }

  const hasActions = actions && actions.length > 0;
  const totalColumns = columns.length + (hasActions ? 1 : 0);
  const tableClass = className ? `data-table ${className}` : "data-table";

  return (
    <div className="data-table-container">
      <table className={tableClass} aria-label={ariaLabel}>
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col.key} className={col.headerClassName}>
                {col.sortable && onSort ? (
                  <button
                    type="button"
                    className="table-sort-trigger"
                    onClick={() => onSort(col.key)}
                  >
                    {col.label}
                    {sort?.key === col.key ? (
                      <span className="numeric">
                        {sort.direction === "asc" ? " ↑" : " ↓"}
                      </span>
                    ) : null}
                  </button>
                ) : (
                  col.label
                )}
              </th>
            ))}
            {hasActions ? <th className="table-action-column">Actions</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const key = rowKey(row);
            const expanded = isRowExpanded?.(row) ?? false;

            return (
              <Fragment key={key}>
                <tr
                  className={`data-table-row${onRowClick ? " data-table-row-clickable" : ""}`}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  style={onRowClick ? { cursor: "pointer" } : undefined}
                >
                  {columns.map((col) => (
                    <td key={col.key} className={col.className}>
                      {col.render(row)}
                    </td>
                  ))}
                  {hasActions ? (
                    <td className="table-row-action-cell">
                      {actions.map((action, actionIndex) => {
                        if (action.hidden?.(row)) return null;
                        const label =
                          typeof action.label === "function"
                            ? action.label(row)
                            : action.label;

                        if (action.href) {
                          const href =
                            typeof action.href === "function"
                              ? action.href(row)
                              : action.href;
                          return (
                            <Link
                              key={actionIndex}
                              href={href}
                              className={action.className ?? "table-row-action"}
                              onClick={(event) => event.stopPropagation()}
                            >
                              {label}
                            </Link>
                          );
                        }

                        return (
                          <button
                            key={actionIndex}
                            type="button"
                            className={action.className ?? "table-row-action"}
                            disabled={action.disabled?.(row)}
                            onClick={(event) => {
                              event.stopPropagation();
                              action.onClick?.(row);
                            }}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </td>
                  ) : null}
                </tr>
                {expanded && renderExpandedRow ? (
                  <tr className={expandedRowClassName}>
                    <td colSpan={totalColumns}>{renderExpandedRow(row)}</td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
