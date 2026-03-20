"use client";

import { useCallback, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { CurrencyDisplay } from "../ui/currency-display";
import { StatusBadge } from "../shared/status-badge";
import type {
  PayrollCycle,
  PayrollRunItem,
  PayrollRunSummary,
  WorksheetRowEditPayload
} from "../../types/payroll-runs";

type AppLocale = "en" | "fr";

type WorksheetProps = {
  run: PayrollRunSummary;
  items: PayrollRunItem[];
  cycles: PayrollCycle[];
  canEdit: boolean;
  canApprove: boolean;
  viewerUserId: string;
  onItemUpdated: () => void;
  onToast: (variant: "success" | "error" | "info", message: string) => void;
};

type EditingCell = {
  itemId: string;
  field: keyof WorksheetRowEditPayload;
};

type CycleTone = "success" | "warning" | "error" | "info" | "pending" | "draft" | "processing";

function cycleTone(status: string): CycleTone {
  switch (status) {
    case "paid": return "success";
    case "approved": case "ready": return "info";
    case "submitted": return "pending";
    case "processing": return "processing";
    case "rejected": return "error";
    case "failed": return "error";
    case "draft": return "draft";
    default: return "draft";
  }
}

type ViewMode = "worksheet" | "cycle1" | "cycle2";

export function PayrollWorksheet({ run, items, cycles, canEdit, canApprove, viewerUserId, onItemUpdated, onToast }: WorksheetProps) {
  const t = useTranslations("payrollWorksheet");
  const locale = useLocale() as AppLocale;
  const [viewMode, setViewMode] = useState<ViewMode>("worksheet");
  const [editingCell, setEditingCell] = useState<EditingCell | null>(null);
  const [editValue, setEditValue] = useState("");
  const [savingItemId, setSavingItemId] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [cycleActionLoading, setCycleActionLoading] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState<string | null>(null);
  const [rejectCycleId, setRejectCycleId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const currency = run.totalGross ? Object.keys(run.totalGross)[0] ?? "NGN" : "NGN";

  const cycle1 = cycles.find((c) => c.cycleNumber === 1);
  const cycle2 = cycles.find((c) => c.cycleNumber === 2);

  const isEditable = canEdit && ["draft", "calculated", "rejected"].includes(run.status);

  const sortedItems = useMemo(() => {
    const rows = [...items];
    return rows.sort((a, b) => {
      const cmp = a.fullName.localeCompare(b.fullName);
      return sortDirection === "asc" ? cmp : -cmp;
    });
  }, [items, sortDirection]);

  const filteredItems = useMemo(() => {
    if (viewMode === "cycle1") return sortedItems.filter((i) => i.cycle1Included);
    if (viewMode === "cycle2") return sortedItems.filter((i) => i.cycle2Included);
    return sortedItems;
  }, [sortedItems, viewMode]);

  /* ── Totals ─────────────────────────────────────────────── */

  const totals = useMemo(() => {
    const rows = filteredItems;
    return {
      monthlySalary: rows.reduce((s, r) => s + r.baseSalaryAmount, 0),
      c1Base: rows.reduce((s, r) => s + r.cycle1BaseAmount, 0),
      c2Base: rows.reduce((s, r) => s + r.cycle2BaseAmount, 0),
      c1OtHours: rows.reduce((s, r) => s + r.cycle1OvertimeHours, 0),
      c1OtAmount: rows.reduce((s, r) => s + r.cycle1OvertimeAmount, 0),
      c2OtHours: rows.reduce((s, r) => s + r.cycle2OvertimeHours, 0),
      c2OtAmount: rows.reduce((s, r) => s + r.cycle2OvertimeAmount, 0),
      bonus: rows.reduce((s, r) => s + r.bonus, 0),
      fees: rows.reduce((s, r) => s + r.fees, 0),
      monthlyTotal: rows.reduce((s, r) => s + r.monthlyTotal, 0),
      count: rows.length
    };
  }, [filteredItems]);

  /* ── Inline editing ─────────────────────────────────────── */

  const startEdit = useCallback((itemId: string, field: keyof WorksheetRowEditPayload, currentValue: string | number | boolean | null) => {
    if (!isEditable) return;
    setEditingCell({ itemId, field });
    setEditValue(currentValue === null ? "" : String(currentValue));
  }, [isEditable]);

  const cancelEdit = useCallback(() => {
    setEditingCell(null);
    setEditValue("");
  }, []);

  const saveEdit = useCallback(async () => {
    if (!editingCell) return;

    const { itemId, field } = editingCell;

    const payload: WorksheetRowEditPayload = {};

    /* Parse value based on field type */
    const numericFields: Array<keyof WorksheetRowEditPayload> = [
      "cycle1BaseAmount", "cycle2BaseAmount",
      "cycle1OvertimeHours", "cycle2OvertimeHours",
      "fees", "bonus"
    ];

    if (numericFields.includes(field)) {
      const num = field === "cycle1OvertimeHours" || field === "cycle2OvertimeHours"
        ? Number.parseFloat(editValue) || 0
        : Number.parseInt(editValue, 10) || 0;
      (payload as Record<string, unknown>)[field] = Math.max(0, num);
    } else if (field === "comment" || field === "exceptionReason") {
      (payload as Record<string, unknown>)[field] = editValue.trim() || null;
    }

    setSavingItemId(itemId);
    setEditingCell(null);

    try {
      const res = await fetch(`/api/v1/payroll/runs/${run.id}/items/${itemId}/worksheet`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        onItemUpdated();
      }
    } finally {
      setSavingItemId(null);
      setEditValue("");
    }
  }, [editingCell, editValue, run.id, onItemUpdated]);

  const toggleCycleInclusion = useCallback(async (itemId: string, cycle: 1 | 2, currentValue: boolean) => {
    if (!isEditable) return;
    setSavingItemId(itemId);
    const payload: WorksheetRowEditPayload = cycle === 1
      ? { cycle1Included: !currentValue }
      : { cycle2Included: !currentValue };

    try {
      const res = await fetch(`/api/v1/payroll/runs/${run.id}/items/${itemId}/worksheet`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (res.ok) onItemUpdated();
    } finally {
      setSavingItemId(null);
    }
  }, [isEditable, run.id, onItemUpdated]);

  /* ── Cycle-level actions (Amendment 1 — primary workflow) ── */

  const performCycleAction = useCallback(async (
    cycleId: string,
    action: "submit" | "approve" | "reject" | "mark_ready" | "mark_processing" | "mark_paid",
    reason?: string
  ) => {
    setCycleActionLoading(`${cycleId}-${action}`);
    try {
      const res = await fetch(`/api/v1/payroll/runs/${run.id}/cycles/${cycleId}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, reason: reason ?? null })
      });
      const json = await res.json();
      if (!res.ok) {
        onToast("error", json.error?.message ?? t("cycleActions.actionFailed"));
        return false;
      }
      onToast("success", t(`cycleActions.${action}Success`));
      onItemUpdated();
      return true;
    } catch {
      onToast("error", t("cycleActions.actionFailed"));
      return false;
    } finally {
      setCycleActionLoading(null);
    }
  }, [run.id, onItemUpdated, onToast, t]);

  const exportCycleCsv = useCallback(async (cycleId: string) => {
    setIsExporting(cycleId);
    try {
      const res = await fetch(`/api/v1/payroll/runs/${run.id}/cycles/${cycleId}/export`);
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        onToast("error", (json as { error?: { message?: string } } | null)?.error?.message ?? t("cycleActions.exportFailed"));
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `cycle-${cycleId.slice(0, 8)}-export.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      onToast("success", t("cycleActions.exportSuccess"));
    } catch {
      onToast("error", t("cycleActions.exportFailed"));
    } finally {
      setIsExporting(null);
    }
  }, [run.id, onToast, t]);

  /* Determine what actions are available for a given cycle */
  function cycleActions(cycle: PayrollCycle | undefined) {
    if (!cycle) return { canSubmit: false, canApproveCycle: false, canReject: false, canExport: false, canMarkPaid: false };
    const submittedBy = cycle.submittedBy ?? cycle.preparedBy ?? null;
    return {
      canSubmit: canEdit && cycle.status === "draft",
      canApproveCycle: canApprove && cycle.status === "submitted" && submittedBy !== viewerUserId,
      canReject: canApprove && cycle.status === "submitted" && submittedBy !== viewerUserId,
      canExport: ["submitted", "approved", "ready", "processing", "paid"].includes(cycle.status),
      canMarkPaid: canEdit && ["approved", "ready", "processing"].includes(cycle.status)
    };
  }

  /* ── Editable cell ──────────────────────────────────────── */

  function EditableCell({
    itemId,
    field,
    value,
    isAmount,
    className
  }: {
    itemId: string;
    field: keyof WorksheetRowEditPayload;
    value: string | number | null;
    isAmount?: boolean;
    className?: string;
  }) {
    const isEditing = editingCell?.itemId === itemId && editingCell?.field === field;
    const isSaving = savingItemId === itemId;

    if (isEditing) {
      return (
        <input
          type={isAmount ? "number" : "text"}
          className="worksheet-cell-input"
          value={editValue}
          autoFocus
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={() => void saveEdit()}
          onKeyDown={(e) => {
            if (e.key === "Enter") void saveEdit();
            if (e.key === "Escape") cancelEdit();
          }}
        />
      );
    }

    const displayValue = isAmount && typeof value === "number"
      ? <CurrencyDisplay amount={value} currency={currency} locale={locale} />
      : (value ?? <span className="text-muted">\u2014</span>);

    return (
      <span
        className={`${isEditable ? "worksheet-cell-editable" : ""} ${className ?? ""} ${isSaving ? "worksheet-cell-saving" : ""}`}
        onClick={() => isEditable && startEdit(itemId, field, value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && isEditable) startEdit(itemId, field, value);
        }}
        role={isEditable ? "button" : undefined}
        tabIndex={isEditable ? 0 : undefined}
      >
        {displayValue}
      </span>
    );
  }

  /* ── Render ─────────────────────────────────────────────── */

  return (
    <section className="payroll-worksheet" aria-label={t("title")}>
      {/* View mode tabs */}
      <div className="payroll-worksheet-tabs">
        <button
          type="button"
          className={`payroll-worksheet-tab ${viewMode === "worksheet" ? "active" : ""}`}
          onClick={() => setViewMode("worksheet")}
        >
          {t("tabs.worksheet")}
        </button>
        <button
          type="button"
          className={`payroll-worksheet-tab ${viewMode === "cycle1" ? "active" : ""}`}
          onClick={() => setViewMode("cycle1")}
        >
          {t("tabs.cycle1")}
          {cycle1 ? (
            <StatusBadge tone={cycleTone(cycle1.status)}>{cycle1.status}</StatusBadge>
          ) : null}
        </button>
        <button
          type="button"
          className={`payroll-worksheet-tab ${viewMode === "cycle2" ? "active" : ""}`}
          onClick={() => setViewMode("cycle2")}
        >
          {t("tabs.cycle2")}
          {cycle2 ? (
            <StatusBadge tone={cycleTone(cycle2.status)}>{cycle2.status}</StatusBadge>
          ) : null}
        </button>
      </div>

      {/* Cycle info bar for cycle views */}
      {viewMode !== "worksheet" ? (
        <div className="payroll-worksheet-cycle-info">
          {viewMode === "cycle1" && cycle1 ? (
            <p>{t("cycleInfo", { label: cycle1.label, date: cycle1.targetPayDate ?? "" })}</p>
          ) : viewMode === "cycle2" && cycle2 ? (
            <p>{t("cycleInfo", { label: cycle2.label, date: cycle2.targetPayDate ?? "" })}</p>
          ) : (
            <p className="text-muted">{t("cycleNotCreated")}</p>
          )}
        </div>
      ) : null}

      {/* Cycle action bar — THE primary approval workflow */}
      {viewMode !== "worksheet" ? (() => {
        const activeCycle = viewMode === "cycle1" ? cycle1 : cycle2;
        const actions = cycleActions(activeCycle);
        const cycleId = activeCycle?.id;
        if (!cycleId) return null;
        const isLoading = cycleActionLoading !== null;
        const isRejectingThis = rejectCycleId === cycleId;

        return (
          <div className="payroll-worksheet-cycle-actions">
            {actions.canSubmit ? (
              <button
                type="button"
                className="button button-accent"
                disabled={isLoading}
                onClick={() => void performCycleAction(cycleId, "submit")}
              >
                {cycleActionLoading === `${cycleId}-submit` ? t("cycleActions.submitting") : t("cycleActions.submitCycle")}
              </button>
            ) : null}
            {actions.canApproveCycle ? (
              <button
                type="button"
                className="button button-approve"
                disabled={isLoading}
                onClick={() => void performCycleAction(cycleId, "approve")}
              >
                {cycleActionLoading === `${cycleId}-approve` ? t("cycleActions.approving") : t("cycleActions.approveCycle")}
              </button>
            ) : null}
            {actions.canReject && !isRejectingThis ? (
              <button
                type="button"
                className="button button-subtle"
                disabled={isLoading}
                onClick={() => { setRejectCycleId(cycleId); setRejectReason(""); }}
              >
                {t("cycleActions.rejectCycle")}
              </button>
            ) : null}
            {actions.canMarkPaid ? (
              <button
                type="button"
                className="button button-consequential"
                disabled={isLoading}
                onClick={() => void performCycleAction(cycleId, "mark_paid")}
              >
                {cycleActionLoading === `${cycleId}-mark_paid` ? t("cycleActions.markingPaid") : t("cycleActions.markPaid")}
              </button>
            ) : null}
            {actions.canExport ? (
              <button
                type="button"
                className="button"
                disabled={isExporting !== null}
                onClick={() => void exportCycleCsv(cycleId)}
              >
                {isExporting === cycleId ? t("cycleActions.exporting") : t("cycleActions.exportCsv")}
              </button>
            ) : null}

            {/* Inline reject reason form */}
            {isRejectingThis ? (
              <div className="payroll-worksheet-reject-inline">
                <textarea
                  className="input"
                  rows={2}
                  placeholder={t("cycleActions.rejectReasonPlaceholder")}
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                />
                <div className="button-row">
                  <button
                    type="button"
                    className="button button-danger"
                    disabled={!rejectReason.trim() || isLoading}
                    onClick={async () => {
                      const ok = await performCycleAction(cycleId, "reject", rejectReason.trim());
                      if (ok) { setRejectCycleId(null); setRejectReason(""); }
                    }}
                  >
                    {t("cycleActions.confirmReject")}
                  </button>
                  <button
                    type="button"
                    className="button button-subtle"
                    onClick={() => { setRejectCycleId(null); setRejectReason(""); }}
                  >
                    {t("cycleActions.cancelReject")}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        );
      })() : null}

      {/* Worksheet table */}
      <div className="data-table-container payroll-worksheet-table-container">
        <table className="data-table payroll-worksheet-table">
          <thead>
            <tr>
              <th className="payroll-worksheet-sticky-col">
                <button
                  type="button"
                  className="table-sort-trigger"
                  onClick={() => setSortDirection((d) => d === "asc" ? "desc" : "asc")}
                >
                  {t("col.employee")}
                  <span className="numeric">{sortDirection === "asc" ? "\u2191" : "\u2193"}</span>
                </button>
              </th>
              <th>{t("col.designation")}</th>
              <th>{t("col.department")}</th>
              {viewMode === "worksheet" ? <th>{t("col.monthlySalary")}</th> : null}
              {viewMode !== "cycle2" ? (
                <>
                  {viewMode === "worksheet" ? <th className="text-center">{t("col.c1Included")}</th> : null}
                  <th className="text-right">{t("col.c1Amount")}</th>
                  <th className="text-right">{t("col.c1OtHours")}</th>
                  <th className="text-right">{t("col.c1Overtime")}</th>
                </>
              ) : null}
              {viewMode !== "cycle1" ? (
                <>
                  {viewMode === "worksheet" ? <th className="text-center">{t("col.c2Included")}</th> : null}
                  <th className="text-right">{t("col.c2Amount")}</th>
                  <th className="text-right">{t("col.c2OtHours")}</th>
                  <th className="text-right">{t("col.c2Overtime")}</th>
                </>
              ) : null}
              <th className="text-right">{t("col.bonus")}</th>
              <th className="text-right">{t("col.fees")}</th>
              <th className="text-right">{t("col.monthlyTotal")}</th>
              <th>{t("col.comment")}</th>
              <th>{t("col.exception")}</th>
            </tr>
          </thead>
          <tbody>
            {filteredItems.map((item) => (
              <tr key={item.id} className="data-table-row">
                <td className="payroll-worksheet-sticky-col">
                  <span className="payroll-worksheet-employee-name">{item.fullName}</span>
                  {item.accrueUsername ? (
                    <span className="payroll-worksheet-username">{item.accrueUsername}</span>
                  ) : null}
                </td>
                <td>{item.designation ?? "\u2014"}</td>
                <td>{item.department ?? "\u2014"}</td>
                {viewMode === "worksheet" ? (
                  <td className="text-right">
                    <CurrencyDisplay amount={item.baseSalaryAmount} currency={currency} locale={locale} />
                  </td>
                ) : null}
                {viewMode !== "cycle2" ? (
                  <>
                    {viewMode === "worksheet" ? (
                      <td className="text-center">
                        <input
                          type="checkbox"
                          checked={item.cycle1Included}
                          disabled={!isEditable || savingItemId === item.id}
                          onChange={() => void toggleCycleInclusion(item.id, 1, item.cycle1Included)}
                        />
                      </td>
                    ) : null}
                    <td className="text-right">
                      <EditableCell itemId={item.id} field="cycle1BaseAmount" value={item.cycle1BaseAmount} isAmount />
                    </td>
                    <td className="text-right">
                      <EditableCell itemId={item.id} field="cycle1OvertimeHours" value={item.cycle1OvertimeHours} className="numeric" />
                    </td>
                    <td className="text-right">
                      <CurrencyDisplay amount={item.cycle1OvertimeAmount} currency={currency} locale={locale} />
                    </td>
                  </>
                ) : null}
                {viewMode !== "cycle1" ? (
                  <>
                    {viewMode === "worksheet" ? (
                      <td className="text-center">
                        <input
                          type="checkbox"
                          checked={item.cycle2Included}
                          disabled={!isEditable || savingItemId === item.id}
                          onChange={() => void toggleCycleInclusion(item.id, 2, item.cycle2Included)}
                        />
                      </td>
                    ) : null}
                    <td className="text-right">
                      <EditableCell itemId={item.id} field="cycle2BaseAmount" value={item.cycle2BaseAmount} isAmount />
                    </td>
                    <td className="text-right">
                      <EditableCell itemId={item.id} field="cycle2OvertimeHours" value={item.cycle2OvertimeHours} className="numeric" />
                    </td>
                    <td className="text-right">
                      <CurrencyDisplay amount={item.cycle2OvertimeAmount} currency={currency} locale={locale} />
                    </td>
                  </>
                ) : null}
                <td className="text-right">
                  <EditableCell itemId={item.id} field="bonus" value={item.bonus} isAmount />
                </td>
                <td className="text-right">
                  <EditableCell itemId={item.id} field="fees" value={item.fees} isAmount />
                </td>
                <td className="text-right payroll-worksheet-total-cell">
                  <CurrencyDisplay amount={item.monthlyTotal} currency={currency} locale={locale} />
                </td>
                <td className="payroll-worksheet-text-cell">
                  <EditableCell itemId={item.id} field="comment" value={item.comment} />
                </td>
                <td className="payroll-worksheet-text-cell">
                  <EditableCell itemId={item.id} field="exceptionReason" value={item.exceptionReason} />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="payroll-worksheet-totals-row">
              <td className="payroll-worksheet-sticky-col">
                <strong>{t("totals", { count: totals.count })}</strong>
              </td>
              <td />
              <td />
              {viewMode === "worksheet" ? (
                <td className="text-right">
                  <strong><CurrencyDisplay amount={totals.monthlySalary} currency={currency} locale={locale} /></strong>
                </td>
              ) : null}
              {viewMode !== "cycle2" ? (
                <>
                  {viewMode === "worksheet" ? <td /> : null}
                  <td className="text-right">
                    <strong><CurrencyDisplay amount={totals.c1Base} currency={currency} locale={locale} /></strong>
                  </td>
                  <td className="text-right">
                    <strong className="numeric">{totals.c1OtHours}</strong>
                  </td>
                  <td className="text-right">
                    <strong><CurrencyDisplay amount={totals.c1OtAmount} currency={currency} locale={locale} /></strong>
                  </td>
                </>
              ) : null}
              {viewMode !== "cycle1" ? (
                <>
                  {viewMode === "worksheet" ? <td /> : null}
                  <td className="text-right">
                    <strong><CurrencyDisplay amount={totals.c2Base} currency={currency} locale={locale} /></strong>
                  </td>
                  <td className="text-right">
                    <strong className="numeric">{totals.c2OtHours}</strong>
                  </td>
                  <td className="text-right">
                    <strong><CurrencyDisplay amount={totals.c2OtAmount} currency={currency} locale={locale} /></strong>
                  </td>
                </>
              ) : null}
              <td className="text-right">
                <strong><CurrencyDisplay amount={totals.bonus} currency={currency} locale={locale} /></strong>
              </td>
              <td className="text-right">
                <strong><CurrencyDisplay amount={totals.fees} currency={currency} locale={locale} /></strong>
              </td>
              <td className="text-right payroll-worksheet-total-cell">
                <strong><CurrencyDisplay amount={totals.monthlyTotal} currency={currency} locale={locale} /></strong>
              </td>
              <td />
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}
