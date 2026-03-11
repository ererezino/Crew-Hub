"use client";

import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";

import { ConfirmDialog } from "../../../../../components/shared/confirm-dialog";
import { EmptyState } from "../../../../../components/shared/empty-state";
import { PageHeader } from "../../../../../components/shared/page-header";
import { StatusBadge } from "../../../../../components/shared/status-badge";
import { useSchedulingTemplates } from "../../../../../hooks/use-scheduling";
import { DEPARTMENTS } from "../../../../../lib/departments";
import { formatDateTimeTooltip, formatRelativeTime } from "../../../../../lib/datetime";

type AppLocale = "en" | "fr";
type SortDirection = "asc" | "desc";

type TemplateFormState = {
  name: string;
  department: string;
  startTime: string;
  endTime: string;
  breakMinutes: string;
  color: string;
};

const TEMPLATE_COLOR_KEYS = [
  { value: "#2563EB", labelKey: "colorBlue" },
  { value: "#7C3AED", labelKey: "colorPurple" },
  { value: "#DB2777", labelKey: "colorPink" },
  { value: "#DC2626", labelKey: "colorRed" },
  { value: "#EA580C", labelKey: "colorOrange" },
  { value: "#D97706", labelKey: "colorAmber" },
  { value: "#16A34A", labelKey: "colorGreen" },
  { value: "#0D9488", labelKey: "colorTeal" },
  { value: "#0891B2", labelKey: "colorCyan" },
  { value: "#4B5563", labelKey: "colorGray" },
] as const;

