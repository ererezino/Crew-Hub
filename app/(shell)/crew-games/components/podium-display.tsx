"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { Trophy } from "lucide-react";

import type { CrewNightResult } from "../../../../types/crew-games";

type PodiumDisplayProps = {
  results: CrewNightResult[];
};

/**
 * Celebratory podium showing top-3 finishers in classic 2nd–1st–3rd layout.
 * Connected pedestal blocks form a unified structure with a trophy crowning 1st.
 * Gracefully degrades for fewer than 3 placed results.
 */
export function PodiumDisplay({ results }: PodiumDisplayProps) {
  const t = useTranslations("crewGames.results");
  const top3 = useMemo(
    () =>
      results
        .filter((r) => r.placement !== null && r.placement >= 1 && r.placement <= 3)
        .sort((a, b) => (a.placement ?? 99) - (b.placement ?? 99)),
    [results]
  );

  if (top3.length === 0) return null;

  const first = top3.find((r) => r.placement === 1) ?? null;
  const second = top3.find((r) => r.placement === 2) ?? null;
  const third = top3.find((r) => r.placement === 3) ?? null;

  // Podium order: 2nd, 1st, 3rd (visually: left, center-elevated, right)
  const columns: { result: CrewNightResult | null; placement: number }[] = [
    { result: second, placement: 2 },
    { result: first, placement: 1 },
    { result: third, placement: 3 }
  ];

  return (
    <div className="crew-games-podium" role="list" aria-label="Top finishers">
      {columns.map(({ result, placement }) => {
        if (!result) return null;

        const displayName = result.employeeName ?? result.nickname;
        const initial = displayName.charAt(0).toUpperCase();

        return (
          <div
            key={result.id}
            className={`crew-games-podium-col crew-games-podium-col-${placement}`}
            role="listitem"
          >
            {/* Player info above pedestal */}
            <div className="crew-games-podium-info">
              {placement === 1 ? (
                <Trophy
                  size={28}
                  className="crew-games-podium-trophy"
                  aria-hidden="true"
                />
              ) : null}
              <div
                className={`crew-games-podium-avatar crew-games-podium-avatar-${placement}`}
              >
                {initial}
              </div>
              <span className="crew-games-podium-name">{displayName}</span>
              {result.score !== null ? (
                <span className="crew-games-podium-score">
                  {result.score.toLocaleString()} {t("points").toLowerCase()}
                </span>
              ) : null}
            </div>

            {/* Pedestal block — flush against adjacent blocks */}
            <div
              className={`crew-games-podium-block crew-games-podium-block-${placement}`}
            >
              <span className="crew-games-podium-placement">{placement}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
