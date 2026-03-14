"use client";

import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";

import { ConfirmDialog } from "../shared/confirm-dialog";
import { SlidePanel } from "../shared/slide-panel";
import type {
  DelegationRecord,
  DelegationFormValues,
  DelegateType,
  DelegateScope,
  ActivationMode,
  PersonOption
} from "./delegation-types";
import { APPROVAL_CAPABLE_ROLES } from "./delegation-types";

type DelegationSidePanelProps = {
  isOpen: boolean;
  delegation: DelegationRecord | null;
  people: PersonOption[];
  isSaving: boolean;
  saveError: string | null;
  onSave: (values: DelegationFormValues) => void;
  onClose: () => void;
};

const DEFAULT_FORM: DelegationFormValues = {
  principalId: "",
  delegateId: "",
  delegateType: "temporary",
  scope: ["leave", "expense", "schedule"],
  activation: "when_unavailable",
  startsAt: null,
  endsAt: null
};

function formFromDelegation(d: DelegationRecord): DelegationFormValues {
  return {
    principalId: d.principalId,
    delegateId: d.delegateId,
    delegateType: d.delegateType,
    scope: [...d.scope],
    activation: d.activation,
    startsAt: d.startsAt,
    endsAt: d.endsAt
  };
}

export function DelegationSidePanel({
  isOpen,
  delegation,
  people,
  isSaving,
  saveError,
  onSave,
  onClose
}: DelegationSidePanelProps) {
  const t = useTranslations("delegations");

  const [form, setForm] = useState<DelegationFormValues>(() =>
    delegation ? formFromDelegation(delegation) : DEFAULT_FORM
  );
  const [showConfirm, setShowConfirm] = useState(false);

  const isEditing = delegation !== null;

  // Filter people for principal dropdown (must have approval-capable role)
  const principalOptions = useMemo(
    () =>
      people.filter(
        (p) =>
          p.id !== form.delegateId &&
          p.roles.some((r) =>
            (APPROVAL_CAPABLE_ROLES as readonly string[]).includes(r)
          )
      ),
    [people, form.delegateId]
  );

  // Filter people for delegate dropdown (exclude selected principal)
  const delegateOptions = useMemo(
    () => people.filter((p) => p.id !== form.principalId),
    [people, form.principalId]
  );

  // Validation
  const isValid = useMemo(() => {
    if (!form.principalId || !form.delegateId) return false;
    if (form.principalId === form.delegateId) return false;
    if (form.scope.length === 0) return false;
    if (form.delegateType === "temporary") {
      if (!form.startsAt || !form.endsAt) return false;
      if (form.endsAt < form.startsAt) return false;
    }
    return true;
  }, [form]);

  const handleScopeToggle = (scope: DelegateScope) => {
    setForm((prev) => {
      const has = prev.scope.includes(scope);
      return {
        ...prev,
        scope: has
          ? prev.scope.filter((s) => s !== scope)
          : [...prev.scope, scope]
      };
    });
  };

  const handleSubmit = () => {
    if (!isValid) return;
    setShowConfirm(true);
  };

  const handleConfirmSave = () => {
    setShowConfirm(false);
    onSave(form);
  };

  // Resolve names for confirmation dialog
  const principalName =
    people.find((p) => p.id === form.principalId)?.fullName ?? "";
  const delegateName =
    people.find((p) => p.id === form.delegateId)?.fullName ?? "";
  const scopeLabels = form.scope.map((s) => t(`scope.${s}`)).join(", ");

  return (
    <>
      <SlidePanel
        isOpen={isOpen}
        title={isEditing ? t("editDelegation") : t("newDelegation")}
        description={t("sidePanelDescription")}
        onClose={onClose}
      >
        <div className="delegation-form">
          {/* Principal */}
          <div className="delegation-form-field">
            <label htmlFor="delegation-principal">{t("field.principal")}</label>
            <p className="delegation-field-hint">{t("field.principalHint")}</p>
            <select
              id="delegation-principal"
              className="delegation-select"
              value={form.principalId}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, principalId: e.target.value }))
              }
            >
              <option value="">{t("field.selectPerson")}</option>
              {principalOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.fullName}
                  {p.department ? ` · ${p.department}` : ""}
                </option>
              ))}
            </select>
          </div>

          {/* Delegate */}
          <div className="delegation-form-field">
            <label htmlFor="delegation-delegate">{t("field.delegate")}</label>
            <p className="delegation-field-hint">{t("field.delegateHint")}</p>
            <select
              id="delegation-delegate"
              className="delegation-select"
              value={form.delegateId}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, delegateId: e.target.value }))
              }
            >
              <option value="">{t("field.selectPerson")}</option>
              {delegateOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.fullName}
                  {p.department ? ` · ${p.department}` : ""}
                </option>
              ))}
            </select>
          </div>

          {/* Delegation Type */}
          <fieldset className="delegation-form-field">
            <legend>{t("field.delegateType")}</legend>
            {(
              [
                "deputy_team_lead",
                "cofounder_coverage",
                "temporary"
              ] as DelegateType[]
            ).map((type) => (
              <label key={type} className="delegation-radio-label">
                <input
                  type="radio"
                  name="delegateType"
                  value={type}
                  checked={form.delegateType === type}
                  onChange={() =>
                    setForm((prev) => ({
                      ...prev,
                      delegateType: type,
                      // Clear dates when switching away from temporary
                      startsAt: type === "temporary" ? prev.startsAt : null,
                      endsAt: type === "temporary" ? prev.endsAt : null
                    }))
                  }
                />
                <span className="delegation-radio-text">
                  <span className="delegation-radio-title">
                    {t(`type.${type}`)}
                  </span>
                  <span className="delegation-radio-description">
                    {t(`typeDescription.${type}`)}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>

          {/* Scope */}
          <fieldset className="delegation-form-field">
            <legend>{t("field.scope")}</legend>
            <p className="delegation-field-hint">{t("field.scopeHint")}</p>
            {(["leave", "expense", "schedule"] as DelegateScope[]).map(
              (scope) => (
                <label key={scope} className="delegation-checkbox-label">
                  <input
                    type="checkbox"
                    checked={form.scope.includes(scope)}
                    onChange={() => handleScopeToggle(scope)}
                  />
                  <span>{t(`scope.${scope}`)}</span>
                </label>
              )
            )}
          </fieldset>

          {/* Activation */}
          <fieldset className="delegation-form-field">
            <legend>{t("field.activation")}</legend>
            {(["when_unavailable", "always"] as ActivationMode[]).map(
              (mode) => (
                <label key={mode} className="delegation-radio-label">
                  <input
                    type="radio"
                    name="activation"
                    value={mode}
                    checked={form.activation === mode}
                    onChange={() =>
                      setForm((prev) => ({ ...prev, activation: mode }))
                    }
                  />
                  <span className="delegation-radio-text">
                    <span className="delegation-radio-title">
                      {t(`activation.${mode}`)}
                    </span>
                    <span className="delegation-radio-description">
                      {t(`activationDescription.${mode}`)}
                    </span>
                  </span>
                </label>
              )
            )}
          </fieldset>

          {/* Date Range (temporary only) */}
          {form.delegateType === "temporary" ? (
            <div className="delegation-form-field">
              <label>{t("field.dateRange")}</label>
              <div className="delegation-date-inputs">
                <div>
                  <label htmlFor="delegation-starts-at" className="delegation-date-label">
                    {t("field.startsAt")}
                  </label>
                  <input
                    id="delegation-starts-at"
                    type="date"
                    className="delegation-date-input"
                    value={form.startsAt ?? ""}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        startsAt: e.target.value || null
                      }))
                    }
                  />
                </div>
                <div>
                  <label htmlFor="delegation-ends-at" className="delegation-date-label">
                    {t("field.endsAt")}
                  </label>
                  <input
                    id="delegation-ends-at"
                    type="date"
                    className="delegation-date-input"
                    value={form.endsAt ?? ""}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        endsAt: e.target.value || null
                      }))
                    }
                  />
                </div>
              </div>
            </div>
          ) : null}

          {/* Error */}
          {saveError ? (
            <div className="delegation-save-error" role="alert">
              {saveError}
            </div>
          ) : null}

          {/* Save button */}
          <button
            type="button"
            className="button button-accent delegation-save-button"
            disabled={!isValid || isSaving}
            onClick={handleSubmit}
          >
            {isSaving
              ? t("saving")
              : isEditing
                ? t("saveChanges")
                : t("createDelegation")}
          </button>
        </div>
      </SlidePanel>

      {/* Confirmation dialog */}
      <ConfirmDialog
        isOpen={showConfirm}
        title={isEditing ? t("confirmEditTitle") : t("confirmCreateTitle")}
        description={t("confirmSaveDescription", {
          delegate: delegateName,
          scopes: scopeLabels,
          principal: principalName,
          activation: t(`activation.${form.activation}`).toLowerCase()
        })}
        confirmLabel={isEditing ? t("saveChanges") : t("createDelegation")}
        isConfirming={isSaving}
        onConfirm={handleConfirmSave}
        onCancel={() => setShowConfirm(false)}
      />
    </>
  );
}
