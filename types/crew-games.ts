import type { ApiResponse } from "./auth";

/* ── Event types ── */

export const EVENT_TYPES = ["games_night", "presentation_night"] as const;
export type CrewNightEventType = (typeof EVENT_TYPES)[number];

export const EVENT_STATUSES = ["draft", "upcoming", "completed"] as const;
export type CrewNightEventStatus = (typeof EVENT_STATUSES)[number];

export type CrewNightEvent = {
  id: string;
  orgId: string;
  eventType: CrewNightEventType;
  title: string;
  eventDate: string;
  status: CrewNightEventStatus;
  description: string | null;
  meetLink: string | null;
  kahootLink: string | null;
  altGameLink: string | null;
  featuredGame: string | null;
  eventImagePath: string | null;
  highlights: string | null;
  publishedAt: string | null;
  resultsPublishedAt: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

/* ── Results ── */

export type CrewNightResult = {
  id: string;
  eventId: string;
  nickname: string;
  employeeId: string | null;
  employeeName: string | null;
  score: number | null;
  placement: number | null;
  pointsAwarded: number;
};

/* ── Leaderboard ── */

export type LeaderboardEntry = {
  employeeId: string;
  employeeName: string;
  avatarUrl: string | null;
  totalPoints: number;
  gamesPlayed: number;
  wins: number;
};

export type LeaderboardAdjustment = {
  id: string;
  employeeId: string;
  employeeName: string;
  season: string;
  pointsDelta: number;
  reason: string;
  createdBy: string;
  createdAt: string;
};

/* ── Presenters ── */

export type CrewNightPresenter = {
  id: string;
  eventId: string;
  employeeId: string;
  employeeName: string;
  avatarUrl: string | null;
  talkTitle: string | null;
  slidePath: string | null;
  slideFilename: string | null;
  voteCount: number;
  isWinner: boolean;
};

/* ── Composed views ── */

export type CrewNightEventWithResults = CrewNightEvent & {
  results: CrewNightResult[];
};

export type CrewNightEventWithPresenters = CrewNightEvent & {
  presenters: CrewNightPresenter[];
};

/* ── API response types ── */

export type CrewGamesEventsResponseData = {
  events: CrewNightEvent[];
};

export type CrewGamesEventDetailResponseData = {
  event: CrewNightEvent;
  results: CrewNightResult[];
  presenters: CrewNightPresenter[];
};

export type CrewGamesLeaderboardResponseData = {
  leaderboard: LeaderboardEntry[];
  adjustments: LeaderboardAdjustment[];
  season: string;
};

export type CrewGamesEventsResponse = ApiResponse<CrewGamesEventsResponseData>;
export type CrewGamesEventDetailResponse = ApiResponse<CrewGamesEventDetailResponseData>;
export type CrewGamesLeaderboardResponse = ApiResponse<CrewGamesLeaderboardResponseData>;

/* ── Upload constants ── */

export const EVENT_IMAGE_MAX_BYTES = 5 * 1024 * 1024; // 5 MB
export const SLIDES_MAX_BYTES = 25 * 1024 * 1024; // 25 MB

export const ALLOWED_IMAGE_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp"
] as const;

export const ALLOWED_IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp"] as const;

export const ALLOWED_SLIDES_MIME_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation"
] as const;

export const ALLOWED_SLIDES_EXTENSIONS = ["pdf", "pptx"] as const;

export const CREW_NIGHTS_BUCKET = "crew-nights";
