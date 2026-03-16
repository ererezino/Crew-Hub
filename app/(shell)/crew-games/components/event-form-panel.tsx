"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Trash2, Upload } from "lucide-react";

import { useCrewGamesMutations } from "../../../../hooks/use-crew-games";
import type { CrewNightEvent, CrewNightEventType } from "../../../../types/crew-games";
import {
  ALLOWED_IMAGE_MIME_TYPES,
  EVENT_IMAGE_MAX_BYTES
} from "../../../../types/crew-games";

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
  const tCommon = useTranslations("crewGames");
  const tUpload = useTranslations("crewGames.upload");
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

  // Image upload state
  const [pendingImage, setPendingImage] = useState<File | null>(null);
  const [existingImagePath, setExistingImagePath] = useState<string | null>(
    existingEvent?.eventImagePath ?? null
  );
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isGamesNight = eventType === "games_night";

  // Generate preview URL for pending image
  const imagePreviewUrl = useMemo(() => {
    if (!pendingImage) return null;
    return URL.createObjectURL(pendingImage);
  }, [pendingImage]);

  // Revoke object URL on cleanup
  useEffect(() => {
    return () => {
      if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
    };
  }, [imagePreviewUrl]);

  const handleFileSelect = useCallback(
    (file: File) => {
      // Validate type
      if (!ALLOWED_IMAGE_MIME_TYPES.includes(file.type as (typeof ALLOWED_IMAGE_MIME_TYPES)[number])) {
        setError(tUpload("invalidFileType"));
        return;
      }
      // Validate size
      if (file.size > EVENT_IMAGE_MAX_BYTES) {
        setError(tUpload("fileTooLarge"));
        return;
      }
      setError(null);
      setPendingImage(file);
      setExistingImagePath(null);
    },
    [tUpload]
  );

  const handleRemoveImage = useCallback(() => {
    setPendingImage(null);
    setExistingImagePath(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file) handleFileSelect(file);
    },
    [handleFileSelect]
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!title.trim() || !eventDate) {
      setError("Title and date are required.");
      return;
    }

    try {
      // Upload image if pending
      let eventImagePath: string | null | undefined;

      if (pendingImage) {
        const uploadPath = `${orgId}/event-images`;
        const result = await mutations.uploadFile(pendingImage, "event_image", uploadPath);
        if (result) {
          eventImagePath = result.path;
        }
      } else if (existingEvent?.eventImagePath && !existingImagePath) {
        // Image was removed
        eventImagePath = null;
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

      if (eventImagePath !== undefined) {
        payload.eventImagePath = eventImagePath;
      }

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

  // Existing image preview URL
  const existingPreviewUrl = existingImagePath
    ? `/api/v1/crew-games/download?path=${encodeURIComponent(existingImagePath)}&inline=true`
    : null;

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
            {t("upcomingHint")}
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

      {/* Event image upload */}
      <div className="form-field">
        <label className="form-label">{tCommon("eventImage")}</label>
        {existingPreviewUrl && !pendingImage ? (
          <div className="crew-games-image-preview">
            <img src={existingPreviewUrl} alt="" className="crew-games-image-preview-img" />
            <button
              type="button"
              className="button button-ghost button-sm crew-games-image-remove-btn"
              onClick={handleRemoveImage}
            >
              <Trash2 size={14} aria-hidden="true" />
              {tCommon("removeImage")}
            </button>
          </div>
        ) : imagePreviewUrl ? (
          <div className="crew-games-image-preview">
            <img src={imagePreviewUrl} alt="" className="crew-games-image-preview-img" />
            <button
              type="button"
              className="button button-ghost button-sm crew-games-image-remove-btn"
              onClick={handleRemoveImage}
            >
              <Trash2 size={14} aria-hidden="true" />
              {tCommon("removeImage")}
            </button>
          </div>
        ) : (
          <div
            className="crew-games-image-upload-zone"
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                fileInputRef.current?.click();
              }
            }}
          >
            <Upload size={24} aria-hidden="true" />
            <span>{tCommon("uploadImage")}</span>
            <span className="form-field-hint">{tUpload("imageHint")}</span>
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept={ALLOWED_IMAGE_MIME_TYPES.join(",")}
          style={{ display: "none" }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFileSelect(file);
          }}
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
        />
      </div>

      {error ? <p className="form-field-error">{error}</p> : null}

      <div className="slide-panel-actions">
        <button type="button" className="button" onClick={onCancel}>
          {tCommon("cancel")}
        </button>
        <button type="submit" className="button button-primary" disabled={mutations.isSaving}>
          {mutations.isSaving ? tCommon("saving") : isEdit ? t("saveChanges") : t("createEvent")}
        </button>
      </div>
    </form>
  );
}
