"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { useCrewGamesMutations } from "../../../../hooks/use-crew-games";
import type { CrewNightEvent, CrewNightEventType } from "../../../../types/crew-games";

type EventFormPanelProps = {
  eventType: CrewNightEventType;
  orgId: string;
  existingEvent?: CrewNightEvent;
  onSaved: () => void;
  onCancel: () => void;
};

export function EventFormPanel({
  eventType,
  orgId,
  existingEvent,
  onSaved,
  onCancel
}: EventFormPanelProps) {
  const t = useTranslations("crewGames.event");
  const mutations = useCrewGamesMutations();

  const isEdit = Boolean(existingEvent);

  const [title, setTitle] = useState(existingEvent?.title ?? "");
  const [eventDate, setEventDate] = useState(existingEvent?.eventDate ?? "");
  const [status, setStatus] = useState(existingEvent?.status ?? "draft");
  const [description, setDescription] = useState(existingEvent?.description ?? "");
  const [meetLink, setMeetLink] = useState(existingEvent?.meetLink ?? "");
  const [kahootLink, setKahootLink] = useState(existingEvent?.kahootLink ?? "");
  const [altGameLink, setAltGameLink] = useState(existingEvent?.altGameLink ?? "");
  const [featuredGame, setFeaturedGame] = useState(existingEvent?.featuredGame ?? "");
  const [highlights, setHighlights] = useState(existingEvent?.highlights ?? "");
  const [error, setError] = useState<string | null>(null);

  const isGamesNight = eventType === "games_night";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!title.trim() || !eventDate) {
      setError("Title and date are required.");
      return;
    }

    const payload: Record<string, unknown> = {
      title: title.trim(),
      eventDate,
      status,
      description: description.trim() || null,
      highlights: highlights.trim() || null
    };

    if (isGamesNight) {
      payload.meetLink = meetLink.trim() || null;
      payload.kahootLink = kahootLink.trim() || null;
      payload.altGameLink = altGameLink.trim() || null;
      payload.featuredGame = featuredGame.trim() || null;
    }

    if (!isEdit) {
      payload.eventType = eventType;
    }

    try {
      if (isEdit && existingEvent) {
        await mutations.updateEvent(existingEvent.id, payload);
      } else {
        await mutations.createEvent(payload);
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save.");
    }
  };

  return (
    <form className="slide-panel-form-wrapper" onSubmit={handleSubmit} noValidate>
      <div className="form-field">
        <label className="form-label">{t("title")}</label>
        <input
          type="text"
          className="form-input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
          required
        />
      </div>

      <div className="form-field">
        <label className="form-label">{t("date")}</label>
        <input
          type="date"
          className="form-input"
          value={eventDate}
          onChange={(e) => setEventDate(e.target.value)}
          required
        />
      </div>

      <div className="form-field">
        <label className="form-label">{t("status")}</label>
        <select
          className="form-input"
          value={status}
          onChange={(e) => setStatus(e.target.value as "draft" | "upcoming" | "completed")}
        >
          <option value="draft">{t("draft")}</option>
          <option value="upcoming">{t("upcoming")}</option>
          <option value="completed">{t("completed")}</option>
        </select>
        {status === "upcoming" && !existingEvent?.publishedAt ? (
          <p className="form-field-hint">
            Setting status to Upcoming will announce this event to the entire company.
          </p>
        ) : null}
      </div>

      <div className="form-field">
        <label className="form-label">{t("description")}</label>
        <textarea
          className="form-input"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          maxLength={2000}
        />
      </div>

      {isGamesNight ? (
        <>
          <div className="form-field">
            <label className="form-label">{t("featuredGame")}</label>
            <input
              type="text"
              className="form-input"
              value={featuredGame}
              onChange={(e) => setFeaturedGame(e.target.value)}
              maxLength={200}
            />
          </div>

          <div className="form-field">
            <label className="form-label">{t("meetLink")}</label>
            <input
              type="url"
              className="form-input"
              value={meetLink}
              onChange={(e) => setMeetLink(e.target.value)}
              placeholder="https://meet.google.com/..."
            />
          </div>

          <div className="form-field">
            <label className="form-label">{t("kahootLink")}</label>
            <input
              type="url"
              className="form-input"
              value={kahootLink}
              onChange={(e) => setKahootLink(e.target.value)}
              placeholder="https://kahoot.it/..."
            />
          </div>

          <div className="form-field">
            <label className="form-label">{t("altGameLink")}</label>
            <input
              type="url"
              className="form-input"
              value={altGameLink}
              onChange={(e) => setAltGameLink(e.target.value)}
              placeholder="https://..."
            />
          </div>
        </>
      ) : null}

      <div className="form-field">
        <label className="form-label">{t("highlights")}</label>
        <textarea
          className="form-input"
          value={highlights}
          onChange={(e) => setHighlights(e.target.value)}
          rows={3}
          maxLength={5000}
          placeholder="Fun moments, memorable quotes, or notes from the night…"
        />
      </div>

      {error ? <p className="form-field-error">{error}</p> : null}

      <div className="slide-panel-actions">
        <button type="button" className="button" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="button button-primary" disabled={mutations.isSaving}>
          {mutations.isSaving ? "Saving…" : isEdit ? "Save Changes" : "Create Event"}
        </button>
      </div>
    </form>
  );
}
