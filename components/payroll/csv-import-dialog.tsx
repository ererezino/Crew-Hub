"use client";

import { type ChangeEvent, type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { CurrencyDisplay } from "../ui/currency-display";
import { StatusBadge } from "../shared/status-badge";

type CsvImportPreviewRow = {
  rowNumber: number;
  employeeEmail: string;
  employeeId: string;
  employeeName: string;
  baseSalary: number;
  currency: string;
  allowances: { label: string; amount: number }[];
  bonus: { label: string; amount: number } | null;
  deduction: { label: string; amount: number } | null;
  notes: string | null;
  hasConflict: boolean;
};

type CsvImportError = {
  row: number;
  field: string;
  message: string;
};

type CsvImportSummary = {
  totalRows: number;
  validCount: number;
  errorCount: number;
  duplicateCount: number;
  conflictCount: number;
};

type CsvImportPreviewResponseData = {
  validRows: CsvImportPreviewRow[];
  errors: CsvImportError[];
  duplicates: string[];
  conflicts: string[];
  summary: CsvImportSummary;
  committed: boolean;
};

type CsvImportPreviewResponse = {
  data: CsvImportPreviewResponseData | null;
  error: { code: string; message: string } | null;
  meta: { timestamp: string };
};

type CsvImportStep = "upload" | "preview" | "committed";

type CsvImportDialogProps = {
  isOpen: boolean;
  runId: string;
  onClose: () => void;
  onImportComplete: () => void;
};

const CSV_TEMPLATE_HEADER =
  "employee_email,base_salary,currency,allowance_housing,allowance_transport,allowance_communication,allowance_meal,bonus_amount,bonus_label,deduction_amount,deduction_label,notes";

const CSV_TEMPLATE_EXAMPLE =
  "jane@example.com,50000000,NGN,500000,300000,100000,200000,0,,0,,";

function downloadCsvTemplate() {
  const content = `${CSV_TEMPLATE_HEADER}\n${CSV_TEMPLATE_EXAMPLE}\n`;
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "payroll-import-template.csv";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function CsvImportDialog({
  isOpen,
  runId,
  onClose,
  onImportComplete
}: CsvImportDialogProps) {
  const t = useTranslations("csvImport");
  const tCommon = useTranslations("common");

  const [step, setStep] = useState<CsvImportStep>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [previewData, setPreviewData] = useState<CsvImportPreviewResponseData | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /* Reset state when dialog opens/closes */
  useEffect(() => {
    if (!isOpen) {
      setStep("upload");
      setFile(null);
      setIsUploading(false);
      setIsCommitting(false);
      setErrorMessage(null);
      setPreviewData(null);
    }
  }, [isOpen]);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = event.currentTarget.files?.[0] ?? null;

    if (selected && !selected.name.toLowerCase().endsWith(".csv")) {
      setErrorMessage(t("errors.notCsv"));
      setFile(null);
      return;
    }

    if (selected && selected.size > 2 * 1024 * 1024) {
      setErrorMessage(t("errors.tooLarge"));
      setFile(null);
      return;
    }

    setErrorMessage(null);
    setFile(selected);
  };

  const uploadForPreview = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      if (!file) {
        return;
      }

      setIsUploading(true);
      setErrorMessage(null);

      try {
        const formData = new FormData();
        formData.append("file", file);

        const response = await fetch(
          `/api/v1/payroll/runs/${runId}/import-csv`,
          {
            method: "POST",
            body: formData
          }
        );

        const payload = (await response.json()) as CsvImportPreviewResponse;

        if (!response.ok || !payload.data) {
          setErrorMessage(payload.error?.message ?? t("errors.uploadFailed"));
          return;
        }

        setPreviewData(payload.data);
        setStep("preview");
      } catch (error) {
        setErrorMessage(
          error instanceof Error ? error.message : t("errors.uploadFailed")
        );
      } finally {
        setIsUploading(false);
      }
    },
    [file, runId, t]
  );

  const commitImport = useCallback(async () => {
    if (!file) {
      return;
    }

    setIsCommitting(true);
    setErrorMessage(null);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch(
        `/api/v1/payroll/runs/${runId}/import-csv?commit=true`,
        {
          method: "POST",
          body: formData
        }
      );

      const payload = (await response.json()) as CsvImportPreviewResponse;

      if (!response.ok || !payload.data) {
        setErrorMessage(payload.error?.message ?? t("errors.commitFailed"));
        return;
      }

      setPreviewData(payload.data);
      setStep("committed");
      onImportComplete();
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : t("errors.commitFailed")
      );
    } finally {
      setIsCommitting(false);
    }
  }, [file, runId, t, onImportComplete]);

  const handleClose = () => {
    if (isUploading || isCommitting) {
      return;
    }

    onClose();
  };

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isUploading && !isCommitting) {
        onClose();
      }
    };

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [isOpen, isUploading, isCommitting, onClose]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <section
        className="csv-import-dialog modal-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t("title")}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="csv-import-header">
          <h2 className="modal-title">{t("title")}</h2>
          <button
            type="button"
            className="csv-import-close"
            onClick={handleClose}
            disabled={isUploading || isCommitting}
            aria-label={tCommon("close")}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" width="20" height="20">
              <path
                d="M6 6l12 12M18 6L6 18"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        {/* Step 1: Upload */}
        {step === "upload" ? (
          <form className="csv-import-body" onSubmit={uploadForPreview} noValidate>
            <p className="settings-card-description">{t("description")}</p>

            <div className="csv-import-template-row">
              <button
                type="button"
                className="button button-subtle"
                onClick={downloadCsvTemplate}
              >
                {t("downloadTemplate")}
              </button>
            </div>

            <label className="form-field csv-import-file-field">
              <span className="form-label">{t("selectFile")}</span>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                className="form-input"
                onChange={handleFileChange}
              />
            </label>

            {file ? (
              <p className="csv-import-file-info">
                {file.name} ({(file.size / 1024).toFixed(1)} KB)
              </p>
            ) : null}

            {errorMessage ? (
              <p className="form-field-error">{errorMessage}</p>
            ) : null}

            <div className="modal-actions">
              <button
                type="button"
                className="button button-subtle"
                onClick={handleClose}
                disabled={isUploading}
              >
                {tCommon("cancel")}
              </button>
              <button
                type="submit"
                className="button button-accent"
                disabled={!file || isUploading}
              >
                {isUploading ? t("uploading") : t("uploadAndPreview")}
              </button>
            </div>
          </form>
        ) : null}

        {/* Step 2: Preview */}
        {step === "preview" && previewData ? (
          <div className="csv-import-body">
            <div className="csv-import-summary-grid">
              <article className="csv-import-summary-item">
                <span className="numeric">{previewData.summary.totalRows}</span>
                <span>{t("summary.totalRows")}</span>
              </article>
              <article className="csv-import-summary-item csv-import-summary-valid">
                <span className="numeric">{previewData.summary.validCount}</span>
                <span>{t("summary.valid")}</span>
              </article>
              {previewData.summary.errorCount > 0 ? (
                <article className="csv-import-summary-item csv-import-summary-errors">
                  <span className="numeric">{previewData.summary.errorCount}</span>
                  <span>{t("summary.errors")}</span>
                </article>
              ) : null}
              {previewData.summary.duplicateCount > 0 ? (
                <article className="csv-import-summary-item csv-import-summary-errors">
                  <span className="numeric">{previewData.summary.duplicateCount}</span>
                  <span>{t("summary.duplicates")}</span>
                </article>
              ) : null}
              {previewData.summary.conflictCount > 0 ? (
                <article className="csv-import-summary-item csv-import-summary-warnings">
                  <span className="numeric">{previewData.summary.conflictCount}</span>
                  <span>{t("summary.conflicts")}</span>
                </article>
              ) : null}
            </div>

            {previewData.errors.length > 0 ? (
              <details className="csv-import-errors-section">
                <summary className="csv-import-errors-summary">
                  <StatusBadge tone="error">
                    {t("errorsFound", { count: previewData.errors.length })}
                  </StatusBadge>
                </summary>
                <ul className="csv-import-errors-list">
                  {previewData.errors.slice(0, 50).map((error, index) => (
                    <li key={`error-${index}`}>
                      <span className="numeric">Row {error.row}</span>
                      <span className="csv-import-error-field">{error.field}</span>
                      <span>{error.message}</span>
                    </li>
                  ))}
                  {previewData.errors.length > 50 ? (
                    <li className="csv-import-errors-truncated">
                      {t("andMoreErrors", { count: previewData.errors.length - 50 })}
                    </li>
                  ) : null}
                </ul>
              </details>
            ) : null}

            {previewData.duplicates.length > 0 ? (
              <details className="csv-import-errors-section">
                <summary className="csv-import-errors-summary">
                  <StatusBadge tone="warning">
                    {t("duplicatesFound", { count: previewData.duplicates.length })}
                  </StatusBadge>
                </summary>
                <ul className="csv-import-errors-list">
                  {previewData.duplicates.map((email) => (
                    <li key={`dup-${email}`}>{email}</li>
                  ))}
                </ul>
              </details>
            ) : null}

            {previewData.conflicts.length > 0 ? (
              <details className="csv-import-errors-section">
                <summary className="csv-import-errors-summary">
                  <StatusBadge tone="warning">
                    {t("conflictsFound", { count: previewData.conflicts.length })}
                  </StatusBadge>
                </summary>
                <p className="settings-card-description">{t("conflictsDescription")}</p>
                <ul className="csv-import-errors-list">
                  {previewData.conflicts.map((email) => (
                    <li key={`conflict-${email}`}>{email}</li>
                  ))}
                </ul>
              </details>
            ) : null}

            {previewData.validRows.length > 0 ? (
              <div className="csv-import-preview-table-wrap">
                <table className="data-table csv-import-preview-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>{t("preview.employee")}</th>
                      <th>{t("preview.baseSalary")}</th>
                      <th>{t("preview.allowances")}</th>
                      <th>{t("preview.bonus")}</th>
                      <th>{t("preview.deduction")}</th>
                      <th>{t("preview.notes")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewData.validRows.map((row) => (
                      <tr
                        key={`preview-${row.rowNumber}`}
                        className={
                          row.hasConflict
                            ? "data-table-row csv-import-conflict-row"
                            : "data-table-row"
                        }
                      >
                        <td className="numeric">{row.rowNumber}</td>
                        <td>
                          <p>{row.employeeName}</p>
                          <p className="settings-card-description">{row.employeeEmail}</p>
                        </td>
                        <td>
                          <CurrencyDisplay amount={row.baseSalary} currency={row.currency} />
                        </td>
                        <td>
                          {row.allowances.length > 0 ? (
                            <ul className="csv-import-inline-list">
                              {row.allowances.map((a, ai) => (
                                <li key={`a-${ai}`}>
                                  {a.label}: <CurrencyDisplay amount={a.amount} currency={row.currency} />
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <span className="settings-card-description">--</span>
                          )}
                        </td>
                        <td>
                          {row.bonus ? (
                            <>
                              {row.bonus.label}: <CurrencyDisplay amount={row.bonus.amount} currency={row.currency} />
                            </>
                          ) : (
                            <span className="settings-card-description">--</span>
                          )}
                        </td>
                        <td>
                          {row.deduction ? (
                            <>
                              {row.deduction.label}: <CurrencyDisplay amount={row.deduction.amount} currency={row.currency} />
                            </>
                          ) : (
                            <span className="settings-card-description">--</span>
                          )}
                        </td>
                        <td>{row.notes ?? "--"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}

            {errorMessage ? (
              <p className="form-field-error">{errorMessage}</p>
            ) : null}

            <div className="modal-actions">
              <button
                type="button"
                className="button button-subtle"
                onClick={() => {
                  setStep("upload");
                  setPreviewData(null);
                  setErrorMessage(null);
                }}
                disabled={isCommitting}
              >
                {t("backToUpload")}
              </button>
              <button
                type="button"
                className="button button-accent"
                onClick={commitImport}
                disabled={
                  isCommitting ||
                  previewData.summary.validCount === 0
                }
              >
                {isCommitting
                  ? t("committing")
                  : t("commitImport", { count: previewData.summary.validCount })}
              </button>
            </div>
          </div>
        ) : null}

        {/* Step 3: Committed */}
        {step === "committed" && previewData ? (
          <div className="csv-import-body">
            <div className="csv-import-success">
              <svg viewBox="0 0 24 24" width="48" height="48" aria-hidden="true">
                <circle
                  cx="12"
                  cy="12"
                  r="10"
                  fill="none"
                  stroke="var(--color-success)"
                  strokeWidth="1.5"
                />
                <path
                  d="M8 12l3 3 5-6"
                  fill="none"
                  stroke="var(--color-success)"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <h3 className="section-title">{t("commitSuccess")}</h3>
              <p className="settings-card-description">
                {t("commitSuccessDescription", {
                  count: previewData.summary.validCount
                })}
              </p>
            </div>

            <div className="modal-actions">
              <button
                type="button"
                className="button button-accent"
                onClick={handleClose}
              >
                {tCommon("done")}
              </button>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
