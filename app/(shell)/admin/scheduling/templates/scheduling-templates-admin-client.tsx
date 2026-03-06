"use client";

import { useMemo, useState } from "react";

import { EmptyState } from "../../../../../components/shared/empty-state";
import { PageHeader } from "../../../../../components/shared/page-header";
import { StatusBadge } from "../../../../../components/shared/status-badge";
import { useSchedulingTemplates } from "../../../../../hooks/use-scheduling";
import { formatDateTimeTooltip, formatRelativeTime } from "../../../../../lib/datetime";

type SortDirection = "asc" | "desc";

type TemplateFormState = {
  name: string;
  department: string;
  startTime: string;
  endTime: string;
  breakMinutes: string;
  color: string;
};

const defaultTemplateForm: TemplateFormState = {
  name: "",
  department: "",
  startTime: "",
  endTime: "",
  breakMinutes: "0",
  color: "rgb(74 0 57)"
};

function templatesSkeleton() {
  return (
    <div className="table-skeleton" aria-hidden="true">
      <div className="table-skeleton-header" />
      {Array.from({ length: 6 }, (_, index) => (
        <div key={`template-skeleton-${index}`} className="table-skeleton-row" />
      ))}
    </div>
  );
}

export function SchedulingTemplatesAdminClient({ embedded = false }: { embedded?: boolean }) {
  const templatesQuery = useSchedulingTemplates();
  const [templateForm, setTemplateForm] = useState<TemplateFormState>(defaultTemplateForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitMessage, setSubmitMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  const sortedTemplates = useMemo(() => {
    const rows = templatesQuery.data?.templates ?? [];

    return [...rows].sort((leftTemplate, rightTemplate) => {
      const comparison = leftTemplate.name.localeCompare(rightTemplate.name);
      return sortDirection === "asc" ? comparison : comparison * -1;
    });
  }, [sortDirection, templatesQuery.data?.templates]);

  async function handleCreateTemplate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setSubmitMessage(null);

    if (!templateForm.name.trim() || !templateForm.startTime || !templateForm.endTime) {
      setFormError("Name, start time, and end time are required.");
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch("/api/v1/scheduling/templates", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          name: templateForm.name,
          department: templateForm.department || undefined,
          startTime: templateForm.startTime,
          endTime: templateForm.endTime,
          breakMinutes: Number.parseInt(templateForm.breakMinutes || "0", 10),
          color: templateForm.color || undefined
        })
      });
      const payload = (await response.json()) as {
        data: unknown;
        error: { message?: string } | null;
      };

      if (!response.ok) {
        setFormError(payload.error?.message ?? "Unable to create template.");
        return;
      }

      setTemplateForm(defaultTemplateForm);
      setSubmitMessage("Shift template created.");
      templatesQuery.refresh();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Unable to create template.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <>
      {!embedded ? (
        <PageHeader
          title="Templates"
          description="Manage reusable shift templates for weekly schedule planning."
        />
      ) : null}

      {templatesQuery.isLoading ? templatesSkeleton() : null}

      {!templatesQuery.isLoading && templatesQuery.errorMessage ? (
        <section className="error-state">
          <EmptyState
            title="Template data is unavailable"
            description={templatesQuery.errorMessage}
          />
          <button
            type="button"
            className="button button-accent"
            onClick={() => templatesQuery.refresh()}
          >
            Retry
          </button>
        </section>
      ) : null}

      {!templatesQuery.isLoading && !templatesQuery.errorMessage ? (
        <section className="compensation-layout" aria-label="Shift template management">
          <article className="settings-card">
            <header className="announcement-item-header">
              <div>
                <h2 className="section-title">Create template</h2>
                <p className="settings-card-description">
                  Templates reduce repetitive shift setup across teams.
                </p>
              </div>
            </header>
            <form className="settings-form-grid" onSubmit={handleCreateTemplate}>
              <label className="settings-field">
                <span className="settings-field-label">Template name</span>
                <input
                  className="settings-input"
                  value={templateForm.name}
                  onChange={(event) =>
                    setTemplateForm((currentValue) => ({ ...currentValue, name: event.target.value }))
                  }
                  placeholder="Operations Early Shift"
                />
              </label>
              <label className="settings-field">
                <span className="settings-field-label">Department</span>
                <input
                  className="settings-input"
                  value={templateForm.department}
                  onChange={(event) =>
                    setTemplateForm((currentValue) => ({ ...currentValue, department: event.target.value }))
                  }
                  placeholder="Operations"
                />
              </label>
              <label className="settings-field">
                <span className="settings-field-label">Start time</span>
                <input
                  type="time"
                  className="settings-input"
                  value={templateForm.startTime}
                  onChange={(event) =>
                    setTemplateForm((currentValue) => ({ ...currentValue, startTime: event.target.value }))
                  }
                />
              </label>
              <label className="settings-field">
                <span className="settings-field-label">End time</span>
                <input
                  type="time"
                  className="settings-input"
                  value={templateForm.endTime}
                  onChange={(event) =>
                    setTemplateForm((currentValue) => ({ ...currentValue, endTime: event.target.value }))
                  }
                />
              </label>
              <label className="settings-field">
                <span className="settings-field-label">Break (minutes)</span>
                <input
                  type="number"
                  min={0}
                  max={240}
                  className="settings-input numeric"
                  value={templateForm.breakMinutes}
                  onChange={(event) =>
                    setTemplateForm((currentValue) => ({ ...currentValue, breakMinutes: event.target.value }))
                  }
                />
              </label>
              <label className="settings-field">
                <span className="settings-field-label">Color</span>
                <input
                  className="settings-input"
                  value={templateForm.color}
                  onChange={(event) =>
                    setTemplateForm((currentValue) => ({ ...currentValue, color: event.target.value }))
                  }
                />
              </label>
              {formError ? <p className="form-field-error">{formError}</p> : null}
              <div className="settings-actions">
                <button type="submit" className="button button-accent" disabled={isSubmitting}>
                  {isSubmitting ? "Creating..." : "Create template"}
                </button>
              </div>
            </form>
            {submitMessage ? <p className="settings-card-description">{submitMessage}</p> : null}
          </article>

          {sortedTemplates.length === 0 ? (
            <EmptyState
              title="No shift templates yet"
              description="Create a template to speed up schedule creation."
              ctaLabel="Create template"
              ctaHref="/admin/scheduling/templates"
            />
          ) : (
            <div className="data-table-container">
              <table className="data-table" aria-label="Shift templates table">
                <thead>
                  <tr>
                    <th>
                      <button
                        type="button"
                        className="table-sort-trigger"
                        onClick={() =>
                          setSortDirection((currentDirection) =>
                            currentDirection === "asc" ? "desc" : "asc"
                          )
                        }
                      >
                        Template
                        <span className="numeric">{sortDirection === "asc" ? "↑" : "↓"}</span>
                      </button>
                    </th>
                    <th>Department</th>
                    <th>Hours</th>
                    <th>Break</th>
                    <th>Status</th>
                    <th>Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedTemplates.map((template) => (
                    <tr key={template.id} className="data-table-row">
                      <td>{template.name}</td>
                      <td>{template.department ?? "All departments"}</td>
                      <td className="numeric">
                        {template.startTime} - {template.endTime}
                      </td>
                      <td className="numeric">{template.breakMinutes}m</td>
                      <td>
                        <StatusBadge tone="success">Active</StatusBadge>
                      </td>
                      <td>
                        <span title={formatDateTimeTooltip(template.updatedAt)}>
                          {formatRelativeTime(template.updatedAt)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}
    </>
  );
}
