"use client";

import { type FormEvent, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { EmptyState } from "../../../../components/shared/empty-state";
import { PageHeader } from "../../../../components/shared/page-header";
import { SlidePanel } from "../../../../components/shared/slide-panel";
import { StatusBadge } from "../../../../components/shared/status-badge";
import { ConfirmDialog } from "../../../../components/shared/confirm-dialog";
import { CurrencyDisplay } from "../../../../components/ui/currency-display";
import { EXPENSE_CATEGORIES } from "../../../../types/expenses";
import { getExpenseCategoryLabel } from "../../../../lib/expenses";
import { useExpenseRoutingRules } from "../../../../hooks/use-expense-routing-rules";
import type { RoutingRule } from "../../../../hooks/use-expense-routing-rules";
import { humanizeError } from "@/lib/errors";

type ToastVariant = "success" | "error";

type ToastMessage = {
  id: string;
  variant: ToastVariant;
  message: string;
};

type RuleFormValues = {
  name: string;
  department: string;
  category: string;
  minAmount: string;
  maxAmount: string;
  approverType: "department_owner" | "specific_person";
  approverId: string;
  priority: string;
  isActive: boolean;
};

type RuleFormErrors = Partial<Record<keyof RuleFormValues, string>>;

const INITIAL_FORM: RuleFormValues = {
  name: "",
  department: "",
  category: "",
  minAmount: "",
  maxAmount: "",
  approverType: "department_owner",
  approverId: "",
  priority: "",
  isActive: true
};

function createToastId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function isDigits(value: string): boolean {
  return /^\d+$/.test(value.trim());
}

function hasErrors(errors: Record<string, string | undefined>): boolean {
  return Object.values(errors).some((value) => typeof value === "string" && value.length > 0);
}

function tableSkeleton() {
  return (
    <div className="table-skeleton" aria-hidden="true">
      <div className="table-skeleton-header" />
      {Array.from({ length: 5 }, (_, index) => (
        <div key={`routing-skeleton-${index}`} className="table-skeleton-row" />
      ))}
    </div>
  );
}

function formatAmountRange(
  minAmount: number | null,
  maxAmount: number | null,
  anyLabel: string,
  noMinLabel: string,
  noMaxLabel: string
): string {
  if (minAmount === null && maxAmount === null) {
    return anyLabel;
  }

  if (minAmount !== null && maxAmount !== null) {
    return `${(minAmount / 100).toLocaleString()} – ${(maxAmount / 100).toLocaleString()}`;
  }

  if (minAmount !== null) {
    return `${(minAmount / 100).toLocaleString()}+ (${noMaxLabel})`;
  }

  return `≤ ${(maxAmount! / 100).toLocaleString()} (${noMinLabel})`;
}

export function ExpenseRoutingClient() {
  const t = useTranslations("expenseRouting");
  const tCommon = useTranslations("common");

  const rulesQuery = useExpenseRoutingRules();

  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);

  const [formValues, setFormValues] = useState<RuleFormValues>(INITIAL_FORM);
  const [formErrors, setFormErrors] = useState<RuleFormErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [deactivatingRuleId, setDeactivatingRuleId] = useState<string | null>(null);
  const [isDeactivating, setIsDeactivating] = useState(false);

  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const showToast = (variant: ToastVariant, rawMessage: string) => {
    const message = variant === "error" ? humanizeError(rawMessage) : rawMessage;
    const toastId = createToastId();

    setToasts((currentToasts) => [...currentToasts, { id: toastId, variant, message }]);

    window.setTimeout(() => {
      setToasts((currentToasts) => currentToasts.filter((toast) => toast.id !== toastId));
    }, 4000);
  };

  const sortedRules = useMemo(() => {
    const rows = rulesQuery.data?.rules ?? [];
    return [...rows].sort((a, b) => a.priority - b.priority);
  }, [rulesQuery.data?.rules]);

  const nextPriority = useMemo(() => {
    const rules = rulesQuery.data?.rules ?? [];
    if (rules.length === 0) return 1;
    return Math.max(...rules.map((r) => r.priority)) + 1;
  }, [rulesQuery.data?.rules]);

  function validateForm(values: RuleFormValues): RuleFormErrors {
    const errors: RuleFormErrors = {};

    if (!values.name.trim()) {
      errors.name = t("form.nameRequired");
    }

    if (values.minAmount.trim().length > 0 && !isDigits(values.minAmount)) {
      errors.minAmount = "Must be a whole number.";
    }

    if (values.maxAmount.trim().length > 0 && !isDigits(values.maxAmount)) {
      errors.maxAmount = "Must be a whole number.";
    }

    if (
      isDigits(values.minAmount) &&
      isDigits(values.maxAmount) &&
      Number.parseInt(values.maxAmount, 10) < Number.parseInt(values.minAmount, 10)
    ) {
      errors.maxAmount = "Max must be greater than min.";
    }

    if (values.approverType === "specific_person" && !values.approverId.trim()) {
      errors.approverId = t("form.approverIdRequired");
    }

    if (values.priority.trim().length > 0 && !isDigits(values.priority)) {
      errors.priority = "Must be a whole number.";
    }

    return errors;
  }

  const resetPanel = () => {
    setIsPanelOpen(false);
    setEditingRuleId(null);
    setFormValues(INITIAL_FORM);
    setFormErrors({});
    setIsSubmitting(false);
  };

  const handleOpenCreate = () => {
    setEditingRuleId(null);
    setFormValues({ ...INITIAL_FORM, priority: String(nextPriority) });
    setFormErrors({});
    setIsPanelOpen(true);
  };

  const handleOpenEdit = (ruleId: string) => {
    const rule = (rulesQuery.data?.rules ?? []).find((r) => r.id === ruleId);
    if (!rule) return;

    setEditingRuleId(rule.id);
    setFormValues({
      name: rule.name,
      department: rule.department ?? "",
      category: rule.category ?? "",
      minAmount: rule.min_amount !== null ? String(rule.min_amount) : "",
      maxAmount: rule.max_amount !== null ? String(rule.max_amount) : "",
      approverType: rule.approver_type,
      approverId: rule.approver_id ?? "",
      priority: String(rule.priority),
      isActive: rule.is_active
    });
    setFormErrors({});
    setIsPanelOpen(true);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const errors = validateForm(formValues);
    setFormErrors(errors);

    if (hasErrors(errors)) return;

    setIsSubmitting(true);

    const payload: Record<string, unknown> = {
      name: formValues.name.trim(),
      department: formValues.department.trim() || null,
      category: formValues.category || null,
      min_amount: formValues.minAmount.trim() ? Number.parseInt(formValues.minAmount, 10) : null,
      max_amount: formValues.maxAmount.trim() ? Number.parseInt(formValues.maxAmount, 10) : null,
      approver_type: formValues.approverType,
      approver_id: formValues.approverType === "specific_person" ? formValues.approverId.trim() : null,
      priority: formValues.priority.trim() ? Number.parseInt(formValues.priority, 10) : nextPriority,
      is_active: formValues.isActive
    };

    const isEditing = editingRuleId !== null;

    const result = isEditing
      ? await rulesQuery.updateRule(editingRuleId, payload)
      : await rulesQuery.createRule(payload);

    setIsSubmitting(false);

    if (result.success) {
      showToast("success", isEditing ? t("toast.updateSuccess") : t("toast.createSuccess"));
      resetPanel();
    } else {
      showToast("error", result.errorMessage ?? (isEditing ? t("toast.updateError") : t("toast.createError")));
    }
  };

  const handleDeactivateConfirm = async () => {
    if (!deactivatingRuleId) return;

    setIsDeactivating(true);

    const result = await rulesQuery.deactivateRule(deactivatingRuleId);

    setIsDeactivating(false);
    setDeactivatingRuleId(null);

    if (result.success) {
      showToast("success", t("toast.deactivateSuccess"));
    } else {
      showToast("error", result.errorMessage ?? t("toast.updateError"));
    }
  };

  const handleReactivate = async (ruleId: string) => {
    const result = await rulesQuery.updateRule(ruleId, { is_active: true });

    if (result.success) {
      showToast("success", t("toast.reactivateSuccess"));
    } else {
      showToast("error", result.errorMessage ?? t("toast.updateError"));
    }
  };

  const updateField = <K extends keyof RuleFormValues>(field: K, value: RuleFormValues[K]) => {
    setFormValues((current) => ({ ...current, [field]: value }));
    setFormErrors((current) => ({ ...current, [field]: undefined }));
  };

  // ── Loading ──────────────────────────────────────────────
  if (rulesQuery.isLoading) {
    return (
      <>
        <PageHeader title={t("pageTitle")} description={t("pageDescription")} />
        {tableSkeleton()}
      </>
    );
  }

  // ── Error ────────────────────────────────────────────────
  if (rulesQuery.errorMessage) {
    return (
      <>
        <PageHeader title={t("pageTitle")} description={t("pageDescription")} />
        <EmptyState
          title={tCommon("emptyState.profileUnavailable")}
          description={rulesQuery.errorMessage}
        />
      </>
    );
  }

  // ── Main ─────────────────────────────────────────────────
  const rules = sortedRules;

  return (
    <>
      <PageHeader
        title={t("pageTitle")}
        description={t("pageDescription")}
        actions={
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleOpenCreate}
          >
            {t("addRule")}
          </button>
        }
      />

      {/* Info banner */}
      <div className="info-banner" role="note">
        <p>{t("firstMatchInfo")}</p>
      </div>

      {rules.length === 0 ? (
        <EmptyState
          title={t("emptyTitle")}
          description={t("emptyDescription")}
          ctaLabel={t("addRule")}
          onCtaClick={handleOpenCreate}
        />
      ) : (
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>{t("table.priority")}</th>
                <th>{t("table.name")}</th>
                <th>{t("table.department")}</th>
                <th>{t("table.category")}</th>
                <th>{t("table.amountRange")}</th>
                <th>{t("table.approver")}</th>
                <th>{t("table.status")}</th>
                <th>{t("table.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((rule) => (
                <tr key={rule.id}>
                  <td>{rule.priority}</td>
                  <td>{rule.name}</td>
                  <td>{rule.department ?? t("table.any")}</td>
                  <td>
                    {rule.category
                      ? getExpenseCategoryLabel(rule.category as Parameters<typeof getExpenseCategoryLabel>[0])
                      : t("table.any")}
                  </td>
                  <td>
                    {formatAmountRange(
                      rule.min_amount,
                      rule.max_amount,
                      t("table.any"),
                      t("table.noMin"),
                      t("table.noMax")
                    )}
                  </td>
                  <td>
                    {rule.approver_type === "department_owner"
                      ? t("table.departmentOwner")
                      : rule.approver_name ?? rule.approver_id}
                  </td>
                  <td>
                    <StatusBadge tone={rule.is_active ? "success" : "draft"}>
                      {rule.is_active ? t("table.active") : t("table.inactive")}
                    </StatusBadge>
                  </td>
                  <td>
                    <div className="table-actions">
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => handleOpenEdit(rule.id)}
                      >
                        {tCommon("edit")}
                      </button>
                      {rule.is_active ? (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm btn-danger"
                          onClick={() => setDeactivatingRuleId(rule.id)}
                        >
                          {t("confirm.deactivateConfirm")}
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => handleReactivate(rule.id)}
                        >
                          {t("confirm.reactivate")}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create/Edit SlidePanel */}
      <SlidePanel
        isOpen={isPanelOpen}
        title={editingRuleId ? t("editRule") : t("createRule")}
        onClose={resetPanel}
      >
        <form onSubmit={handleSubmit} noValidate>
          {/* Name */}
          <div className="form-group">
            <label htmlFor="rule-name">{t("form.name")}</label>
            <input
              id="rule-name"
              type="text"
              className="form-input"
              placeholder={t("form.namePlaceholder")}
              value={formValues.name}
              onChange={(e) => updateField("name", e.target.value)}
            />
            {formErrors.name && <p className="form-error">{formErrors.name}</p>}
          </div>

          {/* Department */}
          <div className="form-group">
            <label htmlFor="rule-department">{t("form.department")}</label>
            <input
              id="rule-department"
              type="text"
              className="form-input"
              placeholder={t("form.departmentPlaceholder")}
              value={formValues.department}
              onChange={(e) => updateField("department", e.target.value)}
            />
          </div>

          {/* Category */}
          <div className="form-group">
            <label htmlFor="rule-category">{t("form.category")}</label>
            <select
              id="rule-category"
              className="form-input"
              value={formValues.category}
              onChange={(e) => updateField("category", e.target.value)}
            >
              <option value="">{t("form.anyCategory")}</option>
              {EXPENSE_CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {getExpenseCategoryLabel(cat)}
                </option>
              ))}
            </select>
          </div>

          {/* Min Amount */}
          <div className="form-group">
            <label htmlFor="rule-min-amount">{t("form.minAmount")}</label>
            <input
              id="rule-min-amount"
              type="text"
              inputMode="numeric"
              className="form-input"
              placeholder={t("form.minAmountPlaceholder")}
              value={formValues.minAmount}
              onChange={(e) => updateField("minAmount", e.target.value)}
            />
            {formErrors.minAmount && <p className="form-error">{formErrors.minAmount}</p>}
          </div>

          {/* Max Amount */}
          <div className="form-group">
            <label htmlFor="rule-max-amount">{t("form.maxAmount")}</label>
            <input
              id="rule-max-amount"
              type="text"
              inputMode="numeric"
              className="form-input"
              placeholder={t("form.maxAmountPlaceholder")}
              value={formValues.maxAmount}
              onChange={(e) => updateField("maxAmount", e.target.value)}
            />
            {formErrors.maxAmount && <p className="form-error">{formErrors.maxAmount}</p>}
          </div>

          {/* Approver Type */}
          <div className="form-group">
            <label htmlFor="rule-approver-type">{t("form.approverType")}</label>
            <select
              id="rule-approver-type"
              className="form-input"
              value={formValues.approverType}
              onChange={(e) =>
                updateField("approverType", e.target.value as "department_owner" | "specific_person")
              }
            >
              <option value="department_owner">{t("form.departmentOwner")}</option>
              <option value="specific_person">{t("form.specificPerson")}</option>
            </select>
          </div>

          {/* Approver ID (conditional) */}
          {formValues.approverType === "specific_person" && (
            <div className="form-group">
              <label htmlFor="rule-approver-id">{t("form.approverId")}</label>
              <input
                id="rule-approver-id"
                type="text"
                className="form-input"
                placeholder={t("form.approverIdPlaceholder")}
                value={formValues.approverId}
                onChange={(e) => updateField("approverId", e.target.value)}
              />
              {formErrors.approverId && <p className="form-error">{formErrors.approverId}</p>}
            </div>
          )}

          {/* Priority */}
          <div className="form-group">
            <label htmlFor="rule-priority">{t("form.priority")}</label>
            <input
              id="rule-priority"
              type="text"
              inputMode="numeric"
              className="form-input"
              value={formValues.priority}
              onChange={(e) => updateField("priority", e.target.value)}
            />
            <p className="form-hint">{t("form.priorityHint")}</p>
            {formErrors.priority && <p className="form-error">{formErrors.priority}</p>}
          </div>

          {/* Active */}
          <div className="form-group form-group-checkbox">
            <label htmlFor="rule-active">
              <input
                id="rule-active"
                type="checkbox"
                checked={formValues.isActive}
                onChange={(e) => updateField("isActive", e.target.checked)}
              />
              {t("form.active")}
            </label>
          </div>

          {/* Submit */}
          <div className="form-actions">
            <button type="button" className="btn btn-ghost" onClick={resetPanel}>
              {tCommon("cancel")}
            </button>
            <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
              {isSubmitting
                ? tCommon("working")
                : editingRuleId
                  ? t("editRule")
                  : t("createRule")}
            </button>
          </div>
        </form>
      </SlidePanel>

      {/* Deactivate confirmation */}
      <ConfirmDialog
        isOpen={deactivatingRuleId !== null}
        title={t("confirm.deactivateTitle")}
        description={t("confirm.deactivateDescription")}
        confirmLabel={t("confirm.deactivateConfirm")}
        tone="danger"
        reverseEmphasis
        isConfirming={isDeactivating}
        onConfirm={handleDeactivateConfirm}
        onCancel={() => setDeactivatingRuleId(null)}
      />

      {/* Toasts */}
      {toasts.length > 0 && (
        <div className="toast-container" aria-live="polite">
          {toasts.map((toast) => (
            <div
              key={toast.id}
              className={`toast toast-${toast.variant}`}
              role="status"
            >
              {toast.message}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
