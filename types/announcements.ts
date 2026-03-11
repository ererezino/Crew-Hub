import type { ApiResponse } from "./auth";

export type AnnouncementAttachment = {
  id: string;
  announcementId: string;
  fileName: string;
  filePath: string;
  fileSizeBytes: number;
  mimeType: string;
  createdAt: string;
};

export type Announcement = {
  id: string;
  title: string;
  body: string;
  isPinned: boolean;
  createdBy: string;
  creatorName: string;
  createdAt: string;
  updatedAt: string;
  isRead: boolean;
  readAt: string | null;
  isDismissed: boolean;
  dismissedAt: string | null;
  attachments: AnnouncementAttachment[];
};

export type AnnouncementsResponseData = {
  announcements: Announcement[];
};

export type AnnouncementsResponse = ApiResponse<AnnouncementsResponseData>;

export type AnnouncementMutationResponseData = {
  announcement: Announcement;
};

export type AnnouncementMutationResponse = ApiResponse<AnnouncementMutationResponseData>;

export type AnnouncementReadResponseData = {
  announcementId: string;
  readAt: string;
};

export type AnnouncementReadResponse = ApiResponse<AnnouncementReadResponseData>;

export type AnnouncementDismissResponseData = {
  announcementId: string;
  dismissedAt: string;
};

export type AnnouncementDismissResponse = ApiResponse<AnnouncementDismissResponseData>;
