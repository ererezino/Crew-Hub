"use client";

import { useTranslations } from "next-intl";
import { useCallback, useMemo, useState } from "react";
import {
  Calendar,
  ChevronDown,
  ChevronUp,
  Gamepad2,
  Plus,
  Trophy,
  Video,
  Zap,
  Edit2,
  Trash2
} from "lucide-react";

import { SlidePanel } from "../../../../components/shared/slide-panel";
import { StatusBadge } from "../../../../components/shared/status-badge";
import {
  useCrewGameEvents,
  useCrewGamesMutations
} from "../../../../hooks/use-crew-games";
import type { CrewNightEvent } from "../../../../types/crew-games";
import { EventFormPanel } from "./event-form-panel";
import { EventPodium } from "./event-podium";
import { ResultsFormPanel } from "./results-form-panel";
import { LeaderboardSection } from "./leaderboard-section";
import { EventDetailPanel } from "./event-detail-panel";

type GamesNightTabProps = {
  orgId: string;
  currentUserId: string;
  isAdmin: boolean;
};

function formatEventDate(dateStr: string): string {
  const date = new Date(dateStr + "T00:00:00");
  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric"
  });
}

function statusTone(status: string) {
  if (status === "upcoming") return "info" as const;
  if (status === "completed") return "success" as const;
  return "draft" as const;
}

function eventImageUrl(path: string): string {
  return `/api/v1/crew-games/download?path=${encodeURIComponent(path)}&inline=true`;
}

/** Group events by year from eventDate, returning entries sorted descending by year. */
function groupByYear(events: CrewNightEvent[]): [string, CrewNightEvent[]][] {
  const map = new Map<string, CrewNightEvent[]>();
  for (const ev of events) {
    const year = ev.eventDate.slice(0, 4);
    const arr = map.get(year);
    if (arr) {
      arr.push(ev);
    } else {
      map.set(year, [ev]);
    }
  }
  return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]));
}

const EVENTS_PER_GROUP = 8;

