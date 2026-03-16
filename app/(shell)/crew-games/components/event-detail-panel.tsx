"use client";

import { useTranslations } from "next-intl";

import { StatusBadge } from "../../../../components/shared/status-badge";
import { useCrewGameEventDetail } from "../../../../hooks/use-crew-games";

type EventDetailPanelProps = {
  eventId: string;
};

export function EventDetailPanel({ eventId }: EventDetailPanelProps) {
  const t = useTranslations("crewGames");
  const { event, results, presenters, isLoading } = useCrewGameEventDetail(eventId);

  if (isLoading) {
    return <p className="crew-games-empty-hint">Loading…</p>;
  }

  if (!event) {
    return <p className="crew-games-empty-hint">Event not found.</p>;
  }

  const isGamesNight = event.eventType === "games_night";

  return (
    <div className="crew-games-detail">
      <div className="crew-games-detail-header">
        <h3 className="section-title">{event.title}</h3>
        <p className="crew-games-detail-date">{event.eventDate}</p>
      </div>

      {/* Games Night results table */}
      {isGamesNight ? (
        <div className="crew-games-detail-section">
          <h4 className="form-label">{t("results.title")}</h4>
          {results.length === 0 ? (
            <p className="crew-games-empty-hint">{t("results.noResults")}</p>
          ) : (
            <div className="data-table-container">
              <table className="crew-games-leaderboard-table">
                <thead>
                  <tr>
                    <th>{t("results.placement")}</th>
                    <th>{t("results.nickname")}</th>
                    <th>{t("results.player")}</th>
                    <th>{t("results.score")}</th>
                    <th>{t("results.points")}</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((r) => (
                    <tr key={r.id}>
                      <td>
                        {r.placement !== null ? (
                          r.placement <= 3 ? (
                            <span className={`crew-games-lb-medal crew-games-lb-medal-${r.placement}`}>
                              {r.placement}
                            </span>
                          ) : (
                            r.placement
                          )
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>{r.nickname}</td>
                      <td>
                        {r.employeeName ?? (
                          <span className="crew-games-unmapped">
                            {t("results.unmapped")}
                          </span>
                        )}
                      </td>
                      <td>{r.score !== null ? r.score : "—"}</td>
                      <td className="crew-games-lb-points">{r.pointsAwarded}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}

      {/* Presentation Night presenters */}
      {!isGamesNight ? (
        <div className="crew-games-detail-section">
          <h4 className="form-label">{t("presenters.title")}</h4>
          {presenters.length === 0 ? (
            <p className="crew-games-empty-hint">{t("presenters.noPresenters")}</p>
          ) : (
            <div className="crew-games-presenter-list">
              {presenters.map((p) => (
                <div key={p.id} className="crew-games-presenter-card dashboard-panel">
                  <div className="crew-games-presenter-info">
                    <span className="crew-games-presenter-name">{p.employeeName}</span>
                    {p.talkTitle ? (
                      <span className="crew-games-presenter-talk">{p.talkTitle}</span>
                    ) : null}
                  </div>
                  <div className="crew-games-presenter-meta">
                    {p.isWinner ? (
                      <StatusBadge tone="success">{t("presenters.winner")}</StatusBadge>
                    ) : null}
                    <span className="crew-games-presenter-votes">
                      {p.voteCount} {t("presenters.votes").toLowerCase()}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}

      {/* Highlights */}
      {event.highlights ? (
        <div className="crew-games-detail-section">
          <h4 className="form-label">{t("event.highlights")}</h4>
          <p className="crew-games-event-card-highlights">{event.highlights}</p>
        </div>
      ) : null}
    </div>
  );
}
