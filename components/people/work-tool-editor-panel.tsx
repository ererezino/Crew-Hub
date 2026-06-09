/* eslint-disable i18next/no-literal-string */
"use client";

import { SlidePanel } from "../shared/slide-panel";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { WORK_TOOL_STATUSES, WORK_TOOL_TYPES, type WorkToolStatus, type WorkToolType } from "../../types/work-tools";

export type WorkToolFormValues = {
  employeeId: string;
  itemType: WorkToolType;
  itemName: string;
  serialNumber: string;
  transactionCurrency: string;
  costAmount: string;
  status: WorkToolStatus;
  assignedAt: string;
  notes: string;
};

type EmployeeOption = {
  id: string;
  name: string;
};

type WorkToolEditorPanelProps = {
  isOpen: boolean;
  title: string;
  description: string;
  onClose: () => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  values: WorkToolFormValues;
  onValuesChange: (nextValues: WorkToolFormValues) => void;
  employeeOptions: EmployeeOption[];
  fixedEmployeeId?: string | null;
  fixedEmployeeLabel?: string | null;
  isSaving: boolean;
  errorMessage: string | null;
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

export function WorkToolEditorPanel({
  isOpen,
  title,
  description,
  onClose,
  onSubmit,
  values,
  onValuesChange,
  employeeOptions,
  fixedEmployeeId = null,
  fixedEmployeeLabel = null,
  isSaving,
  errorMessage
}: WorkToolEditorPanelProps) {
  const update = (patch: Partial<WorkToolFormValues>) => {
    onValuesChange({ ...values, ...patch });
  };

  const employeeValue = fixedEmployeeId ?? values.employeeId;

  return (
    <SlidePanel isOpen={isOpen} title={title} description={description} onClose={onClose}>
      <form className="slide-panel-form-wrapper" onSubmit={onSubmit} noValidate>
        {errorMessage ? <div className="form-error-banner">{errorMessage}</div> : null}

        {fixedEmployeeId ? (
          <div className="form-field">
            <span className="form-label">Assigned employee</span>
            <div className="form-input" aria-readonly="true">
              {fixedEmployeeLabel ?? "Current employee"}
            </div>
          </div>
        ) : (
          <div className="form-field">
            <span className="form-label">Assigned employee</span>
            <Select
              value={employeeValue || "__none__"}
              onValueChange={(value) => update({ employeeId: value === "__none__" ? "" : value })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select employee" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Unassigned inventory</SelectItem>
                {employeeOptions.map((person) => (
                  <SelectItem key={person.id} value={person.id}>
                    {person.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="form-field">
          <span className="form-label">Tool type</span>
          <Select
            value={values.itemType}
            onValueChange={(value) => update({ itemType: value as WorkToolType })}
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

        <label className="form-field" htmlFor="work-tool-item-name">
          <span className="form-label">Make and model</span>
          <input
            id="work-tool-item-name"
            className="form-input"
            maxLength={200}
            placeholder="MacBook Air 2020, M1 Chip, 13-inch"
            value={values.itemName}
            onChange={(event) => update({ itemName: event.currentTarget.value })}
          />
        </label>

        <label className="form-field" htmlFor="work-tool-serial-number">
          <span className="form-label">Serial number</span>
          <input
            id="work-tool-serial-number"
            className="form-input"
            maxLength={200}
            placeholder="FVFJ1CK7Q6L4"
            value={values.serialNumber}
            onChange={(event) => update({ serialNumber: event.currentTarget.value })}
          />
        </label>

        <div className="settings-emergency-fields">
          <label className="form-field" htmlFor="work-tool-currency">
            <span className="form-label-sm">Currency</span>
            <input
              id="work-tool-currency"
              className="form-input"
              maxLength={10}
              placeholder="USD"
              value={values.transactionCurrency}
              onChange={(event) => update({ transactionCurrency: event.currentTarget.value.toUpperCase() })}
            />
          </label>

          <label className="form-field" htmlFor="work-tool-cost">
            <span className="form-label-sm">Cost</span>
            <input
              id="work-tool-cost"
              className="form-input"
              inputMode="decimal"
              placeholder="1200.00"
              value={values.costAmount}
              onChange={(event) => update({ costAmount: event.currentTarget.value })}
            />
          </label>
        </div>

        <div className="form-field">
          <span className="form-label">Status</span>
          <Select
            value={values.status}
            onValueChange={(value) => update({ status: value as WorkToolStatus })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WORK_TOOL_STATUSES.map((status) => (
                <SelectItem key={status} value={status}>
                  {TOOL_STATUS_LABELS[status]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <label className="form-field" htmlFor="work-tool-assigned-at">
          <span className="form-label">Assigned date (optional)</span>
          <input
            id="work-tool-assigned-at"
            type="date"
            className="form-input"
            value={values.assignedAt}
            onChange={(event) => update({ assignedAt: event.currentTarget.value })}
          />
        </label>

        <label className="form-field" htmlFor="work-tool-notes">
          <span className="form-label">Internal notes</span>
          <textarea
            id="work-tool-notes"
            className="form-input"
            rows={4}
            maxLength={1000}
            placeholder="Condition notes, replacement context, or procurement details"
            value={values.notes}
            onChange={(event) => update({ notes: event.currentTarget.value })}
          />
        </label>

        <div className="slide-panel-actions">
          <button type="button" className="button button-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button button-accent" disabled={isSaving}>
            {isSaving ? "Saving..." : "Save work tool"}
          </button>
        </div>
      </form>
    </SlidePanel>
  );
}