export function GamesNightTab({ orgId, currentUserId, isAdmin }: GamesNightTabProps) {
  const t = useTranslations("crewGames");
  const { events, isLoading, refresh } = useCrewGameEvents("games_night");
  const mutations = useCrewGamesMutations();

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<CrewNightEvent | null>(null);
  const [resultsEventId, setResultsEventId] = useState<string | null>(null);
  const [detailEventId, setDetailEventId] = useState<string | null>(null);
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [expandedYears, setExpandedYears] = useState<Record<string, boolean>>({});

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }, []);

  // Separate events
  const upcomingEvents = useMemo(
    () => events.filter((e) => e.status === "upcoming"),
    [events]
  );
  const completedEvents = useMemo(
    () => events.filter((e) => e.status === "completed"),
    [events]
  );
  const draftEvents = useMemo(
    () => events.filter((e) => e.status === "draft"),
    [events]
  );

  const heroEvent = upcomingEvents[0] ?? completedEvents[0] ?? null;

  const completedByYear = useMemo(
    () => groupByYear(completedEvents),
    [completedEvents]
  );

  const handleEventCreated = useCallback(() => {
    setIsCreateOpen(false);
    refresh();
    showToast(t("event.created"));
  }, [refresh, showToast, t]);

  const handleEventUpdated = useCallback(() => {
    setEditingEvent(null);
    refresh();
    showToast(t("event.updated"));
  }, [refresh, showToast, t]);

  const handleResultsSaved = useCallback(() => {
    setResultsEventId(null);
    refresh();
    showToast(t("results.saved"));
  }, [refresh, showToast, t]);

  const handleDeleteEvent = useCallback(
    async (id: string) => {
      try {
        await mutations.deleteEvent(id);
        setDeleteConfirmId(null);
        refresh();
        showToast(t("event.deleted"));
      } catch {
        showToast("Failed to delete event.");
      }
    },
    [mutations, refresh, showToast, t]
  );

  const toggleYearExpanded = useCallback((year: string) => {
    setExpandedYears((prev) => ({ ...prev, [year]: !prev[year] }));
  }, []);

  if (isLoading) {
    return (
      <div className="page-loading" aria-hidden="true">
        <div className="table-skeleton-header" />
        <div className="table-skeleton">
          <div className="table-skeleton-row" />
          <div className="table-skeleton-row" />
        </div>
      </div>
    );
  }

  return (
    <div className="crew-games-tab">
      {/* Toast */}
      {toast ? (
        <div className="crew-games-toast" role="status">
          {toast}
        </div>
      ) : null}

      {/* Admin action bar */}
      {isAdmin ? (
        <div className="crew-games-admin-bar">
          <button
            type="button"
            className="button button-primary"
            onClick={() => setIsCreateOpen(true)}
          >
            <Plus size={16} aria-hidden="true" />
            {t("event.createGamesNight")}
          </button>
        </div>
      ) : null}

      {/* Hero section */}
      {heroEvent ? (
        <section
          className="crew-games-hero"
          aria-label={heroEvent.title}
          style={
            heroEvent.eventImagePath
              ? {
                  position: "relative" as const,
                  overflow: "hidden" as const
                }
              : undefined
          }
        >
          {heroEvent.eventImagePath ? (
            <div
              className="crew-games-hero-image-bg"
              style={{
                backgroundImage: `url(${eventImageUrl(heroEvent.eventImagePath)})`
              }}
            />
          ) : null}
          <div className="crew-games-hero-content">
            <div className="crew-games-hero-meta">
              <StatusBadge tone={statusTone(heroEvent.status)}>
                {t(`event.${heroEvent.status}`)}
              </StatusBadge>
              <span className="crew-games-hero-date">
                <Calendar size={14} aria-hidden="true" />
                {formatEventDate(heroEvent.eventDate)}
              </span>
            </div>
            <h2 className="crew-games-hero-title">{heroEvent.title}</h2>
            {heroEvent.featuredGame ? (
              <span className="crew-games-hero-game">{heroEvent.featuredGame}</span>
            ) : null}
            {heroEvent.description ? (
              <p className="crew-games-hero-description">{heroEvent.description}</p>
            ) : null}

            {/* Podium — completed hero events */}
            {heroEvent.status === "completed" ? (
              <EventPodium eventId={heroEvent.id} />
            ) : null}

            {/* Platform action buttons */}
            <div className="crew-games-hero-links">
              {heroEvent.meetLink ? (
                <a
                  href={heroEvent.meetLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="crew-games-platform-btn crew-games-platform-meet"
                >
                  <Video size={16} aria-hidden="true" />
                  <span>{t("links.googleMeet")}</span>
                </a>
              ) : null}
              {heroEvent.kahootLink ? (
                <a
                  href={heroEvent.kahootLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="crew-games-platform-btn crew-games-platform-kahoot"
                >
                  <Zap size={16} aria-hidden="true" />
                  <span>{t("links.kahoot")}</span>
                </a>
              ) : null}
              {heroEvent.altGameLink ? (
                <a
                  href={heroEvent.altGameLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="crew-games-platform-btn crew-games-platform-game"
                >
                  <Gamepad2 size={16} aria-hidden="true" />
                  <span>
                    {heroEvent.featuredGame
                      ? heroEvent.featuredGame.slice(0, 30)
                      : t("links.openGame")}
                  </span>
                </a>
              ) : null}
            </div>

            {/* Admin controls */}
            {isAdmin ? (
              <div className="crew-games-hero-admin">
                <button
                  type="button"
                  className="button button-ghost"
                  onClick={() => setEditingEvent(heroEvent)}
                >
                  <Edit2 size={14} aria-hidden="true" />
                  {t("event.editEvent")}
                </button>
                {heroEvent.eventType === "games_night" ? (
                  <button
                    type="button"
                    className="button button-ghost"
                    onClick={() => setResultsEventId(heroEvent.id)}
                  >
                    <Trophy size={14} aria-hidden="true" />
                    {t("results.postResults")}
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {/* Leaderboard */}
      <LeaderboardSection
        isAdmin={isAdmin}
        orgId={orgId}
      />

      {/* Draft events (admin only) */}
      {isAdmin && draftEvents.length > 0 ? (
        <section className="crew-games-section">
          <h3 className="section-title">{t("event.draft")}</h3>
          <div className="crew-games-event-list">
            {draftEvents.map((event) => (
              <EventCard
                key={event.id}
                event={event}
                isAdmin={isAdmin}
                isExpanded={expandedEventId === event.id}
                onToggleExpand={() =>
                  setExpandedEventId(expandedEventId === event.id ? null : event.id)
                }
                onEdit={() => setEditingEvent(event)}
                onPostResults={() => setResultsEventId(event.id)}
                onDelete={() => setDeleteConfirmId(event.id)}
                onViewDetail={() => setDetailEventId(event.id)}
              />
            ))}
          </div>
        </section>
      ) : null}

      {/* Past events — grouped by year */}
      {completedByYear.length > 0 ? (
        <section className="crew-games-section">
          <h3 className="section-title">{t("event.pastEvents")}</h3>
          {completedByYear.map(([year, yearEvents]) => {
            const isYearExpanded = expandedYears[year] ?? false;
            const visibleEvents = isYearExpanded
              ? yearEvents
              : yearEvents.slice(0, EVENTS_PER_GROUP);
            const hasMore = yearEvents.length > EVENTS_PER_GROUP && !isYearExpanded;

            return (
              <div key={year}>
                <div className="crew-games-archive-year">{year}</div>
                <div className="crew-games-event-list">
                  {visibleEvents.map((event) => (
                    <EventCard
                      key={event.id}
                      event={event}
                      isAdmin={isAdmin}
                      isExpanded={expandedEventId === event.id}
                      onToggleExpand={() =>
                        setExpandedEventId(
                          expandedEventId === event.id ? null : event.id
                        )
                      }
                      onEdit={() => setEditingEvent(event)}
                      onPostResults={() => setResultsEventId(event.id)}
                      onDelete={() => setDeleteConfirmId(event.id)}
                      onViewDetail={() => setDetailEventId(event.id)}
                    />
                  ))}
                </div>
                {hasMore ? (
                  <button
                    type="button"
                    className="button button-ghost crew-games-show-all"
                    onClick={() => toggleYearExpanded(year)}
                  >
                    <ChevronDown size={14} aria-hidden="true" />
                    {t("loadMore")}
                  </button>
                ) : null}
              </div>
            );
          })}
        </section>
      ) : null}

      {/* Empty state */}
      {events.length === 0 && !heroEvent ? (
        <div className="crew-games-empty-state">
          <Trophy size={32} aria-hidden="true" className="crew-games-empty-state-icon" />
          <p className="crew-games-empty-state-title">{t("noEventsYet")}</p>
          <p className="crew-games-empty-state-description">{t("noEventsDesc")}</p>
          {isAdmin ? (
            <button
              type="button"
              className="button button-primary"
              style={{ marginTop: "var(--space-4)" }}
              onClick={() => setIsCreateOpen(true)}
            >
              <Plus size={16} aria-hidden="true" />
              {t("event.createGamesNight")}
            </button>
          ) : null}
        </div>
      ) : null}

      {/* Delete confirmation */}
      {deleteConfirmId ? (
        <div className="slide-panel-root" role="presentation">
          <button
            type="button"
            className="slide-panel-backdrop"
            onClick={() => setDeleteConfirmId(null)}
            aria-label={t("cancel")}
          />
          <div className="crew-games-confirm-dialog" role="alertdialog" aria-modal="true">
            <h3 className="section-title">{t("event.deleteConfirmTitle")}</h3>
            <p className="settings-card-description">{t("event.deleteConfirmDescription")}</p>
            <div className="crew-games-confirm-actions">
              <button
                type="button"
                className="button"
                onClick={() => setDeleteConfirmId(null)}
              >
                {t("cancel")}
              </button>
              <button
                type="button"
                className="button button-danger"
                disabled={mutations.isSaving}
                onClick={() => handleDeleteEvent(deleteConfirmId)}
              >
                {mutations.isSaving ? t("deleting") : t("delete")}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Create panel */}
      <SlidePanel
        isOpen={isCreateOpen}
        title={t("event.createGamesNight")}
        onClose={() => setIsCreateOpen(false)}
      >
        <EventFormPanel
          eventType="games_night"
          orgId={orgId}
          onSaved={handleEventCreated}
          onCancel={() => setIsCreateOpen(false)}
        />
      </SlidePanel>

      {/* Edit panel */}
      <SlidePanel
        isOpen={Boolean(editingEvent)}
        title={t("event.editEvent")}
        onClose={() => setEditingEvent(null)}
      >
        {editingEvent ? (
          <EventFormPanel
            eventType="games_night"
            orgId={orgId}
            existingEvent={editingEvent}
            onSaved={handleEventUpdated}
            onCancel={() => setEditingEvent(null)}
          />
        ) : null}
      </SlidePanel>

      {/* Results panel */}
      <SlidePanel
        isOpen={Boolean(resultsEventId)}
        title={t("results.postResults")}
        onClose={() => setResultsEventId(null)}
      >
        {resultsEventId ? (
          <ResultsFormPanel
            eventId={resultsEventId}
            orgId={orgId}
            onSaved={handleResultsSaved}
            onCancel={() => setResultsEventId(null)}
          />
        ) : null}
      </SlidePanel>

      {/* Detail panel */}
      <SlidePanel
        isOpen={Boolean(detailEventId)}
        title={t("results.title")}
        onClose={() => setDetailEventId(null)}
      >
        {detailEventId ? (
          <EventDetailPanel eventId={detailEventId} />
        ) : null}
      </SlidePanel>
    </div>
  );
}

/* ── Event Card ── */

type EventCardProps = {
  event: CrewNightEvent;
  isAdmin: boolean;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onEdit: () => void;
  onPostResults: () => void;
  onDelete: () => void;
  onViewDetail: () => void;
};

function EventCard({
  event,
  isAdmin,
  isExpanded,
  onToggleExpand,
  onEdit,
  onPostResults,
  onDelete,
  onViewDetail
}: EventCardProps) {
  const t = useTranslations("crewGames");

  return (
    <div className="crew-games-event-card dashboard-panel">
      <button
        type="button"
        className="crew-games-event-card-header"
        onClick={onToggleExpand}
        aria-expanded={isExpanded}
      >
        <div className="crew-games-event-card-info">
          {event.eventImagePath ? (
            <img
              src={eventImageUrl(event.eventImagePath)}
              alt=""
              className="crew-games-event-card-thumb"
            />
          ) : null}
          <StatusBadge tone={statusTone(event.status)}>
            {t(`event.${event.status}`)}
          </StatusBadge>
          <span className="crew-games-event-card-title">{event.title}</span>
          <span className="crew-games-event-card-date">
            {formatEventDate(event.eventDate)}
          </span>
        </div>
        {isExpanded ? (
          <ChevronUp size={16} aria-hidden="true" />
        ) : (
          <ChevronDown size={16} aria-hidden="true" />
        )}
      </button>

      {isExpanded ? (
        <div className="crew-games-event-card-body">
          {event.featuredGame ? (
            <p className="crew-games-event-card-game">
              <strong>{t("event.game")}</strong> {event.featuredGame}
            </p>
          ) : null}
          {event.description ? (
            <p className="crew-games-event-card-desc">{event.description}</p>
          ) : null}
          {event.highlights ? (
            <p className="crew-games-event-card-highlights">
              <strong>{t("event.highlights")}</strong> {event.highlights}
            </p>
          ) : null}

          {/* Podium for completed events */}
          {event.status === "completed" ? (
            <EventPodium eventId={event.id} />
          ) : null}

          {/* Platform action links */}
          <div className="crew-games-hero-links" style={{ marginTop: "var(--space-2)" }}>
            {event.meetLink ? (
              <a
                href={event.meetLink}
                target="_blank"
                rel="noopener noreferrer"
                className="crew-games-platform-btn crew-games-platform-meet"
              >
                <Video size={14} aria-hidden="true" />
                <span>{t("links.googleMeet")}</span>
              </a>
            ) : null}
            {event.kahootLink ? (
              <a
                href={event.kahootLink}
                target="_blank"
                rel="noopener noreferrer"
                className="crew-games-platform-btn crew-games-platform-kahoot"
              >
                <Zap size={14} aria-hidden="true" />
                <span>{t("links.kahoot")}</span>
              </a>
            ) : null}
            {event.altGameLink ? (
              <a
                href={event.altGameLink}
                target="_blank"
                rel="noopener noreferrer"
                className="crew-games-platform-btn crew-games-platform-game"
              >
                <Gamepad2 size={14} aria-hidden="true" />
                <span>
                  {event.featuredGame
                    ? event.featuredGame.slice(0, 30)
                    : t("links.openGame")}
                </span>
              </a>
            ) : null}
          </div>

          <div className="crew-games-event-card-actions">
            <button type="button" className="button" onClick={onViewDetail}>
              {t("event.viewResults")}
            </button>
            {isAdmin ? (
              <>
                <button type="button" className="button button-ghost" onClick={onEdit}>
                  <Edit2 size={14} aria-hidden="true" /> {t("event.edit")}
                </button>
                <button type="button" className="button button-ghost" onClick={onPostResults}>
                  <Trophy size={14} aria-hidden="true" /> {t("event.results")}
                </button>
                <button type="button" className="table-row-action table-row-action-danger" onClick={onDelete}>
                  <Trash2 size={14} aria-hidden="true" />
                </button>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