const defaultTemplateForm: TemplateFormState = {
  name: "",
  department: "Customer Success",
  startTime: "",
  endTime: "",
  breakMinutes: "0",
  color: "#2563EB"
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
  const t = useTranslations('schedulingTemplates');
  const tCommon = useTranslations('common');
  const locale = useLocale() as AppLocale;

  const templatesQuery = useSchedulingTemplates();
  const [templateForm, setTemplateForm] = useState<TemplateFormState>(defaultTemplateForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitMessage, setSubmitMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  // Edit/delete state
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [deleteConfirmTemplateId, setDeleteConfirmTemplateId] = useState<string | null>(null);
  const [isDeletingTemplate, setIsDeletingTemplate] = useState(false);

  const sortedTemplates = useMemo(() => {
    const rows = templatesQuery.data?.templates ?? [];

    return [...rows].sort((leftTemplate, rightTemplate) => {
      const comparison = leftTemplate.name.localeCompare(rightTemplate.name);
      return sortDirection === "asc" ? comparison : comparison * -1;
    });
  }, [sortDirection, templatesQuery.data?.templates]);

  function startEditingTemplate(template: {
    id: string;
    name: string;
    department: string | null;
    startTime: string;
    endTime: string;
    breakMinutes: number;
    color: string | null;
  }) {
    setEditingTemplateId(template.id);
    setTemplateForm({
      name: template.name,
      department: template.department ?? "",
      startTime: template.startTime,
      endTime: template.endTime,
      breakMinutes: String(template.breakMinutes),
      color: template.color ?? "#2563EB"
    });
    setFormError(null);
    setSubmitMessage(null);
  }

  function cancelEditing() {
    setEditingTemplateId(null);
    setTemplateForm(defaultTemplateForm);
    setFormError(null);
  }

  async function handleSubmitTemplate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setSubmitMessage(null);

    if (!templateForm.name.trim() || !templateForm.startTime || !templateForm.endTime) {
      setFormError(t('errorRequired'));
      return;
    }

    setIsSubmitting(true);

    const templatePayload = {
      name: templateForm.name,
      department: templateForm.department || undefined,
      startTime: templateForm.startTime,
      endTime: templateForm.endTime,
      breakMinutes: Number.parseInt(templateForm.breakMinutes || "0", 10),
      color: templateForm.color || undefined
    };

    try {
      const url = editingTemplateId
        ? `/api/v1/scheduling/templates/${editingTemplateId}`
        : "/api/v1/scheduling/templates";
      const method = editingTemplateId ? "PUT" : "POST";

      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(templatePayload)
      });
      const payload = (await response.json()) as {
        data: unknown;
        error: { message?: string } | null;
      };

      if (!response.ok) {
        setFormError(
          payload.error?.message ?? (editingTemplateId ? t('errorUpdateFailed') : t('errorCreateFailed'))
        );
        return;
      }

      setTemplateForm(defaultTemplateForm);
      setEditingTemplateId(null);
      setSubmitMessage(editingTemplateId ? t('templateUpdated') : t('templateCreated'));
      templatesQuery.refresh();
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : (editingTemplateId ? t('errorUpdateFailed') : t('errorCreateFailed'))
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDeleteTemplate(templateId: string) {
    setIsDeletingTemplate(true);

    try {
      const response = await fetch(`/api/v1/scheduling/templates/${templateId}`, {
        method: "DELETE"
      });
      const payload = (await response.json()) as {
        data: unknown;
        error: { message?: string } | null;
      };

      if (!response.ok) {
        setSubmitMessage(payload.error?.message ?? t('errorDeleteFailed'));
        return;
      }

      setSubmitMessage(t('templateDeleted'));
      templatesQuery.refresh();
    } catch (error) {
      setSubmitMessage(error instanceof Error ? error.message : t('errorDeleteFailed'));
    } finally {
      setIsDeletingTemplate(false);
      setDeleteConfirmTemplateId(null);
    }
  }

  return (
    <>
      {!embedded ? (
        <PageHeader
          title={t('title')}
          description={t('description')}
        />
      ) : null}

      {templatesQuery.isLoading ? templatesSkeleton() : null}

      {!templatesQuery.isLoading && templatesQuery.errorMessage ? (
        <>
          <EmptyState
            title={t('unavailable')}
            description={templatesQuery.errorMessage}
          />
          <button
            type="button"
            className="button"
            onClick={() => templatesQuery.refresh()}
          >
            {tCommon('retry')}
          </button>
        </>
      ) : null}

      {!templatesQuery.isLoading && !templatesQuery.errorMessage ? (
        <section className="compensation-layout" aria-label={t('sectionAriaLabel')}>
          <article className="settings-card">
            <header className="announcement-item-header">
              <div>
                <h2 className="section-title">
                  {editingTemplateId ? t('editTitle') : t('createTitle')}
                </h2>
                <p className="settings-card-description">
                  {editingTemplateId
                    ? t('editDescription')
                    : t('createDescription')}
                </p>
              </div>
              {editingTemplateId ? (
                <button type="button" className="button button-ghost" onClick={cancelEditing}>
                  {t('cancelEdit')}
                </button>
              ) : null}
            </header>
            <form className="settings-form" onSubmit={handleSubmitTemplate}>
              <div>
                <label className="form-label" htmlFor="template-name">{t('templateNameLabel')}</label>
                <input
                  id="template-name"
                  className="form-input"
                  value={templateForm.name}
                  onChange={(event) =>
                    setTemplateForm((currentValue) => ({ ...currentValue, name: event.target.value }))
                  }
                  placeholder={t('templateNamePlaceholder')}
                />
              </div>
              <div>
                <label className="form-label" htmlFor="template-department">{t('departmentLabel')}</label>
                <select
                  id="template-department"
                  className="form-input"
                  value={templateForm.department}
                  onChange={(event) =>
                    setTemplateForm((currentValue) => ({ ...currentValue, department: event.target.value }))
                  }
                >
                  <option value="">{t('allDepartments')}</option>
                  {DEPARTMENTS.map((dept) => (
                    <option key={dept} value={dept}>{dept}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="form-label" htmlFor="template-start">{t('startTimeLabel')}</label>
                <input
                  id="template-start"
                  type="time"
                  className="form-input"
                  value={templateForm.startTime}
                  onChange={(event) =>
                    setTemplateForm((currentValue) => ({ ...currentValue, startTime: event.target.value }))
                  }
                />
              </div>
              <div>
                <label className="form-label" htmlFor="template-end">{t('endTimeLabel')}</label>
                <input
                  id="template-end"
                  type="time"
                  className="form-input"
                  value={templateForm.endTime}
                  onChange={(event) =>
                    setTemplateForm((currentValue) => ({ ...currentValue, endTime: event.target.value }))
                  }
                />
              </div>
              <div>
                <label className="form-label" htmlFor="template-break">{t('breakLabel')}</label>
                <input
                  id="template-break"
                  type="number"
                  min={0}
                  max={240}
                  className="form-input numeric"
                  value={templateForm.breakMinutes}
                  onChange={(event) =>
                    setTemplateForm((currentValue) => ({ ...currentValue, breakMinutes: event.target.value }))
                  }
                />
              </div>
              <div>
                <span className="form-label">{t('colorLabel')}</span>
                <div className="template-color-picker" role="radiogroup" aria-label={t('colorAriaLabel')}>
                  {TEMPLATE_COLOR_KEYS.map((colorOption) => (
                    <button
                      key={colorOption.value}
                      type="button"
                      className={`template-color-swatch${templateForm.color === colorOption.value ? " template-color-swatch-selected" : ""}`}
                      style={{ backgroundColor: colorOption.value }}
                      title={t(colorOption.labelKey)}
                      aria-label={t(colorOption.labelKey)}
                      aria-checked={templateForm.color === colorOption.value}
                      role="radio"
                      onClick={() =>
                        setTemplateForm((currentValue) => ({ ...currentValue, color: colorOption.value }))
                      }
                    />
                  ))}
                </div>
              </div>
              {formError ? <p className="form-field-error">{formError}</p> : null}
              <div className="settings-actions">
                <button type="submit" className="button button-primary" disabled={isSubmitting}>
                  {isSubmitting
                    ? (editingTemplateId ? t('savingBtn') : t('creatingBtn'))
                    : (editingTemplateId ? t('saveChanges') : t('createTemplate'))}
                </button>
              </div>
            </form>
            {submitMessage ? <p className="settings-card-description">{submitMessage}</p> : null}
          </article>

          {sortedTemplates.length === 0 ? (
            <EmptyState
              title={t('noTemplates')}
              description={t('noTemplatesDescription')}
              ctaLabel={t('createTemplate')}
              ctaHref="/admin/scheduling/templates"
            />
          ) : (
            <div className="data-table-container">
              <table className="data-table" aria-label={t('tableAriaLabel')}>
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
                        {t('colTemplate')}
                        <span className="numeric">{sortDirection === "asc" ? "↑" : "↓"}</span>
                      </button>
                    </th>
                    <th>{t('colDepartment')}</th>
                    <th>{t('colHours')}</th>
                    <th>{t('colBreak')}</th>
                    <th>{t('colStatus')}</th>
                    <th>{t('colUpdated')}</th>
                    <th className="table-action-column">{t('colActions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedTemplates.map((template) => (
                    <tr key={template.id} className="data-table-row">
                      <td>
                        <span className="template-name-cell">
                          <span
                            className="template-color-dot"
                            style={{ backgroundColor: template.color ?? "#2563EB" }}
                            aria-hidden="true"
                          />
                          {template.name}
                        </span>
                      </td>
                      <td>{template.department ?? t('allDepartments')}</td>
                      <td className="numeric">
                        {template.startTime} - {template.endTime}
                      </td>
                      <td className="numeric">{tCommon('minutesValue', { value: template.breakMinutes })}</td>
                      <td>
                        <StatusBadge tone="success">{t('statusActive')}</StatusBadge>
                      </td>
                      <td>
                        <span title={formatDateTimeTooltip(template.updatedAt, locale)}>
                          {formatRelativeTime(template.updatedAt, locale)}
                        </span>
                      </td>
                      <td className="table-row-action-cell">
                        <div className="timeatt-row-actions">
                          <button
                            type="button"
                            className="table-row-action"
                            onClick={() => startEditingTemplate(template)}
                          >
                            {tCommon('edit')}
                          </button>
                          <button
                            type="button"
                            className="table-row-action table-row-action-danger"
                            onClick={() => setDeleteConfirmTemplateId(template.id)}
                          >
                            {tCommon('delete')}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}

      <ConfirmDialog
        isOpen={deleteConfirmTemplateId !== null}
        title={t('deleteTitle')}
        description={t('deleteDescription')}
        confirmLabel={tCommon('delete')}
        tone="danger"
        isConfirming={isDeletingTemplate}
        onConfirm={() => {
          if (deleteConfirmTemplateId) {
            void handleDeleteTemplate(deleteConfirmTemplateId);
          }
        }}
        onCancel={() => setDeleteConfirmTemplateId(null)}
      />
    </>
  );
}
