"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";

import { useCrewGameEventDetail, useCrewGamesMutations } from "../../../../hooks/use-crew-games";
import { EmployeePickerField } from "./employee-picker-field";

type ResultRow = {
  key: string;
  nickname: string;
  employeeId: string;
  score: string;
  placement: string;
  pointsAwarded: string;
};

function newRow(): ResultRow {
  return {
    key: crypto.randomUUID(),
    nickname: "",
    employeeId: "",
    score: "",
    placement: "",
    pointsAwarded: "0"
  };
}

type ResultsFormPanelProps = {
  eventId: string;
  orgId: string;
  onSaved: () => void;
  onCancel: () => void;
};

export function ResultsFormPanel({ eventId, orgId, onSaved, onCancel }: ResultsFormPanelProps) {
  const t = useTranslations("crewGames.results");
  const tCommon = useTranslations("crewGames");
  const { results: existingResults, isLoading } = useCrewGameEventDetail(eventId);
  const mutations = useCrewGamesMutations();
  const [rows, setRows] = useState<ResultRow[]>([newRow()]);
  const [error, setError] = useState<string | null>(null);
  const initializedRef = useRef(false);

  // Pre-fill from existing results
  useEffect(() => {
    if (initializedRef.current || isLoading) return;
    initializedRef.current = true;
    if (existingResults.length > 0) {
      const mapped = existingResults.map((r) => ({
        key: r.id,
        nickname: r.nickname,
        employeeId: r.employeeId ?? "",
        score: r.score !== null ? String(r.score) : "",
        placement: r.placement !== null ? String(r.placement) : "",
        pointsAwarded: String(r.pointsAwarded)
      }));
      queueMicrotask(() => setRows(mapped));
    }
  }, [existingResults, isLoading]);

  const addRow = useCallback(() => {
    setRows((prev) => [...prev, newRow()]);
  }, []);

  const removeRow = useCallback((key: string) => {
    setRows((prev) => prev.filter((r) => r.key !== key));
  }, []);

  const updateRow = useCallback((key: string, field: keyof ResultRow, value: string) => {
    setRows((prev) =>
      prev.map((r) => (r.key === key ? { ...r, [field]: value } : r))
    );
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const validRows = rows.filter((r) => r.nickname.trim());
    if (validRows.length === 0) {
      setError("At least one player with a nickname is required.");
      return;
    }

    const payload = validRows.map((r) => ({
      nickname: r.nickname.trim(),
      employeeId: r.employeeId || null,
      score: r.score ? parseFloat(r.score) : null,
      placement: r.placement ? parseInt(r.placement, 10) : null,
      pointsAwarded: parseInt(r.pointsAwarded, 10) || 0
    }));

    try {
      await mutations.saveResults(eventId, payload);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save results.");
    }
  };

  if (isLoading) {
    return <p className="crew-games-empty-hint">{tCommon("loading")}</p>;
  }

  return (
    <form className="slide-panel-form-wrapper" onSubmit={handleSubmit} noValidate>
      <div className="crew-games-results-form">
        {rows.map((row, idx) => (
          <div key={row.key} className="crew-games-result-row">
            <div className="crew-games-result-row-header">
              <span className="form-label">{t("playerIdx", { idx: idx + 1 })}</span>
              {rows.length > 1 ? (
                <button
                  type="button"
                  className="table-row-action table-row-action-danger"
                  onClick={() => removeRow(row.key)}
                  aria-label="Remove player"
                >
                  <Trash2 size={14} />
                </button>
              ) : null}
            </div>

            <div className="form-field">
              <label className="form-label">{t("nickname")}</label>
              <input
                type="text"
                className="form-input"
                value={row.nickname}
                onChange={(e) => updateRow(row.key, "nickname", e.target.value)}
                maxLength={100}
                required
              />
            </div>

            <div className="form-field">
              <label className="form-label">{t("player")}</label>
              <EmployeePickerField
                orgId={orgId}
                value={row.employeeId}
                onChange={(val) => updateRow(row.key, "employeeId", val)}
                placeholder={t("unmapped")}
              />
            </div>

            <div className="crew-games-result-row-stats">
              <div className="form-field">
                <label className="form-label">{t("score")}</label>
                <input
                  type="number"
                  className="form-input"
                  value={row.score}
                  onChange={(e) => updateRow(row.key, "score", e.target.value)}
                />
              </div>
              <div className="form-field">
                <label className="form-label">{t("placement")}</label>
                <input
                  type="number"
                  className="form-input"
                  value={row.placement}
                  onChange={(e) => updateRow(row.key, "placement", e.target.value)}
                  min={1}
                />
              </div>
              <div className="form-field">
                <label className="form-label">{t("points")}</label>
                <input
                  type="number"
                  className="form-input"
                  value={row.pointsAwarded}
                  onChange={(e) => updateRow(row.key, "pointsAwarded", e.target.value)}
                  min={0}
                />
              </div>
            </div>
          </div>
        ))}
      </div>

      <button type="button" className="button button-ghost" onClick={addRow}>
        <Plus size={14} aria-hidden="true" />
        {t("addRow")}
      </button>

      {error ? <p className="form-field-error">{error}</p> : null}

      <div className="slide-panel-actions">
        <button type="button" className="button" onClick={onCancel}>
          {tCommon("cancel")}
        </button>
        <button type="submit" className="button button-primary" disabled={mutations.isSaving}>
          {mutations.isSaving ? tCommon("saving") : t("saveResults")}
        </button>
      </div>
    </form>
  );
}
