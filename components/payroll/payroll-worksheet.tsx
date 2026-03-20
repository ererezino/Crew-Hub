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
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
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

export type ViewMode = "worksheet" | "cycle1" | "cycle2";

type WorksheetDisplayRow = {
  id: string;
  fullName: string;
  designation: string | null;
  department: string | null;
  accrueUsername: string | null;
  baseSalaryAmount: number;
  cycle1Included: boolean;
  cycle2Included: boolean;
  cycle1BaseAmount: number;
  cycle2BaseAmount: number;
  cycle1OvertimeHours: number;
  cycle2OvertimeHours: number;
  cycle1OvertimeAmount: number;
  cycle2OvertimeAmount: number;
  bonus: number;
  fees: number;
  comment: string | null;
  exceptionReason: string | null;
  monthlyTotal: number;
};

export function PayrollWorksheet({
  run,
  items,
  cycles,
  canEdit,
  canApprove,
  viewerUserId,
  viewMode,
  onViewModeChange,
  onItemUpdated,
  onToast
}: WorksheetProps) {
  const t = useTranslations("payrollWorksheet");
  const locale = useLocale() as AppLocale;
  const [editingCell, setEditingCell] = useState<EditingCell | null>(null);
  const [editValue, setEditValue] = useState("");
  const [savingItemId, setSavingItemId] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [cycleActionLoading, setCycleActionLoading] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState<string | null>(null);
  const [rejectCycleId, setRejectCycleId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [markPaidCycleId, setMarkPaidCycleId] = useState<string | null>(null);
  const [paymentReference, setPaymentReference] = useState("");
  const [paymentNote, setPaymentNote] = useState("");

  const currency = run.totalGross ? Object.keys(run.totalGross)[0] ?? "NGN" : "NGN";

  const cycle1 = cycles.find((c) => c.cycleNumber === 1);
  const cycle2 = cycles.find((c) => c.cycleNumber === 2);
  const activeCycle = viewMode === "cycle1" ? cycle1 : viewMode === "cycle2" ? cycle2 : undefined;

  /* Per-cycle freeze: fields for a cycle are locked once it leaves draft/rejected */
  const frozenStatuses = ["submitted", "approved", "ready", "processing", "paid"];
  const isCycle1Frozen = Boolean(cycle1 && frozenStatuses.includes(cycle1.status));
  const isCycle2Frozen = Boolean(cycle2 && frozenStatuses.includes(cycle2.status));
  const hasFrozenCycle = isCycle1Frozen || isCycle2Frozen;

  const cycle1Fields: Array<keyof WorksheetRowEditPayload> = ["cycle1BaseAmount", "cycle1OvertimeHours", "cycle1Included"];
  const cycle2Fields: Array<keyof WorksheetRowEditPayload> = ["cycle2BaseAmount", "cycle2OvertimeHours", "cycle2Included"];
  const sharedFields: Array<keyof WorksheetRowEditPayload> = ["bonus", "fees", "comment", "exceptionReason"];

  function isFieldFrozen(field: keyof WorksheetRowEditPayload): boolean {
    if (cycle1Fields.includes(field)) return isCycle1Frozen;
    if (cycle2Fields.includes(field)) return isCycle2Frozen;
    if (sharedFields.includes(field)) return hasFrozenCycle;
    return false;
  }

  function frozenReason(field: keyof WorksheetRowEditPayload): string | undefined {
    if (sharedFields.includes(field) && hasFrozenCycle) {
      return t("freeze.sharedFields");
    }
    if (cycle1Fields.includes(field) && isCycle1Frozen) {
      return t("freeze.cycleFields", { cycle: 1 });
    }
    if (cycle2Fields.includes(field) && isCycle2Frozen) {
      return t("freeze.cycleFields", { cycle: 2 });
    }
    return undefined;
  }

  function formatDateTime(value: string | null | undefined): string | null {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en-US", {
      dateStyle: "medium",
      timeStyle: "short"
    }).format(date);
  }

  const liveRows = useMemo<WorksheetDisplayRow[]>(
    () =>
      items.map((item) => ({
        id: item.id,
        fullName: item.fullName,
        designation: item.designation,
        department: item.department,
        accrueUsername: item.accrueUsername,
        baseSalaryAmount: item.baseSalaryAmount,
        cycle1Included: item.cycle1Included,
        cycle2Included: item.cycle2Included,
        cycle1BaseAmount: item.cycle1BaseAmount,
        cycle2BaseAmount: item.cycle2BaseAmount,
        cycle1OvertimeHours: item.cycle1OvertimeHours,
        cycle2OvertimeHours: item.cycle2OvertimeHours,
        cycle1OvertimeAmount: item.cycle1OvertimeAmount,
        cycle2OvertimeAmount: item.cycle2OvertimeAmount,
        bonus: item.bonus,
        fees: item.fees,
        comment: item.comment,
        exceptionReason: item.exceptionReason,
        monthlyTotal: item.monthlyTotal
      })),
    [items]
  );

  const activeSnapshot =
    viewMode !== "worksheet" &&
    activeCycle &&
    activeCycle.status !== "draft" &&
    activeCycle.status !== "rejected"
      ? activeCycle.approvalSnapshot
      : null;

  const snapshotRows = useMemo<WorksheetDisplayRow[]>(() => {
    if (!activeSnapshot) return [];

    return activeSnapshot.rows.map((row) => ({
      id: row.employeeId,
      fullName: row.employeeName,
      designation: row.designation,
      department: row.department,
      accrueUsername: row.accrueUsername,
      baseSalaryAmount: row.monthlySalary,
      cycle1Included: viewMode === "cycle1",
      cycle2Included: viewMode === "cycle2",
      cycle1BaseAmount: viewMode === "cycle1" ? row.cycleBaseAmount : 0,
      cycle2BaseAmount: viewMode === "cycle2" ? row.cycleBaseAmount : 0,
      cycle1OvertimeHours: viewMode === "cycle1" ? row.overtimeHours : 0,
      cycle2OvertimeHours: viewMode === "cycle2" ? row.overtimeHours : 0,
      cycle1OvertimeAmount: viewMode === "cycle1" ? row.overtimeAmount : 0,
      cycle2OvertimeAmount: viewMode === "cycle2" ? row.overtimeAmount : 0,
      bonus: row.bonus,
      fees: row.fees,
      comment: row.comment,
      exceptionReason: row.exceptionReason,
      monthlyTotal: row.finalPayable
    }));
  }, [activeSnapshot, viewMode]);

  const sourceRows = activeSnapshot ? snapshotRows : liveRows;
  const tableIsReadOnly = Boolean(activeSnapshot);
  const canEditLiveWorksheet = canEdit && !tableIsReadOnly;

  const sortedItems = useMemo(() => {
    const rows = [...sourceRows];
    return rows.sort((a, b) => {
      const cmp = a.fullName.localeCompare(b.fullName);
      return sortDirection === "asc" ? cmp : -cmp;
    });
  }, [sourceRows, sortDirection]);

  const filteredItems = useMemo(() => {
    if (activeSnapshot) return sortedItems;
    if (viewMode === "cycle1") return sortedItems.filter((i) => i.cycle1Included);
    if (viewMode === "cycle2") return sortedItems.filter((i) => i.cycle2Included);
    return sortedItems;
  }, [activeSnapshot, sortedItems, viewMode]);

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
    if (!canEditLiveWorksheet || isFieldFrozen(field)) return;
    setEditingCell({ itemId, field });
    setEditValue(currentValue === null ? "" : String(currentValue));
  }, [canEditLiveWorksheet, isCycle1Frozen, isCycle2Frozen, tableIsReadOnly]);

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
      } else {
        const json = await res.json().catch(() => null);
        const msg = (json as { error?: { message?: string } } | null)?.error?.message ?? "Unable to save worksheet edit.";
        onToast("error", msg);
      }
    } finally {
      setSavingItemId(null);
      setEditValue("");
    }
  }, [editingCell, editValue, run.id, onItemUpdated, onToast]);

  const toggleCycleInclusion = useCallback(async (itemId: string, cycle: 1 | 2, currentValue: boolean) => {
    if (!canEditLiveWorksheet) return;
    if (cycle === 1 && isCycle1Frozen) return;
    if (cycle === 2 && isCycle2Frozen) return;
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
      if (res.ok) {
        onItemUpdated();
      } else {
        const json = await res.json().catch(() => null);
        const msg = (json as { error?: { message?: string } } | null)?.error?.message ?? "Unable to save worksheet edit.";
        onToast("error", msg);
      }
    } finally {
      setSavingItemId(null);
    }
  }, [canEditLiveWorksheet, isCycle1Frozen, isCycle2Frozen, run.id, onItemUpdated, onToast]);

  /* ── Cycle-level actions (Amendment 1 — primary workflow) ── */

  const performCycleAction = useCallback(async ({
    cycleId,
    action,
    reason,
    paymentReference: nextPaymentReference,
    paymentNote: nextPaymentNote
  }: {
    cycleId: string;
    action: "submit" | "approve" | "reject" | "mark_ready" | "mark_processing" | "mark_paid";
    reason?: string;
    paymentReference?: string;
    paymentNote?: string;
  }) => {
    setCycleActionLoading(`${cycleId}-${action}`);
    try {
      const res = await fetch(`/api/v1/payroll/runs/${run.id}/cycles/${cycleId}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          reason: reason ?? null,
          paymentReference: nextPaymentReference?.trim() || null,
          paymentNote: nextPaymentNote?.trim() || null
        })
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

  const exportCycle = useCallback(async (cycleId: string, format: "csv" | "pdf") => {
    setIsExporting(`${cycleId}-${format}`);
    try {
      const res = await fetch(`/api/v1/payroll/runs/${run.id}/cycles/${cycleId}/export?format=${format}`);
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        onToast("error", (json as { error?: { message?: string } } | null)?.error?.message ?? t("cycleActions.exportFailed"));
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `cycle-${cycleId.slice(0, 8)}-export.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      onToast("success", format === "pdf" ? t("cycleActions.exportPdfSuccess") : t("cycleActions.exportSuccess"));
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
    const frozen = isFieldFrozen(field);
    const cellEditable = canEditLiveWorksheet && !frozen;

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
      : (value ?? <span className="text-muted">{String.fromCharCode(8212)}</span>);

    return (
      <span
        className={`${cellEditable ? "worksheet-cell-editable" : ""} ${frozen ? "worksheet-cell-frozen" : ""} ${className ?? ""} ${isSaving ? "worksheet-cell-saving" : ""}`}
        onClick={() => cellEditable && startEdit(itemId, field, value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && cellEditable) startEdit(itemId, field, value);
        }}
        role={cellEditable ? "button" : undefined}
        tabIndex={cellEditable ? 0 : undefined}
        title={frozen ? frozenReason(field) : undefined}
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
          onClick={() => onViewModeChange("worksheet")}
        >
          {t("tabs.worksheet")}
        </button>
        <button
          type="button"
          className={`payroll-worksheet-tab ${viewMode === "cycle1" ? "active" : ""}`}
          onClick={() => onViewModeChange("cycle1")}
        >
          {t("tabs.cycle1")}
          {cycle1 ? (
            <StatusBadge tone={cycleTone(cycle1.status)}>{cycle1.status}</StatusBadge>
          ) : null}
        </button>
        <button
          type="button"
          className={`payroll-worksheet-tab ${viewMode === "cycle2" ? "active" : ""}`}
          onClick={() => onViewModeChange("cycle2")}
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
        const isMarkPaidThis = markPaidCycleId === cycleId;

        return (
          <div className="payroll-worksheet-cycle-actions">
            {actions.canSubmit ? (
              <button
                type="button"
                className="button button-accent"
                disabled={isLoading}
                onClick={() => void performCycleAction({ cycleId, action: "submit" })}
              >
                {cycleActionLoading === `${cycleId}-submit` ? t("cycleActions.submitting") : t("cycleActions.submitCycle")}
              </button>
            ) : null}
            {actions.canApproveCycle ? (
              <button
                type="button"
                className="button button-approve"
                disabled={isLoading}
                onClick={() => void performCycleAction({ cycleId, action: "approve" })}
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
                onClick={() => {
                  setMarkPaidCycleId(cycleId);
                  setPaymentReference(activeCycle?.paymentReference ?? "");
                  setPaymentNote(activeCycle?.paymentNote ?? "");
                }}
              >
                {t("cycleActions.markPaid")}
              </button>
            ) : null}
            {actions.canExport ? (
              <>
                <button
                  type="button"
                  className="button"
                  disabled={isExporting !== null}
                  onClick={() => void exportCycle(cycleId, "csv")}
                >
                  {isExporting === `${cycleId}-csv` ? t("cycleActions.exporting") : t("cycleActions.exportCsv")}
                </button>
                <button
                  type="button"
                  className="button button-subtle"
                  disabled={isExporting !== null}
                  onClick={() => void exportCycle(cycleId, "pdf")}
                >
                  {isExporting === `${cycleId}-pdf` ? t("cycleActions.exportingPdf") : t("cycleActions.exportPdf")}
                </button>
              </>
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
                      const ok = await performCycleAction({
                        cycleId,
                        action: "reject",
                        reason: rejectReason.trim()
                      });
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

            {isMarkPaidThis ? (
              <div className="payroll-worksheet-reject-inline">
                <input
                  className="input"
                  placeholder={t("cycleActions.paymentReferencePlaceholder")}
                  value={paymentReference}
                  onChange={(e) => setPaymentReference(e.target.value)}
                />
                <textarea
                  className="input"
                  rows={2}
                  placeholder={t("cycleActions.paymentNotePlaceholder")}
                  value={paymentNote}
                  onChange={(e) => setPaymentNote(e.target.value)}
                />
                <div className="button-row">
                  <button
                    type="button"
                    className="button button-consequential"
                    disabled={!paymentReference.trim() || isLoading}
                    onClick={async () => {
                      const ok = await performCycleAction({
                        cycleId,
                        action: "mark_paid",
                        paymentReference,
                        paymentNote
                      });
                      if (ok) {
                        setMarkPaidCycleId(null);
                        setPaymentReference("");
                        setPaymentNote("");
                      }
                    }}
                  >
                    {cycleActionLoading === `${cycleId}-mark_paid`
                      ? t("cycleActions.markingPaid")
                      : t("cycleActions.confirmMarkPaid")}
                  </button>
                  <button
                    type="button"
                    className="button button-subtle"
                    onClick={() => {
                      setMarkPaidCycleId(null);
                      setPaymentReference("");
                      setPaymentNote("");
                    }}
                  >
                    {t("cycleActions.cancelMarkPaid")}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        );
      })() : null}

      {activeSnapshot ? (
        <section className="payroll-worksheet-snapshot" aria-label={t("snapshot.title")}>
          <div className="payroll-worksheet-snapshot-header">
            <div>
              <h3 className="section-title">{t("snapshot.title")}</h3>
              <p className="settings-card-description">{t("snapshot.description")}</p>
            </div>
            {activeCycle ? (
              <StatusBadge tone={cycleTone(activeCycle.status)}>
                {activeCycle.status}
              </StatusBadge>
            ) : null}
          </div>
          <div className="payroll-worksheet-snapshot-grid">
            <div>
              <span className="payroll-worksheet-snapshot-label">{t("snapshot.submittedBy")}</span>
              <span className="payroll-worksheet-snapshot-value">{activeSnapshot.submittedByName}</span>
            </div>
            <div>
              <span className="payroll-worksheet-snapshot-label">{t("snapshot.submittedAt")}</span>
              <span className="payroll-worksheet-snapshot-value">{formatDateTime(activeSnapshot.submittedAt) ?? "\u2014"}</span>
            </div>
            <div>
              <span className="payroll-worksheet-snapshot-label">{t("snapshot.employeeCount")}</span>
              <span className="payroll-worksheet-snapshot-value">{activeSnapshot.employeeCount}</span>
            </div>
            <div>
              <span className="payroll-worksheet-snapshot-label">{t("snapshot.totalNet")}</span>
              <span className="payroll-worksheet-snapshot-value">
                <CurrencyDisplay amount={activeSnapshot.totalNet} currency={activeSnapshot.currency} locale={locale} />
              </span>
            </div>
            {activeCycle?.approvedAt ? (
              <div>
                <span className="payroll-worksheet-snapshot-label">{t("snapshot.approvedAt")}</span>
                <span className="payroll-worksheet-snapshot-value">{formatDateTime(activeCycle.approvedAt) ?? "\u2014"}</span>
              </div>
            ) : null}
            {activeCycle?.paidAt ? (
              <div>
                <span className="payroll-worksheet-snapshot-label">{t("snapshot.paidAt")}</span>
                <span className="payroll-worksheet-snapshot-value">{formatDateTime(activeCycle.paidAt) ?? "\u2014"}</span>
              </div>
            ) : null}
            {activeCycle?.paymentReference ? (
              <div>
                <span className="payroll-worksheet-snapshot-label">{t("snapshot.paymentReference")}</span>
                <span className="payroll-worksheet-snapshot-value">{activeCycle.paymentReference}</span>
              </div>
            ) : null}
            {activeCycle?.paymentNote ? (
              <div>
                <span className="payroll-worksheet-snapshot-label">{t("snapshot.paymentNote")}</span>
                <span className="payroll-worksheet-snapshot-value">{activeCycle.paymentNote}</span>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

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
                          disabled={!canEditLiveWorksheet || isCycle1Frozen || savingItemId === item.id}
                          onChange={() => void toggleCycleInclusion(item.id, 1, item.cycle1Included)}
                          title={isCycle1Frozen ? "Cycle 1 is locked — it has been submitted for approval." : undefined}
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
                          disabled={!canEditLiveWorksheet || isCycle2Frozen || savingItemId === item.id}
                          onChange={() => void toggleCycleInclusion(item.id, 2, item.cycle2Included)}
                          title={isCycle2Frozen ? "Cycle 2 is locked — it has been submitted for approval." : undefined}
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
