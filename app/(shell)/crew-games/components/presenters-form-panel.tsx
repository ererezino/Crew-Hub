"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2, Upload } from "lucide-react";

import { useCrewGameEventDetail, useCrewGamesMutations } from "../../../../hooks/use-crew-games";
import { EmployeePickerField } from "./employee-picker-field";
import {
  SLIDES_MAX_BYTES,
  ALLOWED_SLIDES_MIME_TYPES
} from "../../../../types/crew-games";

type PresenterRow = {
  key: string;
  employeeId: string;
  talkTitle: string;
  slidePath: string;
  slideFilename: string;
  voteCount: string;
  isWinner: boolean;
  pendingFile: File | null;
};

function newPresenterRow(): PresenterRow {
  return {
    key: crypto.randomUUID(),
    employeeId: "",
    talkTitle: "",
    slidePath: "",
    slideFilename: "",
    voteCount: "0",
    isWinner: false,
    pendingFile: null
  };
}

type PresentersFormPanelProps = {
  eventId: string;
  orgId: string;
  onSaved: () => void;
  onCancel: () => void;
};

export function PresentersFormPanel({
  eventId,
  orgId,
  onSaved,
  onCancel
}: PresentersFormPanelProps) {
  const t = useTranslations("crewGames.presenters");
  const tUpload = useTranslations("crewGames.upload");
  const { presenters: existing, isLoading } = useCrewGameEventDetail(eventId);
  const mutations = useCrewGamesMutations();
  const [rows, setRows] = useState<PresenterRow[]>([newPresenterRow()]);
  const [error, setError] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (initialized || isLoading) return;
    if (existing.length > 0) {
      setRows(
        existing.map((p) => ({
          key: p.id,
          employeeId: p.employeeId,
          talkTitle: p.talkTitle ?? "",
          slidePath: p.slidePath ?? "",
          slideFilename: p.slideFilename ?? "",
          voteCount: String(p.voteCount),
          isWinner: p.isWinner,
          pendingFile: null
        }))
      );
    }
    setInitialized(true);
  }, [existing, isLoading, initialized]);

  const addRow = useCallback(() => {
    setRows((prev) => [...prev, newPresenterRow()]);
  }, []);

  const removeRow = useCallback((key: string) => {
    setRows((prev) => prev.filter((r) => r.key !== key));
  }, []);

  const updateRow = useCallback(
    (key: string, field: keyof PresenterRow, value: string | boolean | File | null) => {
      setRows((prev) =>
        prev.map((r) => {
          if (r.key !== key) return r;

          // Enforce single winner
          if (field === "isWinner" && value === true) {
            return { ...r, isWinner: true };
          }

          return { ...r, [field]: value };
        })
      );

      // Clear other winners when one is selected
      if (field === "isWinner" && value === true) {
        setRows((prev) =>
          prev.map((r) =>
            r.key === key ? r : { ...r, isWinner: false }
          )
        );
      }
    },
    []
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const validRows = rows.filter((r) => r.employeeId);
    if (validRows.length === 0) {
      setError("At least one presenter is required.");
      return;
    }

    // Check winner count
    const winners = validRows.filter((r) => r.isWinner);
    if (winners.length > 1) {
      setError("Only one winner is allowed per event.");
      return;
    }

    try {
      // Upload pending files first
      for (const row of validRows) {
        if (row.pendingFile) {
          const ext = row.pendingFile.name.split(".").pop() ?? "pdf";
          const storagePath = `${orgId}/presentations/${eventId}/${row.employeeId}/slides.${ext}`;
          const result = await mutations.uploadFile(row.pendingFile, "slides", storagePath);
          if (result) {
            row.slidePath = result.path;
            row.slideFilename = result.filename;
          }
        }
      }

      const payload = validRows.map((r) => ({
        employeeId: r.employeeId,
        talkTitle: r.talkTitle.trim() || null,
        slidePath: r.slidePath || null,
        slideFilename: r.slideFilename || null,
        voteCount: parseInt(r.voteCount, 10) || 0,
        isWinner: r.isWinner
      }));

      await mutations.savePresenters(eventId, payload);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save presenters.");
    }
  };

  if (isLoading) {
    return <p className="crew-games-empty-hint">Loading…</p>;
  }

  return (
    <form className="slide-panel-form-wrapper" onSubmit={handleSubmit} noValidate>
      <div className="crew-games-results-form">
        {rows.map((row, idx) => (
          <div key={row.key} className="crew-games-result-row">
            <div className="crew-games-result-row-header">
              <span className="form-label">Presenter {idx + 1}</span>
              {rows.length > 1 ? (
                <button
                  type="button"
                  className="table-row-action table-row-action-danger"
                  onClick={() => removeRow(row.key)}
                  aria-label="Remove presenter"
                >
                  <Trash2 size={14} />
                </button>
              ) : null}
            </div>

            <div className="form-field">
              <label className="form-label">{t("title") || "Presenter"}</label>
              <EmployeePickerField
                orgId={orgId}
                value={row.employeeId}
                onChange={(val) => updateRow(row.key, "employeeId", val)}
              />
            </div>

            <div className="form-field">
              <label className="form-label">{t("talkTitle")}</label>
              <input
                type="text"
                className="form-input"
                value={row.talkTitle}
                onChange={(e) => updateRow(row.key, "talkTitle", e.target.value)}
                maxLength={200}
              />
            </div>

            <div className="crew-games-result-row-stats">
              <div className="form-field">
                <label className="form-label">{t("votes")}</label>
                <input
                  type="number"
                  className="form-input"
                  value={row.voteCount}
                  onChange={(e) => updateRow(row.key, "voteCount", e.target.value)}
                  min={0}
                />
              </div>
              <div className="form-field">
                <label className="form-label">{t("winner")}</label>
                <label className="crew-games-checkbox-label">
                  <input
                    type="checkbox"
                    checked={row.isWinner}
                    onChange={(e) => updateRow(row.key, "isWinner", e.target.checked)}
                  />
                  Winner
                </label>
              </div>
            </div>

            {/* Slide upload */}
            <div className="form-field">
              <label className="form-label">{t("slides")}</label>
              {row.slideFilename && !row.pendingFile ? (
                <div className="crew-games-file-indicator">
                  <span>{row.slideFilename}</span>
                  <button
                    type="button"
                    className="table-row-action table-row-action-danger"
                    onClick={() => {
                      updateRow(row.key, "slidePath", "");
                      updateRow(row.key, "slideFilename", "");
                    }}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ) : row.pendingFile ? (
                <div className="crew-games-file-indicator">
                  <span>{row.pendingFile.name}</span>
                  <button
                    type="button"
                    className="table-row-action table-row-action-danger"
                    onClick={() => updateRow(row.key, "pendingFile", null)}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ) : (
                <label className="button button-ghost crew-games-upload-btn">
                  <Upload size={14} aria-hidden="true" />
                  {t("uploadSlides")}
                  <input
                    type="file"
                    accept=".pdf,.pptx"
                    className="crew-games-file-input"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      if (file.size > SLIDES_MAX_BYTES) {
                        setError(tUpload("fileTooLarge"));
                        return;
                      }
                      const mime = file.type;
                      if (
                        !ALLOWED_SLIDES_MIME_TYPES.includes(
                          mime as (typeof ALLOWED_SLIDES_MIME_TYPES)[number]
                        )
                      ) {
                        setError(tUpload("invalidFileType"));
                        return;
                      }
                      updateRow(row.key, "pendingFile", file);
                      setError(null);
                    }}
                  />
                </label>
              )}
              <p className="form-field-hint">{tUpload("slidesHint")}</p>
            </div>
          </div>
        ))}
      </div>

      <button type="button" className="button button-ghost" onClick={addRow}>
        <Plus size={14} aria-hidden="true" />
        {t("addPresenter")}
      </button>

      {error ? <p className="form-field-error">{error}</p> : null}

      <div className="slide-panel-actions">
        <button type="button" className="button" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="button button-primary" disabled={mutations.isSaving}>
          {mutations.isSaving ? "Saving…" : "Save Presenters"}
        </button>
      </div>
    </form>
  );
}
