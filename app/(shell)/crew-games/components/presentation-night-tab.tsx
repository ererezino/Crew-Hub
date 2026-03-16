"use client";

import { useTranslations } from "next-intl";
import { useCallback, useMemo, useState } from "react";
import {
  Calendar,
  ChevronDown,
  ChevronUp,
  Download,
  Edit2,
  Mic2,
  Plus,
  Trash2,
  Trophy
} from "lucide-react";

import { SlidePanel } from "../../../../components/shared/slide-panel";
import { StatusBadge } from "../../../../components/shared/status-badge";
import {
  useCrewGameEvents,
  useCrewGamesMutations,
  useCrewGameEventDetail
} from "../../../../hooks/use-crew-games";
import type { CrewNightEvent, CrewNightPresenter } from "../../../../types/crew-games";
import { EventFormPanel } from "./event-form-panel";
import { PresentersFormPanel } from "./presenters-form-panel";

type PresentationNightTabProps = {
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

export function PresentationNightTab({ orgId, currentUserId, isAdmin }: PresentationNightTabProps) {
  const t = useTranslations("crewGames");
  const { events, isLoading, refresh } = useCrewGameEvents("presentation_night");
  const mutations = useCrewGamesMutations();

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<CrewNightEvent | null>(null);
  const [presentersEventId, setPresentersEventId] = useState<string | null>(null);
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [expandedYears, setExpandedYears] = useState<Record<string, boolean>>({});

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }, []);

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

  const handlePresentersSaved = useCallback(() => {
    setPresentersEventId(null);
    refresh();
    showToast(t("presenters.saved"));
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
            {t("event.createPresentationNight")}
          </button>
        </div>
      ) : null}

      {/* Hero section */}
      {heroEvent ? (
        <PresentationHero
          event={heroEvent}
          isAdmin={isAdmin}
          onEdit={() => setEditingEvent(heroEvent)}
          onEditPresenters={() => setPresentersEventId(heroEvent.id)}
        />
      ) : null}

      {/* Draft events (admin only) */}
      {isAdmin && draftEvents.length > 0 ? (
        <section className="crew-games-section">
          <h3 className="section-title">{t("event.draft")}</h3>
          <div className="crew-games-event-list">
            {draftEvents.map((event) => (
              <PresentationEventCard
                key={event.id}
                event={event}
                isAdmin={isAdmin}
                isExpanded={expandedEventId === event.id}
                onToggleExpand={() =>
                  setExpandedEventId(expandedEventId === event.id ? null : event.id)
                }
                onEdit={() => setEditingEvent(event)}
                onEditPresenters={() => setPresentersEventId(event.id)}
                onDelete={() => setDeleteConfirmId(event.id)}
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
                    <PresentationEventCard
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
                      onEditPresenters={() => setPresentersEventId(event.id)}
                      onDelete={() => setDeleteConfirmId(event.id)}
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
      {events.length === 0 ? (
        <div className="crew-games-empty-state">
          <Mic2 size={32} aria-hidden="true" className="crew-games-empty-state-icon" />
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
              {t("event.createPresentationNight")}
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
              <button type="button" className="button" onClick={() => setDeleteConfirmId(null)}>
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
        title={t("event.createPresentationNight")}
        onClose={() => setIsCreateOpen(false)}
      >
        <EventFormPanel
          eventType="presentation_night"
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
            eventType="presentation_night"
            orgId={orgId}
            existingEvent={editingEvent}
            onSaved={handleEventUpdated}
            onCancel={() => setEditingEvent(null)}
          />
        ) : null}
      </SlidePanel>

      {/* Presenters panel */}
      <SlidePanel
        isOpen={Boolean(presentersEventId)}
        title={t("presenters.editPresenters")}
        onClose={() => setPresentersEventId(null)}
      >
        {presentersEventId ? (
          <PresentersFormPanel
            eventId={presentersEventId}
            orgId={orgId}
            onSaved={handlePresentersSaved}
            onCancel={() => setPresentersEventId(null)}
          />
        ) : null}
      </SlidePanel>
    </div>
  );
}

/* ── Presentation Hero ── */

function PresentationHero({
  event,
  isAdmin,
  onEdit,
  onEditPresenters
}: {
  event: CrewNightEvent;
  isAdmin: boolean;
  onEdit: () => void;
  onEditPresenters: () => void;
}) {
  const t = useTranslations("crewGames");
  const { presenters } = useCrewGameEventDetail(event.id);
  const winner = presenters.find((p) => p.isWinner);

  return (
    <section
      className="crew-games-hero crew-games-hero-presentation"
      aria-label={event.title}
      style={
        event.eventImagePath
          ? { position: "relative" as const, overflow: "hidden" as const }
          : undefined
      }
    >
      {event.eventImagePath ? (
        <div
          className="crew-games-hero-image-bg"
          style={{
            backgroundImage: `url(${eventImageUrl(event.eventImagePath)})`
          }}
        />
      ) : null}
      <div className="crew-games-hero-content">
        <div className="crew-games-hero-meta">
          <StatusBadge tone={statusTone(event.status)}>
            {t(`event.${event.status}`)}
          </StatusBadge>
          <span className="crew-games-hero-date">
            <Calendar size={14} aria-hidden="true" />
            {formatEventDate(event.eventDate)}
          </span>
        </div>
        <h2 className="crew-games-hero-title">{event.title}</h2>
        {event.description ? (
          <p className="crew-games-hero-description">{event.description}</p>
        ) : null}

        {/* Winner showcase */}
        {winner ? (
          <div className="crew-games-winner-showcase">
            <Trophy size={20} aria-hidden="true" className="crew-games-winner-icon" />
            <div className="crew-games-winner-info">
              <p className="crew-games-winner-name">{winner.employeeName}</p>
              {winner.talkTitle ? (
                <p className="crew-games-winner-talk">&ldquo;{winner.talkTitle}&rdquo;</p>
              ) : null}
              <p className="crew-games-winner-votes">{winner.voteCount} {t("presenters.votes").toLowerCase()}</p>
            </div>
          </div>
        ) : null}

        {/* Presenter list */}
        {presenters.length > 0 ? (
          <div className="crew-games-presenter-chips">
            {presenters.map((p) => (
              <span key={p.id} className="crew-games-presenter-chip">
                {p.employeeName}
                {p.slidePath ? (
                  <a
                    href={`/api/v1/crew-games/download?path=${encodeURIComponent(p.slidePath)}`}
                    className="crew-games-slide-link"
                    title={t("presenters.downloadSlides")}
                  >
                    <Download size={12} aria-hidden="true" />
                  </a>
                ) : null}
              </span>
            ))}
          </div>
        ) : null}

        {isAdmin ? (
          <div className="crew-games-hero-admin">
            <button type="button" className="button button-ghost" onClick={onEdit}>
              <Edit2 size={14} aria-hidden="true" /> {t("event.edit")}
            </button>
            <button type="button" className="button button-ghost" onClick={onEditPresenters}>
              <Mic2 size={14} aria-hidden="true" /> {t("event.presenters")}
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}

/* ── Presentation Event Card ── */

function PresentationEventCard({
  event,
  isAdmin,
  isExpanded,
  onToggleExpand,
  onEdit,
  onEditPresenters,
  onDelete
}: {
  event: CrewNightEvent;
  isAdmin: boolean;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onEdit: () => void;
  onEditPresenters: () => void;
  onDelete: () => void;
}) {
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
        <PresentationCardBody
          event={event}
          isAdmin={isAdmin}
          onEdit={onEdit}
          onEditPresenters={onEditPresenters}
          onDelete={onDelete}
        />
      ) : null}
    </div>
  );
}

function PresentationCardBody({
  event,
  isAdmin,
  onEdit,
  onEditPresenters,
  onDelete
}: {
  event: CrewNightEvent;
  isAdmin: boolean;
  onEdit: () => void;
  onEditPresenters: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations("crewGames");
  const { presenters } = useCrewGameEventDetail(event.id);

  return (
    <div className="crew-games-event-card-body">
      {event.description ? (
        <p className="crew-games-event-card-desc">{event.description}</p>
      ) : null}

      {/* Presenters */}
      {presenters.length > 0 ? (
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
                <span className="crew-games-presenter-votes">{p.voteCount} {t("presenters.votes").toLowerCase()}</span>
                {p.slidePath ? (
                  <a
                    href={`/api/v1/crew-games/download?path=${encodeURIComponent(p.slidePath)}`}
                    className="button button-ghost button-sm"
                    title={t("presenters.downloadSlides")}
                  >
                    <Download size={14} aria-hidden="true" />
                    {t("presenters.slidesLabel")}
                  </a>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {event.highlights ? (
        <p className="crew-games-event-card-highlights">
          <strong>{t("event.highlights")}</strong> {event.highlights}
        </p>
      ) : null}

      {isAdmin ? (
        <div className="crew-games-event-card-actions">
          <button type="button" className="button button-ghost" onClick={onEdit}>
            <Edit2 size={14} aria-hidden="true" /> {t("event.edit")}
          </button>
          <button type="button" className="button button-ghost" onClick={onEditPresenters}>
            <Mic2 size={14} aria-hidden="true" /> {t("event.presenters")}
          </button>
          <button type="button" className="table-row-action table-row-action-danger" onClick={onDelete}>
            <Trash2 size={14} aria-hidden="true" />
          </button>
        </div>
      ) : null}
    </div>
  );
}
