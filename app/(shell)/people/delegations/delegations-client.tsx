"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";

import { ConfirmDialog } from "../../../../components/shared/confirm-dialog";
import { EmptyState } from "../../../../components/shared/empty-state";
import { DelegationSidePanel } from "../../../../components/delegations/delegation-side-panel";
import { DelegationTable } from "../../../../components/delegations/delegation-table";
import type {
  DelegationRecord,
  DelegationFormValues,
  StatusFilter
} from "../../../../components/delegations/delegation-types";

export function DelegationsClient() {
  const t = useTranslations("delegations");

  // ── State ──────────────────────────────────────────────────────────────

  const [delegations, setDelegations] = useState<DelegationRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");

  // Side panel
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [editingDelegation, setEditingDelegation] = useState<DelegationRecord | null>(null);
  const [panelKey, setPanelKey] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Confirm dialogs
  const [deactivateTarget, setDeactivateTarget] = useState<DelegationRecord | null>(null);
  const [reactivateTarget, setReactivateTarget] = useState<DelegationRecord | null>(null);
  const [isToggling, setIsToggling] = useState(false);

  // People list for dropdowns
  const [people, setPeople] = useState<
    { id: string; fullName: string; department: string | null; roles: string[] }[]
  >([]);

  // ── Data fetching ─────────────────────────────────────────────────────

  const fetchDelegations = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const params = new URLSearchParams();
      if (statusFilter !== "all") {
        params.set("status", statusFilter);
      } else {
        params.set("status", "all");
      }

      const response = await fetch(`/api/v1/delegations?${params.toString()}`);
      const json = await response.json();

      if (!response.ok) {
        setErrorMessage(json?.error?.message ?? t("errorLoading"));
        return;
      }

      setDelegations(json.data.delegations);
    } catch {
      setErrorMessage(t("errorLoading"));
    } finally {
      setIsLoading(false);
    }
  }, [statusFilter, t]);

  const fetchPeople = useCallback(async () => {
    try {
      const response = await fetch("/api/v1/people?scope=all");
      const json = await response.json();

      if (response.ok && json.data?.people) {
        const mapped = json.data.people
          .filter(
            (p: { status: string; deletedAt?: string | null }) =>
              p.status === "active" && !p.deletedAt
          )
          .map(
            (p: {
              id: string;
              fullName: string;
              department: string | null;
              roles: string[];
            }) => ({
              id: p.id,
              fullName: p.fullName,
              department: p.department,
              roles: p.roles ?? []
            })
          )
          .sort((a: { fullName: string }, b: { fullName: string }) =>
            a.fullName.localeCompare(b.fullName)
          );

        setPeople(mapped);
      }
    } catch {
      // People dropdown will be empty — non-fatal
    }
  }, []);

  useEffect(() => {
    void fetchDelegations();
  }, [fetchDelegations]);

  useEffect(() => {
    void fetchPeople();
  }, [fetchPeople]);

  // ── Handlers ──────────────────────────────────────────────────────────

  const handleCreate = () => {
    setEditingDelegation(null);
    setSaveError(null);
    setPanelKey((k) => k + 1);
    setIsPanelOpen(true);
  };

  const handleEdit = (delegation: DelegationRecord) => {
    setEditingDelegation(delegation);
    setSaveError(null);
    setPanelKey((k) => k + 1);
    setIsPanelOpen(true);
  };

  const handleClosePanel = () => {
    setIsPanelOpen(false);
    setEditingDelegation(null);
    setSaveError(null);
  };

  const handleSave = async (values: DelegationFormValues) => {
    setIsSaving(true);
    setSaveError(null);

    try {
      const isUpdate = editingDelegation !== null;
      const url = isUpdate
        ? `/api/v1/delegations/${editingDelegation.id}`
        : "/api/v1/delegations";
      const method = isUpdate ? "PUT" : "POST";

      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values)
      });

      const json = await response.json();

      if (!response.ok) {
        setSaveError(json?.error?.message ?? t("saveFailed"));
        return;
      }

      handleClosePanel();
      void fetchDelegations();
    } catch {
      setSaveError(t("saveFailed"));
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeactivate = (delegation: DelegationRecord) => {
    setDeactivateTarget(delegation);
  };

  const handleReactivate = (delegation: DelegationRecord) => {
    setReactivateTarget(delegation);
  };

  const confirmDeactivate = async () => {
    if (!deactivateTarget) return;
    setIsToggling(true);

    try {
      const response = await fetch(`/api/v1/delegations/${deactivateTarget.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "deactivate" })
      });

      if (response.ok) {
        setDeactivateTarget(null);
        void fetchDelegations();
      }
    } catch {
      // Error handled silently — user can retry
    } finally {
      setIsToggling(false);
    }
  };

  const confirmReactivate = async () => {
    if (!reactivateTarget) return;
    setIsToggling(true);

    try {
      const response = await fetch(`/api/v1/delegations/${reactivateTarget.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reactivate" })
      });

      const json = await response.json();

      if (response.ok) {
        setReactivateTarget(null);
        void fetchDelegations();
      } else {
        // Show error in a way the user can see
        setReactivateTarget(null);
        setErrorMessage(json?.error?.message ?? "Failed to reactivate.");
      }
    } catch {
      setReactivateTarget(null);
    } finally {
      setIsToggling(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <div className="delegations-container">
      {/* Toolbar */}
      <div className="delegations-toolbar">
        <div className="delegations-filters">
          {(["active", "expired", "inactive", "all"] as const).map((filter) => (
            <button
              key={filter}
              type="button"
              className={`delegations-filter-pill${statusFilter === filter ? " delegations-filter-pill-active" : ""}`}
              onClick={() => setStatusFilter(filter)}
            >
              {t(`filter.${filter}`)}
            </button>
          ))}
        </div>

        <button type="button" className="button button-accent" onClick={handleCreate}>
          {t("newDelegation")}
        </button>
      </div>

      {/* Error */}
      {errorMessage ? (
        <div className="delegations-error" role="alert">
          <p>{errorMessage}</p>
          <button
            type="button"
            className="button button-subtle"
            onClick={() => {
              setErrorMessage(null);
              void fetchDelegations();
            }}
          >
            {t("retry")}
          </button>
        </div>
      ) : null}

      {/* Content */}
      {isLoading ? (
        <div className="delegations-loading">
          <div className="spinner" />
        </div>
      ) : delegations.length === 0 ? (
        <EmptyState
          title={t("emptyTitle")}
          description={t("emptyDescription")}
          ctaLabel={t("newDelegation")}
          onCtaClick={handleCreate}
        />
      ) : (
        <DelegationTable
          delegations={delegations}
          onEdit={handleEdit}
          onDeactivate={handleDeactivate}
          onReactivate={handleReactivate}
        />
      )}

      {/* Side panel */}
      <DelegationSidePanel
        key={panelKey}
        isOpen={isPanelOpen}
        delegation={editingDelegation}
        people={people}
        isSaving={isSaving}
        saveError={saveError}
        onSave={handleSave}
        onClose={handleClosePanel}
      />

      {/* Deactivate confirmation */}
      <ConfirmDialog
        isOpen={deactivateTarget !== null}
        title={t("confirmDeactivateTitle")}
        description={t("confirmDeactivateDescription", {
          delegate: deactivateTarget?.delegateName ?? "",
          principal: deactivateTarget?.principalName ?? ""
        })}
        confirmLabel={t("deactivate")}
        tone="danger"
        isConfirming={isToggling}
        onConfirm={confirmDeactivate}
        onCancel={() => setDeactivateTarget(null)}
      />

      {/* Reactivate confirmation */}
      <ConfirmDialog
        isOpen={reactivateTarget !== null}
        title={t("confirmReactivateTitle")}
        description={t("confirmReactivateDescription", {
          delegate: reactivateTarget?.delegateName ?? "",
          principal: reactivateTarget?.principalName ?? ""
        })}
        confirmLabel={t("reactivate")}
        isConfirming={isToggling}
        onConfirm={confirmReactivate}
        onCancel={() => setReactivateTarget(null)}
      />
    </div>
  );
}
