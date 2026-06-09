/* eslint-disable i18next/no-literal-string */
"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";

import { SlidePanel } from "../shared/slide-panel";
import { StatusBadge } from "../shared/status-badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { formatDate as formatDateLib, formatRelativeTime } from "../../lib/datetime";
import type { PersonWorkToolsResponseData, WorkToolIssueType, WorkToolRecord, WorkToolRequestKind, WorkToolRequestRecord, WorkToolRequestStatus, WorkToolType } from "../../types/work-tools";
import { WORK_TOOL_ISSUE_TYPES, WORK_TOOL_REQUEST_STATUSES, WORK_TOOL_TYPES } from "../../types/work-tools";
import { WorkToolEditorPanel, type WorkToolFormValues } from "./work-tool-editor-panel";

type ProfileWorkToolsCardProps = {
  employeeId: string;
  employeeName: string;
  isSelf: boolean;
  canManageWorkTools: boolean;
};

const INITIAL_TOOL_VALUES: WorkToolFormValues = {
  employeeId: "",
  itemType: "laptop",
  itemName: "",
  serialNumber: "",
  transactionCurrency: "",
  costAmount: "",
  status: "assigned",
  assignedAt: "",
  notes: ""
};

type ToolRequestFormValues = {
  requestKind: WorkToolRequestKind;
  requestedItemType: WorkToolType;
  toolId: string;
  issueType: WorkToolIssueType;
  details: string;
};

const INITIAL_REQUEST_VALUES: ToolRequestFormValues = {
  requestKind: "tool_request",
  requestedItemType: "laptop",
  toolId: "",
  issueType: "faulty",
  details: ""
};

const TOOL_TYPE_LABELS: Record<WorkToolType, string> = {
  laptop: "Laptop",
  phone: "Phone",
  mouse: "Mouse",
  webcam: "Webcam",
  keyboard: "Keyboard",
  headset: "Headset",
  monitor: "Monitor",
  microphone: "Microphone",
  earbuds: "Earbuds",
  other: "Other"
};

const ISSUE_TYPE_LABELS: Record<WorkToolIssueType, string> = {
  faulty: "Faulty",
  stolen: "Stolen",
  not_in_possession: "Not in possession",
  spec_mismatch: "Specs incorrect"
};

const REQUEST_STATUS_LABELS: Record<WorkToolRequestStatus, string> = {
  open: "Open",
  in_review: "In review",
  approved: "Approved",
  fulfilled: "Fulfilled",
  resolved: "Resolved",
  declined: "Declined"
};

function toneForRequestStatus(status: WorkToolRequestStatus) {
  switch (status) {
    case "open":
      return "warning" as const;
    case "in_review":
      return "processing" as const;
    case "approved":
      return "info" as const;
    case "fulfilled":
    case "resolved":
      return "success" as const;
    case "declined":
    default:
      return "draft" as const;
  }
}

function toneForTool(tool: WorkToolRecord) {
  switch (tool.status) {
    case "assigned":
      return "success" as const;
    case "maintenance":
      return "warning" as const;
    case "stolen":
    case "lost":
      return "error" as const;
    case "available":
      return "info" as const;
    case "returned":
    case "retired":
    default:
      return "draft" as const;
  }
}

function describeRequest(request: WorkToolRequestRecord): string {
  if (request.requestKind === "tool_request") {
    return request.requestedItemType
      ? `Requested ${TOOL_TYPE_LABELS[request.requestedItemType]}`
      : "Tool request";
  }

  return request.issueType ? ISSUE_TYPE_LABELS[request.issueType] : "Issue report";
}

