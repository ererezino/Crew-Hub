"use client";

import { useTranslations } from "next-intl";
import { useState, useCallback } from "react";
import { ChevronDown, ChevronUp, Trophy, Plus } from "lucide-react";

import { SlidePanel } from "../../../../components/shared/slide-panel";
import { useCrewGamesLeaderboard, useCrewGamesMutations } from "../../../../hooks/use-crew-games";
import type { LeaderboardEntry, LeaderboardAdjustment } from "../../../../types/crew-games";
import { EmployeePickerField } from "./employee-picker-field";

type LeaderboardSectionProps = {
  isAdmin: boolean;
  orgId: string;
};

const SEASON_OPTIONS = ["2024", "2025", "2026"];

export function LeaderboardSection({
  isAdmin,
  orgId
}: LeaderboardSectionProps) {
  const t = useTranslations("crewGames.leaderboard");
  const tRoot = useTranslations("crewGames");
  const [showAll, setShowAll] = useState(false);
  const [isAdjustmentOpen, setIsAdjustmentOpen] = useState(false);
  const [selectedSeason, setSelectedSeason] = useState(
    String(new Date().getFullYear())
  );

  const { leaderboard, adjustments, season, refresh: refreshLeaderboard } =
    useCrewGamesLeaderboard(selectedSeason);

  const displayEntries = showAll ? leaderboard : leaderboard.slice(0, 10);

  const handleAdjustmentAdded = useCallback(() => {
    setIsAdjustmentOpen(false);
    refreshLeaderboard();
  }, [refreshLeaderboard]);

  return (
    <section className="crew-games-section">
      <div className="crew-games-section-header">
        <h3 className="section-title">
          <Trophy size={18} aria-hidden="true" style={{ marginRight: "var(--space-2)" }} />
          {t("title")} - {season}
        </h3>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
          {/* Season selector */}
          <div style={{ display: "flex", gap: "var(--space-1)" }}>
            {SEASON_OPTIONS.map((yr) => (
              <button
                key={yr}
                type="button"
                className={
                  yr === selectedSeason
                    ? "crew-games-season-btn-active"
                    : "crew-games-season-btn"
                }
                onClick={() => setSelectedSeason(yr)}
              >
                {yr}
              </button>
            ))}
          </div>
          {isAdmin ? (
            <button
              type="button"
              className="button button-ghost"
              onClick={() => setIsAdjustmentOpen(true)}
            >
              <Plus size={14} aria-hidden="true" />
              {t("addAdjustment")}
            </button>
          ) : null}
        </div>
      </div>

      {leaderboard.length === 0 ? (
        <div className="crew-games-empty-state">
          <Trophy size={32} aria-hidden="true" className="crew-games-empty-state-icon" />
          <p className="crew-games-empty-state-title">{tRoot("noLeaderboardData")}</p>
          <p className="crew-games-empty-state-description">{t("empty")}</p>
        </div>
      ) : (
        <div className="crew-games-leaderboard-wrapper">
          <div className="crew-games-leaderboard data-table-container">
            <table className="crew-games-leaderboard-table">
              <thead>
                <tr>
                  <th className="crew-games-lb-rank">{t("rank")}</th>
                  <th className="crew-games-lb-player">{t("player")}</th>
                  <th className="crew-games-lb-stat">{t("points")}</th>
                  <th className="crew-games-lb-stat">{t("gamesPlayed")}</th>
                  <th className="crew-games-lb-stat">{t("wins")}</th>
                </tr>
              </thead>
              <tbody>
                {displayEntries.map((entry, idx) => (
                  <tr
                    key={entry.employeeId}
                    className={
                      idx === 0
                        ? "crew-games-lb-top crew-games-lb-champion"
                        : idx < 3
                          ? `crew-games-lb-top crew-games-lb-top-${idx + 1}`
                          : ""
                    }
                  >
                    <td className="crew-games-lb-rank">
                      {idx < 3 ? (
                        <span className={`crew-games-lb-medal crew-games-lb-medal-${idx + 1}`}>
                          {idx + 1}
                        </span>
                      ) : (
                        idx + 1
                      )}
                    </td>
                    <td className="crew-games-lb-player">
                      <div className="crew-games-lb-player-info">
                        {entry.avatarUrl ? (
                          <img
                            src={entry.avatarUrl}
                            alt=""
                            className="crew-games-lb-avatar"
                          />
                        ) : (
                          <span className="crew-games-lb-avatar-placeholder">
                            {entry.employeeName.charAt(0).toUpperCase()}
                          </span>
                        )}
                        <span>{entry.employeeName}</span>
                      </div>
                    </td>
                    <td className="crew-games-lb-stat crew-games-lb-points">
                      {entry.totalPoints}
                    </td>
                    <td className="crew-games-lb-stat">{entry.gamesPlayed}</td>
                    <td className="crew-games-lb-stat">{entry.wins}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {leaderboard.length > 10 ? (
            <button
              type="button"
              className="button button-ghost crew-games-show-all"
              onClick={() => setShowAll(!showAll)}
            >
              {showAll ? (
                <>
                  <ChevronUp size={14} aria-hidden="true" /> {t("showTop10")}
                </>
              ) : (
                <>
                  <ChevronDown size={14} aria-hidden="true" /> {t("showAll", { count: leaderboard.length })}
                </>
              )}
            </button>
          ) : null}
        </div>
      )}

      {/* Adjustment panel */}
      <SlidePanel
        isOpen={isAdjustmentOpen}
        title={t("adjustments")}
        onClose={() => setIsAdjustmentOpen(false)}
      >
        <AdjustmentForm
          orgId={orgId}
          season={season}
          onSaved={handleAdjustmentAdded}
          onCancel={() => setIsAdjustmentOpen(false)}
        />
      </SlidePanel>
    </section>
  );
}

/* ── Adjustment form ── */

type AdjustmentFormProps = {
  orgId: string;
  season: string;
  onSaved: () => void;
  onCancel: () => void;
};

function AdjustmentForm({ orgId, season, onSaved, onCancel }: AdjustmentFormProps) {
  const t = useTranslations("crewGames.leaderboard");
  const tCommon = useTranslations("crewGames");
  const mutations = useCrewGamesMutations();
  const [employeeId, setEmployeeId] = useState("");
  const [pointsDelta, setPointsDelta] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!employeeId || !pointsDelta || !reason.trim()) {
      setError("All fields are required.");
      return;
    }

    const delta = parseInt(pointsDelta, 10);
    if (isNaN(delta) || delta === 0) {
      setError("Points must be a non-zero integer.");
      return;
    }

    try {
      await mutations.addAdjustment({
        employeeId,
        pointsDelta: delta,
        reason: reason.trim(),
        season
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save.");
    }
  };

  return (
    <form className="slide-panel-form-wrapper" onSubmit={handleSubmit} noValidate>
      <div className="form-field">
        <label className="form-label">{t("player")}</label>
        <EmployeePickerField
          orgId={orgId}
          value={employeeId}
          onChange={setEmployeeId}
        />
      </div>

      <div className="form-field">
        <label className="form-label">{t("pointsDelta")}</label>
        <input
          type="number"
          className="form-input"
          value={pointsDelta}
          onChange={(e) => setPointsDelta(e.target.value)}
          placeholder="e.g. 5 or -3"
        />
      </div>

      <div className="form-field">
        <label className="form-label">{t("reason")}</label>
        <input
          type="text"
          className="form-input"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Bonus for hosting"
          maxLength={500}
        />
      </div>

      {error ? <p className="form-field-error">{error}</p> : null}

      <div className="slide-panel-actions">
        <button type="button" className="button" onClick={onCancel}>
          {tCommon("cancel")}
        </button>
        <button type="submit" className="button button-primary" disabled={mutations.isSaving}>
          {mutations.isSaving ? tCommon("saving") : t("save")}
        </button>
      </div>
    </form>
  );
}
