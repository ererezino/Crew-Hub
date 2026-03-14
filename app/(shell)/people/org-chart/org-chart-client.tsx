"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { EmptyState } from "../../../../components/shared/empty-state";
import { OrgChartSidePanel } from "../../../../components/org-chart/org-chart-side-panel";
import { OrgChartToolbar } from "../../../../components/org-chart/org-chart-toolbar";
import { OrgChartTree, type OrgChartTreeHandle } from "../../../../components/org-chart/org-chart-tree";
import { usePeople } from "../../../../hooks/use-people";
import type { OrgChartPerson } from "../../../../lib/org-chart/types";
import type { PersonRecord } from "../../../../types/people";

function toOrgChartPerson(p: PersonRecord): OrgChartPerson {
  return {
    id: p.id,
    fullName: p.fullName,
    title: p.title,
    department: p.department,
    roles: p.roles,
    status: p.status,
    avatarUrl: p.avatarUrl,
    managerId: p.managerId,
    teamLeadId: p.teamLeadId,
    teamLeadName: p.teamLeadName
  };
}

export function OrgChartClient() {
  const t = useTranslations("orgChart");
  const { people, isLoading, errorMessage, refresh, setPeople } = usePeople({ scope: "all" });

  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);
  const [showOperationalLeads, setShowOperationalLeads] = useState(false);
  const [zoomPercent, setZoomPercent] = useState(100);
  const treeRef = useRef<OrgChartTreeHandle>(null);

  // Map people to org chart format — exclude inactive people from the tree
  const orgChartPeople = useMemo<OrgChartPerson[]>(
    () => people.filter((p) => p.status !== "inactive").map(toOrgChartPerson),
    [people]
  );

  const selectedPerson = useMemo(
    () => orgChartPeople.find((p) => p.id === selectedPersonId) ?? null,
    [orgChartPeople, selectedPersonId]
  );

  const handleSelectPerson = useCallback((personId: string | null) => {
    setSelectedPersonId(personId);
  }, []);

  const handleCloseSidePanel = useCallback(() => {
    setSelectedPersonId(null);
  }, []);

  const handleSave = useCallback(
    async (personId: string, updates: { managerId?: string | null; teamLeadId?: string | null }) => {
      const response = await fetch(`/api/v1/people/${personId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates)
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error?.message ?? t("sidePanel.saveFailed"));
      }

      // Optimistically update local state
      const updatedPerson = data?.data?.person;
      if (updatedPerson) {
        setPeople((prev) =>
          prev.map((p) =>
            p.id === personId
              ? {
                  ...p,
                  managerId: updatedPerson.managerId ?? p.managerId,
                  managerName: updatedPerson.managerName ?? p.managerName,
                  teamLeadId: updatedPerson.teamLeadId ?? p.teamLeadId,
                  teamLeadName: updatedPerson.teamLeadName ?? p.teamLeadName
                }
              : p
          )
        );
      }

      // Also refetch to ensure consistency
      refresh();
    },
    [refresh, setPeople, t]
  );

  const handleToggleOperationalLeads = useCallback(() => {
    setShowOperationalLeads((prev) => !prev);
  }, []);

  const handleFitToScreen = useCallback(() => {
    treeRef.current?.fitToScreen();
  }, []);

  const handleZoomIn = useCallback(() => {
    treeRef.current?.zoomIn();
  }, []);

  const handleZoomOut = useCallback(() => {
    treeRef.current?.zoomOut();
  }, []);

  const handleZoomChange = useCallback((scale: number) => {
    setZoomPercent(Math.round(scale * 100));
  }, []);

  if (isLoading) {
    return (
      <div className="org-chart-loading">
        <div className="spinner" aria-label={t("loading")} />
      </div>
    );
  }

  if (errorMessage) {
    return (
      <EmptyState
        title={t("errorTitle")}
        description={errorMessage}
      />
    );
  }

  if (orgChartPeople.length === 0) {
    return (
      <EmptyState
        title={t("emptyTitle")}
        description={t("emptyDescription")}
      />
    );
  }

  return (
    <div className="org-chart-container">
      <OrgChartToolbar
        showOperationalLeads={showOperationalLeads}
        onToggleOperationalLeads={handleToggleOperationalLeads}
        onFitToScreen={handleFitToScreen}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        zoomPercent={zoomPercent}
      />

      <OrgChartTree
        ref={treeRef}
        people={orgChartPeople}
        selectedPersonId={selectedPersonId}
        onSelectPerson={handleSelectPerson}
        showOperationalLeads={showOperationalLeads}
        onZoomChange={handleZoomChange}
      />

      <OrgChartSidePanel
        person={selectedPerson}
        allPeople={orgChartPeople}
        onClose={handleCloseSidePanel}
        onSave={handleSave}
      />
    </div>
  );
}