export function ProfileWorkToolsCard({
  employeeId,
  employeeName,
  isSelf,
  canManageWorkTools
}: ProfileWorkToolsCardProps) {
  const [data, setData] = useState<PersonWorkToolsResponseData | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [isToolPanelOpen, setIsToolPanelOpen] = useState(false);
  const [editingTool, setEditingTool] = useState<WorkToolRecord | null>(null);
  const [toolValues, setToolValues] = useState<WorkToolFormValues>({
    ...INITIAL_TOOL_VALUES,
    employeeId
  });
  const [toolError, setToolError] = useState<string | null>(null);
  const [isSavingTool, setIsSavingTool] = useState(false);

  const [isRequestPanelOpen, setIsRequestPanelOpen] = useState(false);
  const [requestValues, setRequestValues] = useState<ToolRequestFormValues>(INITIAL_REQUEST_VALUES);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [isSubmittingRequest, setIsSubmittingRequest] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setErrorMessage(null);

    try {
      const response = await fetch(`/api/v1/people/${employeeId}/work-tools`);
      const payload = (await response.json()) as { data: PersonWorkToolsResponseData | null; error?: { message?: string } | null };

      if (!response.ok || !payload.data) {
        setData(null);
        setErrorMessage(payload.error?.message ?? "Unable to load work tools.");
        return;
      }

      setData(payload.data);
    } catch (error) {
      setData(null);
      setErrorMessage(error instanceof Error ? error.message : "Unable to load work tools.");
    } finally {
      setLoading(false);
    }
  }, [employeeId]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const tools = data?.tools ?? [];
  const requests = data?.requests ?? [];

  const requestableTools = useMemo(
    () => tools.filter((tool) => tool.status === "assigned" || tool.status === "maintenance"),
    [tools]
  );

  const openCreateTool = () => {
    setEditingTool(null);
    setToolError(null);
    setToolValues({
      ...INITIAL_TOOL_VALUES,
      employeeId
    });
    setIsToolPanelOpen(true);
  };

  const openEditTool = (tool: WorkToolRecord) => {
    setEditingTool(tool);
    setToolError(null);
    setToolValues({
      employeeId,
      itemType: tool.itemType,
      itemName: tool.itemName,
      serialNumber: tool.serialNumber ?? "",
      transactionCurrency: tool.transactionCurrency ?? "",
      costAmount: tool.costAmount === null ? "" : String(tool.costAmount),
      status: tool.status,
      assignedAt: tool.assignedAt ? tool.assignedAt.slice(0, 10) : "",
      notes: tool.notes ?? ""
    });
    setIsToolPanelOpen(true);
  };

  const closeToolPanel = () => {
    if (isSavingTool) {
      return;
    }

    setIsToolPanelOpen(false);
    setEditingTool(null);
    setToolError(null);
  };

  const handleSaveTool = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSavingTool(true);
    setToolError(null);

    try {
      const response = await fetch(
        editingTool ? `/api/v1/work-tools/${editingTool.id}` : "/api/v1/work-tools",
        {
          method: editingTool ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            employeeId,
            itemType: toolValues.itemType,
            itemName: toolValues.itemName,
            serialNumber: toolValues.serialNumber || null,
            transactionCurrency: toolValues.transactionCurrency || null,
            costAmount: toolValues.costAmount || null,
            status: toolValues.status,
            assignedAt: toolValues.assignedAt || null,
            notes: toolValues.notes || null
          })
        }
      );

      const payload = await response.json();

      if (!response.ok || !payload.data?.tool) {
        setToolError(payload.error?.message ?? "Unable to save this work tool.");
        return;
      }

      await fetchData();
      closeToolPanel();
    } catch (error) {
      setToolError(error instanceof Error ? error.message : "Unable to save this work tool.");
    } finally {
      setIsSavingTool(false);
    }
  };

  const openRequestPanel = (requestKind: WorkToolRequestKind) => {
    setRequestError(null);
    setRequestValues({
      ...INITIAL_REQUEST_VALUES,
      requestKind,
      toolId: requestableTools[0]?.id ?? ""
    });
    setIsRequestPanelOpen(true);
  };

  const closeRequestPanel = () => {
    if (isSubmittingRequest) {
      return;
    }

    setIsRequestPanelOpen(false);
    setRequestError(null);
  };

  const handleSubmitRequest = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmittingRequest(true);
    setRequestError(null);

    try {
      const response = await fetch("/api/v1/work-tools/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestKind: requestValues.requestKind,
          requestedItemType:
            requestValues.requestKind === "tool_request"
              ? requestValues.requestedItemType
              : null,
          toolId:
            requestValues.requestKind === "issue_report"
              ? requestValues.toolId || null
              : null,
          issueType:
            requestValues.requestKind === "issue_report"
              ? requestValues.issueType
              : null,
          details: requestValues.details
        })
      });

      const payload = await response.json();

      if (!response.ok || !payload.data?.request) {
        setRequestError(payload.error?.message ?? "Unable to submit this request.");
        return;
      }

      await fetchData();
      closeRequestPanel();
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : "Unable to submit this request.");
    } finally {
      setIsSubmittingRequest(false);
    }
  };

  return (
    <div className="profile-overview-card">
      <div className="work-tools-toolbar">
        <div>
          <h3 className="profile-overview-card-title">Work tools</h3>
          <p className="settings-card-description">
            {isSelf
              ? "See the company tools recorded against your profile and let HR know if anything needs attention."
              : "Track the tools assigned to this employee and keep the record ready for offboarding."}
          </p>
        </div>
        <div className="work-tools-inline-actions">
          {canManageWorkTools ? (
            <>
              <button type="button" className="button button-secondary" onClick={openCreateTool}>
                Add tool
              </button>
              <Link
                href={`/people?tab=work-tools&employeeId=${employeeId}`}
                className="button"
              >
                Open Work Tools tab
              </Link>
            </>
          ) : null}
          {isSelf ? (
            <>
              <button type="button" className="button button-secondary" onClick={() => openRequestPanel("tool_request")}>
                Request tool
              </button>
              <button type="button" className="button" onClick={() => openRequestPanel("issue_report")}>
                Report issue
              </button>
            </>
          ) : null}
        </div>
      </div>

      {loading ? <p className="profile-overview-empty">Loading work tools…</p> : null}
      {errorMessage ? <div className="form-error-banner">{errorMessage}</div> : null}

      {!loading && !errorMessage ? (
        <>
          <div className="work-tools-card-grid">
            <div>
              <p className="settings-card-description">Currently assigned</p>
              <p className="work-tools-summary-value">{tools.length}</p>
            </div>
            <div>
              <p className="settings-card-description">Outstanding for offboarding</p>
              <p className="work-tools-summary-value">{data?.outstandingAssignedCount ?? 0}</p>
            </div>
            <div>
              <p className="settings-card-description">Open requests or issues</p>
              <p className="work-tools-summary-value">
                {requests.filter((request) => request.status === "open" || request.status === "in_review" || request.status === "approved").length}
              </p>
            </div>
          </div>

          {tools.length > 0 ? (
            <ul className="work-tools-list">
              {tools.map((tool) => (
                <li key={tool.id} className="work-tools-list-item">
                  <div>
                    <p className="work-tools-list-title">{tool.itemName}</p>
                    <p className="work-tools-list-meta">
                      {TOOL_TYPE_LABELS[tool.itemType]}
                      {tool.serialNumber ? ` • ${tool.serialNumber}` : ""}
                      {tool.assignedAt ? ` • Assigned ${formatDateLib(tool.assignedAt)}` : ""}
                    </p>
                  </div>
                  <div className="work-tools-list-actions">
                    <StatusBadge tone={toneForTool(tool)}>
                      {tool.status.replace(/_/g, " ")}
                    </StatusBadge>
                    {canManageWorkTools ? (
                      <button type="button" className="table-row-action" onClick={() => openEditTool(tool)}>
                        Edit
                      </button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="profile-overview-empty">
              {isSelf
                ? "No company tools have been assigned to you yet."
                : `${employeeName} does not have any work tools on file yet.`}
            </p>
          )}

          {requests.length > 0 ? (
            <div style={{ marginTop: "var(--space-5)" }}>
              <p className="settings-card-description" style={{ marginBottom: "var(--space-3)" }}>
                <strong>Requests and issues</strong>
              </p>
              <ul className="work-tools-list">
                {requests.map((request) => (
                  <li key={request.id} className="work-tools-list-item">
                    <div>
                      <p className="work-tools-list-title">{describeRequest(request)}</p>
                      <p className="work-tools-list-meta">
                        {request.toolLabel ?? "General request"} • {formatRelativeTime(request.createdAt)}
                      </p>
                      <p className="work-tools-list-note">{request.details}</p>
                      {request.hrNotes ? (
                        <p className="work-tools-list-note">
                          <strong>HR note:</strong> {request.hrNotes}
                        </p>
                      ) : null}
                    </div>
                    <StatusBadge tone={toneForRequestStatus(request.status)}>
                      {REQUEST_STATUS_LABELS[request.status]}
                    </StatusBadge>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      ) : null}

      {canManageWorkTools ? (
        <WorkToolEditorPanel
          isOpen={isToolPanelOpen}
          title={editingTool ? "Edit work tool" : `Add work tool for ${employeeName}`}
          description="Keep the employee tool record accurate for support, offboarding, and audits."
          onClose={closeToolPanel}
          onSubmit={handleSaveTool}
          values={toolValues}
          onValuesChange={setToolValues}
          employeeOptions={[]}
          fixedEmployeeId={employeeId}
          fixedEmployeeLabel={employeeName}
          isSaving={isSavingTool}
          errorMessage={toolError}
        />
      ) : null}

      {isSelf ? (
        <SlidePanel
          isOpen={isRequestPanelOpen}
          title={
            requestValues.requestKind === "tool_request"
              ? "Request a work tool"
              : "Report a work tool issue"
          }
          description="HR Admin will review this and follow up with you."
          onClose={closeRequestPanel}
        >
          <form className="slide-panel-form-wrapper" onSubmit={handleSubmitRequest} noValidate>
            {requestError ? <div className="form-error-banner">{requestError}</div> : null}

            <div className="form-field">
              <span className="form-label">What do you need help with?</span>
              <Select
                value={requestValues.requestKind}
                onValueChange={(value) =>
                  setRequestValues((current) => ({
                    ...current,
                    requestKind: value as WorkToolRequestKind
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="tool_request">Request a new tool</SelectItem>
                  <SelectItem value="issue_report">Report an assigned tool issue</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {requestValues.requestKind === "tool_request" ? (
              <div className="form-field">
                <span className="form-label">Requested tool</span>
                <Select
                  value={requestValues.requestedItemType}
                  onValueChange={(value) =>
                    setRequestValues((current) => ({
                      ...current,
                      requestedItemType: value as WorkToolType
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {WORK_TOOL_TYPES.map((toolType) => (
                      <SelectItem key={toolType} value={toolType}>
                        {TOOL_TYPE_LABELS[toolType]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <>
                <div className="form-field">
                  <span className="form-label">Affected tool</span>
                  <Select
                    value={requestValues.toolId || "__none__"}
                    onValueChange={(value) =>
                      setRequestValues((current) => ({
                        ...current,
                        toolId: value === "__none__" ? "" : value
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select a tool" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Select a tool</SelectItem>
                      {requestableTools.map((tool) => (
                        <SelectItem key={tool.id} value={tool.id}>
                          {tool.itemName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="form-field">
                  <span className="form-label">Issue</span>
                  <Select
                    value={requestValues.issueType}
                    onValueChange={(value) =>
                      setRequestValues((current) => ({
                        ...current,
                        issueType: value as WorkToolIssueType
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {WORK_TOOL_ISSUE_TYPES.map((issueType) => (
                        <SelectItem key={issueType} value={issueType}>
                          {ISSUE_TYPE_LABELS[issueType]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}

            <label className="form-field" htmlFor="profile-work-tool-request-details">
              <span className="form-label">Details</span>
              <textarea
                id="profile-work-tool-request-details"
                className="form-input"
                rows={5}
                maxLength={2000}
                placeholder={
                  requestValues.requestKind === "tool_request"
                    ? "Explain why you need this tool and what work it will support"
                    : "Describe what is wrong, what happened, or why this record needs correction"
                }
                value={requestValues.details}
                onChange={(event) =>
                  setRequestValues((current) => ({
                    ...current,
                    details: event.currentTarget.value
                  }))
                }
              />
            </label>

            <div className="slide-panel-actions">
              <button type="button" className="button button-ghost" onClick={closeRequestPanel}>
                Cancel
              </button>
              <button type="submit" className="button button-accent" disabled={isSubmittingRequest}>
                {isSubmittingRequest ? "Submitting..." : "Submit"}
              </button>
            </div>
          </form>
        </SlidePanel>
      ) : null}
    </div>
  );
}
