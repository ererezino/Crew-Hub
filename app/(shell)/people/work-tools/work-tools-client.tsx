/* eslint-disable i18next/no-literal-string */
"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";

import { EmptyState } from "../../../../components/shared/empty-state";
import { ErrorState } from "../../../../components/shared/error-state";
import { SlidePanel } from "../../../../components/shared/slide-panel";
import { StatusBadge } from "../../../../components/shared/status-badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../../components/ui/select";
import { usePeople } from "../../../../hooks/use-people";
import { formatDate as formatDateLib, formatRelativeTime } from "../../../../lib/datetime";
import type { WorkToolRequestStatus, WorkToolIssueType, WorkToolRecord, WorkToolRequestRecord, WorkToolsAdminResponseData, WorkToolStatus, WorkToolType } from "../../../../types/work-tools";
import { WORK_TOOL_REQUEST_STATUSES, WORK_TOOL_STATUSES, WORK_TOOL_TYPES } from "../../../../types/work-tools";
import { WorkToolEditorPanel, type WorkToolFormValues } from "../../../../components/people/work-tool-editor-panel";

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

type RequestReviewValues = {
  status: WorkToolRequestStatus;
  hrNotes: string;
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

const TOOL_STATUS_LABELS: Record<WorkToolStatus, string> = {
  assigned: "Assigned",
  maintenance: "Maintenance",
  available: "Available",
  returned: "Returned",
  retired: "Retired",
  lost: "Lost",
  stolen: "Stolen"
};

const REQUEST_STATUS_LABELS: Record<WorkToolRequestStatus, string> = {
  open: "Open",
  in_review: "In review",
  approved: "Approved",
  fulfilled: "Fulfilled",
  resolved: "Resolved",
  declined: "Declined"
};

const ISSUE_TYPE_LABELS: Record<WorkToolIssueType, string> = {
  faulty: "Faulty",
  stolen: "Stolen",
  not_in_possession: "Not in possession",
  spec_mismatch: "Specs incorrect"
};

function toneForToolStatus(status: WorkToolStatus) {
  switch (status) {
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

function formatMoney(amount: number | null, currency: string | null): string {
  if (amount === null || !currency) {
    return "—";
  }

  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 2
    }).format(amount);
  } catch {
    return `${currency} ${amount.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  }
}

function describeRequest(request: WorkToolRequestRecord): string {
  if (request.requestKind === "tool_request") {
    return request.requestedItemType ? `Request: ${TOOL_TYPE_LABELS[request.requestedItemType]}` : "Tool request";
  }

  if (request.issueType) {
    return ISSUE_TYPE_LABELS[request.issueType];
  }

  return "Issue report";
}

function describeToolMeta(tool: WorkToolRecord): string {
  const parts = [
    tool.serialNumber ? `Serial ${tool.serialNumber}` : "No serial number yet",
    formatMoney(tool.costAmount, tool.transactionCurrency),
    tool.assignedAt ? `Assigned ${formatDateLib(tool.assignedAt)}` : null
  ].filter((value): value is string => Boolean(value));

  return parts.join(" · ");
}

type GroupedWorkToolsRow = {
  key: string;
  employeeId: string | null;
  employeeName: string;
  tools: WorkToolRecord[];
};

export function WorkToolsClient() {
  const searchParams = useSearchParams();
  const presetEmployeeId = searchParams.get("employeeId") ?? "";

  const [data, setData] = useState<WorkToolsAdminResponseData | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [searchValue, setSearchValue] = useState("");
  const [employeeFilter, setEmployeeFilter] = useState(presetEmployeeId);
  const [statusFilter, setStatusFilter] = useState<WorkToolStatus | "all">("all");
  const [typeFilter, setTypeFilter] = useState<WorkToolType | "all">("all");

  const [isToolPanelOpen, setIsToolPanelOpen] = useState(false);
  const [editingTool, setEditingTool] = useState<WorkToolRecord | null>(null);
  const [toolValues, setToolValues] = useState<WorkToolFormValues>({
    ...INITIAL_TOOL_VALUES,
    employeeId: presetEmployeeId
  });
  const [toolError, setToolError] = useState<string | null>(null);
  const [isSavingTool, setIsSavingTool] = useState(false);

  const [selectedRequest, setSelectedRequest] = useState<WorkToolRequestRecord | null>(null);
  const [requestReviewValues, setRequestReviewValues] = useState<RequestReviewValues>({
    status: "open",
    hrNotes: ""
  });
  const [requestError, setRequestError] = useState<string | null>(null);
  const [isSavingRequest, setIsSavingRequest] = useState(false);

  const { people } = usePeople({ scope: "all" });

  const employeeOptions = useMemo(
    () =>
      people
        .filter((person) => person.status !== "inactive")
        .map((person) => ({
          id: person.id,
          name: person.fullName
        }))
        .sort((left, right) => left.name.localeCompare(right.name)),
    [people]
  );

  const fetchData = useCallback(async () => {
    setLoading(true);
    setErrorMessage(null);

    try {
      const response = await fetch("/api/v1/work-tools");
      const payload = (await response.json()) as { data: WorkToolsAdminResponseData | null; error?: { message?: string } | null };

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
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const filteredTools = useMemo(() => {
    const query = searchValue.trim().toLowerCase();

    return (data?.tools ?? []).filter((tool) => {
      if (employeeFilter && tool.employeeId !== employeeFilter) {
        return false;
      }

      if (statusFilter !== "all" && tool.status !== statusFilter) {
        return false;
      }

      if (typeFilter !== "all" && tool.itemType !== typeFilter) {
        return false;
      }

      if (!query) {
        return true;
      }

      const haystack = [
        tool.employeeName ?? "",
        tool.itemName,
        tool.serialNumber ?? "",
        tool.itemType
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(query);
    });
  }, [data?.tools, employeeFilter, searchValue, statusFilter, typeFilter]);

  const filteredRequests = useMemo(() => {
    if (!employeeFilter) {
      return data?.requests ?? [];
    }

    return (data?.requests ?? []).filter((request) => request.employeeId === employeeFilter);
  }, [data?.requests, employeeFilter]);

  const groupedTools = useMemo(() => {
    const groups = new Map<string, GroupedWorkToolsRow>();

    for (const tool of filteredTools) {
      const key = tool.employeeId ?? "__unassigned__";
      const existingGroup = groups.get(key);

      if (existingGroup) {
        existingGroup.tools.push(tool);
        continue;
      }

      groups.set(key, {
        key,
        employeeId: tool.employeeId,
        employeeName: tool.employeeName ?? "Unassigned inventory",
        tools: [tool]
      });
    }

    return Array.from(groups.values())
      .map((group) => ({
        ...group,
        tools: [...group.tools].sort((left, right) => {
          const typeComparison = TOOL_TYPE_LABELS[left.itemType].localeCompare(TOOL_TYPE_LABELS[right.itemType]);
          if (typeComparison !== 0) {
            return typeComparison;
          }

          const nameComparison = left.itemName.localeCompare(right.itemName);
          if (nameComparison !== 0) {
            return nameComparison;
          }

          return (left.assignedAt ?? "").localeCompare(right.assignedAt ?? "");
        })
      }))
      .sort((left, right) => {
        if (left.employeeId === null && right.employeeId !== null) {
          return 1;
        }

        if (left.employeeId !== null && right.employeeId === null) {
          return -1;
        }

        return left.employeeName.localeCompare(right.employeeName);
      });
  }, [filteredTools]);

  const openCreatePanel = () => {
    setEditingTool(null);
    setToolError(null);
    setToolValues({
      ...INITIAL_TOOL_VALUES,
      employeeId: employeeFilter
    });
    setIsToolPanelOpen(true);
  };

  const openEditPanel = (tool: WorkToolRecord) => {
    setEditingTool(tool);
    setToolError(null);
    setToolValues({
      employeeId: tool.employeeId ?? "",
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
            employeeId: toolValues.employeeId || null,
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

  const openRequestReview = (request: WorkToolRequestRecord) => {
    setSelectedRequest(request);
    setRequestError(null);
    setRequestReviewValues({
      status: request.status,
      hrNotes: request.hrNotes ?? ""
    });
  };

  const closeRequestReview = () => {
    if (isSavingRequest) {
      return;
    }

    setSelectedRequest(null);
    setRequestError(null);
  };

  const handleSaveRequestReview = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedRequest) {
      return;
    }

    setIsSavingRequest(true);
    setRequestError(null);

    try {
      const response = await fetch(`/api/v1/work-tools/requests/${selectedRequest.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: requestReviewValues.status,
          hrNotes: requestReviewValues.hrNotes || null
        })
      });

      const payload = await response.json();

      if (!response.ok || !payload.data?.request) {
        setRequestError(payload.error?.message ?? "Unable to update this request.");
        return;
      }

      await fetchData();
      closeRequestReview();
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : "Unable to update this request.");
    } finally {
      setIsSavingRequest(false);
    }
  };

  if (loading) {
    return (
      <section className="work-tools-page">
        <div className="table-skeleton">
          <div className="table-skeleton-header" />
          <div className="table-skeleton-row" />
          <div className="table-skeleton-row" />
          <div className="table-skeleton-row" />
        </div>
      </section>
    );
  }

  if (errorMessage) {
    return (
      <section className="work-tools-page">
        <ErrorState title="Unable to load work tools" message={errorMessage} />
      </section>
    );
  }

  if (!data) {
    return (
      <section className="work-tools-page">
        <EmptyState
          title="No work tools yet"
          description="Assigned tools and employee reports will appear here once HR starts tracking them."
        />
      </section>
    );
  }

  return (
    <section className="work-tools-page">
      <div className="work-tools-summary-grid">
        <div className="profile-overview-card">
          <p className="settings-card-description">Currently assigned</p>
          <p className="work-tools-summary-value">{data.summary.assignedCount}</p>
          <p className="work-tools-summary-copy">Tools still in employee possession</p>
        </div>
        <div className="profile-overview-card">
          <p className="settings-card-description">Employees holding tools</p>
          <p className="work-tools-summary-value">{data.summary.employeeCount}</p>
          <p className="work-tools-summary-copy">Active holders across the company</p>
        </div>
        <div className="profile-overview-card">
          <p className="settings-card-description">Offboarding follow-up</p>
          <p className="work-tools-summary-value">{data.summary.outstandingOffboardingCount}</p>
          <p className="work-tools-summary-copy">Offboarding employees still holding tools</p>
        </div>
        <div className="profile-overview-card">
          <p className="settings-card-description">Open requests</p>
          <p className="work-tools-summary-value">{data.summary.openRequestCount}</p>
          <p className="work-tools-summary-copy">Tool requests or issues waiting on HR</p>
        </div>
      </div>

      <div className="profile-overview-card">
        <div className="work-tools-toolbar">
          <div>
            <h3 className="profile-overview-card-title">Assigned tools</h3>
          </div>
          <button type="button" className="button button-accent" onClick={openCreatePanel}>
            Add work tool
          </button>
        </div>

        <div className="work-tools-filters">
          <input
            className="form-input"
            placeholder="Search employee, model, serial, or type"
            value={searchValue}
            onChange={(event) => setSearchValue(event.currentTarget.value)}
          />
          <Select value={employeeFilter || "__all__"} onValueChange={(value) => setEmployeeFilter(value === "__all__" ? "" : value)}>
            <SelectTrigger>
              <SelectValue placeholder="All employees" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All employees</SelectItem>
              {employeeOptions.map((person) => (
                <SelectItem key={person.id} value={person.id}>
                  {person.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={typeFilter} onValueChange={(value) => setTypeFilter(value as WorkToolType | "all")}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {WORK_TOOL_TYPES.map((type) => (
                <SelectItem key={type} value={type}>
                  {TOOL_TYPE_LABELS[type]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as WorkToolStatus | "all")}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {WORK_TOOL_STATUSES.map((status) => (
                <SelectItem key={status} value={status}>
                  {TOOL_STATUS_LABELS[status]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="data-table-container">
          <table className="data-table" aria-label="Assigned work tools by employee">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Devices in possession</th>
              </tr>
            </thead>
            <tbody>
              {groupedTools.map((group) => (
                <tr key={group.key} className="data-table-row work-tools-group-row">
                  <td>
                    <div className="work-tools-group-person">
                      <p className="work-tools-group-person-name">{group.employeeName}</p>
                      <p className="work-tools-group-person-meta">
                        {group.tools.length} {group.tools.length === 1 ? "device" : "devices"}
                        {group.employeeId === null ? " currently unassigned" : " on record"}
                      </p>
                    </div>
                  </td>
                  <td>
                    <ul className="work-tools-list work-tools-employee-tools">
                      {group.tools.map((tool) => (
                        <li key={tool.id} className="work-tools-list-item">
                          <div className="work-tools-group-tool-copy">
                            <div className="work-tools-group-tool-header">
                              <p className="work-tools-list-title">{tool.itemName}</p>
                              <div className="work-tools-inline-actions">
                                <span className="work-tools-type-pill">{TOOL_TYPE_LABELS[tool.itemType]}</span>
                                <StatusBadge tone={toneForToolStatus(tool.status)}>
                                  {TOOL_STATUS_LABELS[tool.status]}
                                </StatusBadge>
                              </div>
                            </div>
                            <p className="work-tools-list-meta">
                              {describeToolMeta(tool)}
                            </p>
                            {tool.notes ? <p className="work-tools-list-note">{tool.notes}</p> : null}
                          </div>
                          <div className="work-tools-list-actions">
                            <button type="button" className="table-row-action" onClick={() => openEditPanel(tool)}>
                              Edit
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </td>
                </tr>
              ))}
              {groupedTools.length === 0 ? (
                <tr className="data-table-row">
                  <td colSpan={2}>
                    <div className="table-empty-state">
                      No work tools match the current filters.
                    </div>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <div className="profile-overview-card">
        <div className="work-tools-toolbar">
          <div>
            <h3 className="profile-overview-card-title">Requests and issues</h3>
            <p className="settings-card-description">
              Review employee requests for new tools and reports about faulty, stolen, or incorrect assignments.
            </p>
          </div>
        </div>

        <div className="data-table-container">
          <table className="data-table" aria-label="Work tool requests and issues">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Type</th>
                <th>Tool</th>
                <th>Status</th>
                <th>Submitted</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredRequests.map((request) => (
                <tr key={request.id} className="data-table-row">
                  <td>{request.employeeName ?? "Employee"}</td>
                  <td>{describeRequest(request)}</td>
                  <td>{request.toolLabel ?? (request.requestedItemType ? TOOL_TYPE_LABELS[request.requestedItemType] : "—")}</td>
                  <td>
                    <StatusBadge tone={toneForRequestStatus(request.status)}>
                      {REQUEST_STATUS_LABELS[request.status]}
                    </StatusBadge>
                  </td>
                  <td>{formatRelativeTime(request.createdAt)}</td>
                  <td>
                    <button type="button" className="table-row-action" onClick={() => openRequestReview(request)}>
                      Review
                    </button>
                  </td>
                </tr>
              ))}
              {filteredRequests.length === 0 ? (
                <tr className="data-table-row">
                  <td colSpan={6}>
                    <div className="table-empty-state">
                      No work tool requests match the current view.
                    </div>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <WorkToolEditorPanel
        isOpen={isToolPanelOpen}
        title={editingTool ? "Edit work tool" : "Add work tool"}
        description={
          editingTool
            ? "Update the assigned device details for this employee."
            : "Add a laptop, phone, or other work tool to the employee record."
        }
        onClose={closeToolPanel}
        onSubmit={handleSaveTool}
        values={toolValues}
        onValuesChange={setToolValues}
        employeeOptions={employeeOptions}
        isSaving={isSavingTool}
        errorMessage={toolError}
      />

      <SlidePanel
        isOpen={Boolean(selectedRequest)}
        title="Review work tool request"
        description="Update the HR status and leave internal handling notes."
        onClose={closeRequestReview}
      >
        {selectedRequest ? (
          <form className="slide-panel-form-wrapper" onSubmit={handleSaveRequestReview} noValidate>
            {requestError ? <div className="form-error-banner">{requestError}</div> : null}

            <div className="profile-overview-card" style={{ padding: "var(--space-4)" }}>
              <dl className="profile-overview-dl">
                <dt>Employee</dt>
                <dd>{selectedRequest.employeeName ?? "Employee"}</dd>
                <dt>Request</dt>
                <dd>{describeRequest(selectedRequest)}</dd>
                <dt>Tool</dt>
                <dd>{selectedRequest.toolLabel ?? "—"}</dd>
                <dt>Submitted</dt>
                <dd>{formatDateLib(selectedRequest.createdAt)}</dd>
              </dl>
              <p className="settings-card-description" style={{ marginTop: "var(--space-3)" }}>
                {selectedRequest.details}
              </p>
            </div>

            <div className="form-field">
              <span className="form-label">Status</span>
              <Select
                value={requestReviewValues.status}
                onValueChange={(value) =>
                  setRequestReviewValues((current) => ({
                    ...current,
                    status: value as WorkToolRequestStatus
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WORK_TOOL_REQUEST_STATUSES.map((status) => (
                    <SelectItem key={status} value={status}>
                      {REQUEST_STATUS_LABELS[status]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <label className="form-field" htmlFor="work-tool-request-notes">
              <span className="form-label">HR notes</span>
              <textarea
                id="work-tool-request-notes"
                className="form-input"
                rows={5}
                maxLength={2000}
                placeholder="Procurement updates, replacement plan, or review notes"
                value={requestReviewValues.hrNotes}
                onChange={(event) =>
                  setRequestReviewValues((current) => ({
                    ...current,
                    hrNotes: event.currentTarget.value
                  }))
                }
              />
            </label>

            <div className="slide-panel-actions">
              <button type="button" className="button button-ghost" onClick={closeRequestReview}>
                Cancel
              </button>
              <button type="submit" className="button button-accent" disabled={isSavingRequest}>
                {isSavingRequest ? "Saving..." : "Save review"}
              </button>
            </div>
          </form>
        ) : null}
      </SlidePanel>
    </section>
  );
}
