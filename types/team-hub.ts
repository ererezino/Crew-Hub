export const TEAM_HUB_VISIBILITIES = ["department", "org_wide", "private"] as const;
export type TeamHubVisibility = (typeof TEAM_HUB_VISIBILITIES)[number];

export const TEAM_HUB_PAGE_TYPES = [
  "document",
  "contact_list",
  "reference_list",
  "runbook",
  "table",
  "link"
] as const;
export type TeamHubPageType = (typeof TEAM_HUB_PAGE_TYPES)[number];

export type TeamHub = {
  id: string;
  orgId: string;
  department: string | null;
  name: string;
  description: string | null;
  coverImageUrl: string | null;
  icon: string | null;
  visibility: TeamHubVisibility;
  createdBy: string | null;
  sectionCount?: number;
  pageCount?: number;
};

export type TeamHubSection = {
  id: string;
  hubId: string;
  name: string;
  description: string | null;
  icon: string | null;
  coverImageUrl: string | null;
  sortOrder: number;
  pageCount?: number;
};

export type TeamHubPage = {
  id: string;
  sectionId: string;
  title: string;
  content: string | null;
  pageType: TeamHubPageType;
  structuredData: unknown;
  coverImageUrl: string | null;
  icon: string | null;
  pinned: boolean;
  createdBy: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type TeamHubListResponseData = {
  hubs: TeamHub[];
};

export type TeamHubDetailResponseData = {
  hub: TeamHub;
};

export type TeamHubSectionListResponseData = {
  sections: TeamHubSection[];
};

export type TeamHubSectionDetailResponseData = {
  section: TeamHubSection;
};

export type TeamHubPageListResponseData = {
  pages: TeamHubPage[];
};

export type TeamHubPageDetailResponseData = {
  page: TeamHubPage;
};
