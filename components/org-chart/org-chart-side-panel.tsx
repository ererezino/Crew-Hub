"use client";

import { useCallback, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { SlidePanel } from "../shared/slide-panel";
import { ConfirmDialog } from "../shared/confirm-dialog";
import type { OrgChartPerson } from "../../lib/org-chart/types";

type OrgChartSidePanelProps = {
  person: OrgChartPerson | null;
  allPeople: OrgChartPerson[];
  onClose: () => void;
  onSave: (personId: string, updates: { managerId?: string | null; teamLeadId?: string | null }) => Promise<void>;
};

type PendingChange = {
  field: "managerId" | "teamLeadId";
  fieldLabel: string;
  oldId: string | null;
  oldName: string | null;
  newId: string | null;
  newName: string | null;
};

export function OrgChartSidePanel({ person, allPeople, onClose, onSave }: OrgChartSidePanelProps) {
  const t = useTranslations("orgChart");
  const tCommon = useTranslations("common");

  const [editManagerId, setEditManagerId] = useState<string | null>(null);
  const [editTeamLeadId, setEditTeamLeadId] = useState<string | null>(null);
  const [pendingChange, setPendingChange] = useState<PendingChange | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset form when person changes
  const personId = person?.id ?? null;
  const [lastPersonId, setLastPersonId] = useState<string | null>(null);
  if (personId !== lastPersonId) {
    setLastPersonId(personId);
    setEditManagerId(person?.managerId ?? null);
    setEditTeamLeadId(person?.teamLeadId ?? null);
    setError(null);
    setPendingChange(null);
  }

  // Eligible people for dropdowns: active, not deleted, not self
  const eligiblePeople = useMemo(() => {
    if (!person) return [];
    return allPeople
      .filter(
        (p) =>
          p.id !== person.id &&
          p.status === "active"
      )
      .sort((a, b) => a.fullName.localeCompare(b.fullName));
  }, [allPeople, person]);

  const getPersonName = useCallback(
    (id: string | null): string | null => {
      if (!id) return null;
      return allPeople.find((p) => p.id === id)?.fullName ?? null;
    },
    [allPeople]
  );

  const hasManagerChanged = person ? editManagerId !== (person.managerId ?? null) : false;
  const hasTeamLeadChanged = person ? editTeamLeadId !== (person.teamLeadId ?? null) : false;
  const hasChanges = hasManagerChanged || hasTeamLeadChanged;

  const handleSaveAll = useCallback(() => {
    if (!person || !hasChanges) return;

    // If both changed, confirm manager first, then team lead
    if (hasManagerChanged) {
      setPendingChange({
        field: "managerId",
        fieldLabel: t("sidePanel.reportsTo"),
        oldId: person.managerId,
        oldName: getPersonName(person.managerId),
        newId: editManagerId,
        newName: getPersonName(editManagerId)
      });
    } else if (hasTeamLeadChanged) {
      setPendingChange({
        field: "teamLeadId",
        fieldLabel: t("sidePanel.operationalLead"),
        oldId: person.teamLeadId,
        oldName: getPersonName(person.teamLeadId),
        newId: editTeamLeadId,
        newName: getPersonName(editTeamLeadId)
      });
    }
    setIsConfirming(true);
  }, [person, hasChanges, hasManagerChanged, hasTeamLeadChanged, editManagerId, editTeamLeadId, getPersonName, t]);

  const handleConfirm = useCallback(async () => {
    if (!person) return;

    setIsSaving(true);
    setError(null);

    try {
      const updates: { managerId?: string | null; teamLeadId?: string | null } = {};
      if (hasManagerChanged) {
        updates.managerId = editManagerId;
      }
      if (hasTeamLeadChanged) {
        updates.teamLeadId = editTeamLeadId;
      }

      await onSave(person.id, updates);
      setPendingChange(null);
      setIsConfirming(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("sidePanel.saveFailed"));
    } finally {
      setIsSaving(false);
    }
  }, [person, hasManagerChanged, hasTeamLeadChanged, editManagerId, editTeamLeadId, onSave, t]);

  const handleCancelConfirm = useCallback(() => {
    setPendingChange(null);
    setIsConfirming(false);
  }, []);

  // Build confirmation description
  const confirmDescription = pendingChange
    ? t("sidePanel.confirmChange", {
        name: person?.fullName ?? "",
        field: pendingChange.fieldLabel,
        oldValue: pendingChange.oldName ?? t("sidePanel.none"),
        newValue: pendingChange.newName ?? t("sidePanel.none")
      })
    : "";

  // Current manager display name (used for fallback hint in team lead dropdown)
  const currentManagerName = getPersonName(person?.managerId ?? null);

  return (
    <>
      <SlidePanel
        isOpen={person !== null}
        title={person?.fullName ?? ""}
        description={
          [person?.title, person?.department].filter(Boolean).join(" \u00B7 ") || undefined
        }
        onClose={onClose}
      >
        {person ? (
          <div className="org-chart-side-panel-content">
            {/* Status indicator for inactive people */}
            {(person.status === "inactive" || person.status === "offboarding") ? (
              <div className="org-chart-side-panel-warning">
                {t("sidePanel.inactiveWarning", { status: person.status })}
              </div>
            ) : null}

            {/* Reporting manager */}
            <fieldset className="org-chart-side-panel-field">
              <label className="org-chart-side-panel-label" htmlFor="org-chart-manager">
                {t("sidePanel.reportsTo")}
              </label>
              <p className="org-chart-side-panel-hint">{t("sidePanel.reportsToHint")}</p>
              <select
                id="org-chart-manager"
                className="input"
                value={editManagerId ?? ""}
                onChange={(e) => setEditManagerId(e.target.value || null)}
              >
                <option value="">{t("sidePanel.none")}</option>
                {eligiblePeople.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.fullName}
                    {p.department ? ` (${p.department})` : ""}
                  </option>
                ))}
              </select>
            </fieldset>

            {/* Operational lead */}
            <fieldset className="org-chart-side-panel-field">
              <label className="org-chart-side-panel-label" htmlFor="org-chart-team-lead">
                {t("sidePanel.operationalLead")}
              </label>
              <p className="org-chart-side-panel-hint">
                {t("sidePanel.operationalLeadHint")}
              </p>
              <select
                id="org-chart-team-lead"
                className="input"
                value={editTeamLeadId ?? ""}
                onChange={(e) => setEditTeamLeadId(e.target.value || null)}
              >
                <option value="">
                  {currentManagerName
                    ? t("sidePanel.fallbackToManager", { name: currentManagerName })
                    : t("sidePanel.none")}
                </option>
                {eligiblePeople.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.fullName}
                    {p.department ? ` (${p.department})` : ""}
                  </option>
                ))}
              </select>
            </fieldset>

            {/* Error */}
            {error ? (
              <p className="org-chart-side-panel-error" role="alert">{error}</p>
            ) : null}

            {/* Save button */}
            <div className="org-chart-side-panel-actions">
              <button
                type="button"
                className="button button-accent"
                disabled={!hasChanges || isSaving}
                onClick={handleSaveAll}
              >
                {isSaving ? tCommon("working") : t("sidePanel.saveChanges")}
              </button>
            </div>
          </div>
        ) : null}
      </SlidePanel>

      <ConfirmDialog
        isOpen={isConfirming}
        title={t("sidePanel.confirmTitle")}
        description={confirmDescription}
        confirmLabel={t("sidePanel.confirmSave")}
        isConfirming={isSaving}
        onConfirm={handleConfirm}
        onCancel={handleCancelConfirm}
      />
    </>
  );
}
