"use client";

import { useTranslations } from "next-intl";
import { useCallback, useMemo, useState } from "react";
import {
  Calendar,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Plus,
  Trophy,
  Edit2,
  Trash2
} from "lucide-react";

import { EmptyState } from "../../../../components/shared/empty-state";
import { SlidePanel } from "../../../../components/shared/slide-panel";
import { StatusBadge } from "../../../../components/shared/status-badge";
import {
  useCrewGameEvents,
  useCrewGamesLeaderboard,
  useCrewGamesMutations
} from "../../../../hooks/use-crew-games";
import type { CrewNightEvent } from "../../../../types/crew-games";
import { EventFormPanel } from "./event-form-panel";
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

export function GamesNightTab({ orgId, currentUserId, isAdmin }: GamesNightTabProps) {
  const t = useTranslations("crewGames");
  const { events, isLoading, refresh } = useCrewGameEvents("games_night");
  const { leaderboard, adjustments, season, refresh: refreshLeaderboard } = useCrewGamesLeaderboard();
  const mutations = useCrewGamesMutations();

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<CrewNightEvent | null>(null);
  const [resultsEventId, setResultsEventId] = useState<string | null>(null);
  const [detailEventId, setDetailEventId] = useState<string | null>(null);
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

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

  const handleEventCreated = useCallback(() => {
    setIsCreateOpen(false);
    refresh();
    showToast(t("event.created"));
  }, [refresh, showToast, t]);

  const handleEventUpdated = useCallback(() => {
    setEditingEvent(null);
    refresh();
    refreshLeaderboard();
    showToast(t("event.updated"));
  }, [refresh, refreshLeaderboard, showToast, t]);

  const handleResultsSaved = useCallback(() => {
    setResultsEventId(null);
    refresh();
    refreshLeaderboard();
    showToast(t("results.saved"));
  }, [refresh, refreshLeaderboard, showToast, t]);

  const handleDeleteEvent = useCallback(
    async (id: string) => {
      try {
        await mutations.deleteEvent(id);
        setDeleteConfirmId(null);
        refresh();
        refreshLeaderboard();
        showToast(t("event.deleted"));
      } catch {
        showToast("Failed to delete event.");
      }
    },
    [mutations, refresh, refreshLeaderboard, showToast, t]
  );

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
        <section className="crew-games-hero" aria-label={heroEvent.title}>
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
              <p className="crew-games-hero-game">{heroEvent.featuredGame}</p>
            ) : null}
            {heroEvent.description ? (
              <p className="crew-games-hero-description">{heroEvent.description}</p>
            ) : null}

            {/* Link buttons */}
            <div className="crew-games-hero-links">
              {heroEvent.meetLink ? (
                <a
                  href={heroEvent.meetLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="button button-subtle"
                >
                  <ExternalLink size={14} aria-hidden="true" />
                  {t("links.joinMeet")}
                </a>
              ) : null}
              {heroEvent.kahootLink ? (
                <a
                  href={heroEvent.kahootLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="button button-subtle"
                >
                  <ExternalLink size={14} aria-hidden="true" />
                  {t("links.openKahoot")}
                </a>
              ) : null}
              {heroEvent.altGameLink ? (
                <a
                  href={heroEvent.altGameLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="button button-subtle"
                >
                  <ExternalLink size={14} aria-hidden="true" />
                  {heroEvent.featuredGame
                    ? `Open ${heroEvent.featuredGame.slice(0, 30)}`
                    : t("links.openGame")}
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
        leaderboard={leaderboard}
        adjustments={adjustments}
        season={season}
        isAdmin={isAdmin}
        orgId={orgId}
        onAdjustmentAdded={() => {
          refreshLeaderboard();
          showToast(t("leaderboard.adjustmentSaved"));
        }}
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

      {/* Past events */}
      {completedEvents.length > 0 ? (
        <section className="crew-games-section">
          <h3 className="section-title">{t("event.pastEvents")}</h3>
          <div className="crew-games-event-list">
            {completedEvents.map((event) => (
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

      {/* Empty state */}
      {events.length === 0 && !heroEvent ? (
        <EmptyState
          title={t("event.noEvents")}
          description={t("event.noEventsDescription")}
          icon={<Trophy size={32} aria-hidden="true" />}
          ctaLabel={isAdmin ? t("event.createGamesNight") : undefined}
          onCtaClick={isAdmin ? () => setIsCreateOpen(true) : undefined}
        />
      ) : null}

      {/* Delete confirmation */}
      {deleteConfirmId ? (
        <div className="slide-panel-root" role="presentation">
          <button
            type="button"
            className="slide-panel-backdrop"
            onClick={() => setDeleteConfirmId(null)}
            aria-label="Cancel"
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
                Cancel
              </button>
              <button
                type="button"
                className="button button-danger"
                disabled={mutations.isSaving}
                onClick={() => handleDeleteEvent(deleteConfirmId)}
              >
                {mutations.isSaving ? "Deleting…" : "Delete"}
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
  return (
    <div className="crew-games-event-card dashboard-panel">
      <button
        type="button"
        className="crew-games-event-card-header"
        onClick={onToggleExpand}
        aria-expanded={isExpanded}
      >
        <div className="crew-games-event-card-info">
          <StatusBadge tone={statusTone(event.status)}>
            {event.status}
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
              <strong>Game:</strong> {event.featuredGame}
            </p>
          ) : null}
          {event.description ? (
            <p className="crew-games-event-card-desc">{event.description}</p>
          ) : null}
          {event.highlights ? (
            <p className="crew-games-event-card-highlights">
              <strong>Highlights:</strong> {event.highlights}
            </p>
          ) : null}

          {/* Links */}
          <div className="crew-games-hero-links" style={{ marginTop: "var(--space-2)" }}>
            {event.meetLink ? (
              <a
                href={event.meetLink}
                target="_blank"
                rel="noopener noreferrer"
                className="button button-subtle"
              >
                <ExternalLink size={14} aria-hidden="true" />
                Join Google Meet
              </a>
            ) : null}
            {event.kahootLink ? (
              <a
                href={event.kahootLink}
                target="_blank"
                rel="noopener noreferrer"
                className="button button-subtle"
              >
                <ExternalLink size={14} aria-hidden="true" />
                Open Kahoot
              </a>
            ) : null}
            {event.altGameLink ? (
              <a
                href={event.altGameLink}
                target="_blank"
                rel="noopener noreferrer"
                className="button button-subtle"
              >
                <ExternalLink size={14} aria-hidden="true" />
                {event.featuredGame
                  ? `Open ${event.featuredGame.slice(0, 30)}`
                  : "Open Game"}
              </a>
            ) : null}
          </div>

          <div className="crew-games-event-card-actions">
            <button type="button" className="button" onClick={onViewDetail}>
              View Results
            </button>
            {isAdmin ? (
              <>
                <button type="button" className="button button-ghost" onClick={onEdit}>
                  <Edit2 size={14} aria-hidden="true" /> Edit
                </button>
                <button type="button" className="button button-ghost" onClick={onPostResults}>
                  <Trophy size={14} aria-hidden="true" /> Results
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
