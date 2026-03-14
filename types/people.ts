import type { ApiResponse, AppRole } from "./auth";

export const EMPLOYMENT_TYPES = ["full_time", "part_time", "contractor"] as const;

export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

export const PAYROLL_MODES = [
  "contractor_usd_no_withholding",
  "employee_local_withholding",
  "employee_usd_withholding"
] as const;

export type PayrollMode = (typeof PAYROLL_MODES)[number];

export const PROFILE_STATUSES = [
  "active",
  "inactive",
  "onboarding",
  "offboarding"
] as const;

export type ProfileStatus = (typeof PROFILE_STATUSES)[number];

export type PrivacySettings = {
  showEmail?: boolean;
  showPhone?: boolean;
  showDepartment?: boolean;
  showBio?: boolean;
  showInterests?: boolean;
};

export type PersonRecord = {
  id: string;
  email: string;
  fullName: string;
  roles: AppRole[];
  department: string | null;
  title: string | null;
  countryCode: string | null;
  timezone: string | null;
  phone: string | null;
  startDate: string | null;
  dateOfBirth: string | null;
  managerId: string | null;
  managerName: string | null;
  teamLeadId: string | null;
  teamLeadName: string | null;
  employmentType: EmploymentType;
  payrollMode: PayrollMode;
  primaryCurrency: string;
  status: ProfileStatus;
  noticePeriodEndDate: string | null;
  avatarUrl: string | null;
  bio: string | null;
  favoriteMusic: string | null;
  favoriteBooks: string | null;
  favoriteSports: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  emergencyContactRelationship: string | null;
  pronouns: string | null;
  socialLinkedin: string | null;
  socialTwitter: string | null;
  socialInstagram: string | null;
  socialGithub: string | null;
  socialWebsite: string | null;
  directoryVisible: boolean;
  privacySettings: PrivacySettings;
  scheduleType: string | null;
  weekendShiftHours: string | null;
  crewTag: string | null;
  accessStatus: "signed_in" | "invited" | "not_invited";
  crewHubJoinedAt: string | null;
  firstInvitedAt: string | null;
  accountSetupAt: string | null;
  lastSeenAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PeopleListResponseData = {
  people: PersonRecord[];
};

export type PeopleListResponse = ApiResponse<PeopleListResponseData>;

export type PeopleCreateResponseData = {
  person: PersonRecord;
};

export type PeopleCreateResponse = ApiResponse<PeopleCreateResponseData>;

export type PeopleAccessOverrides = {
  granted: string[];
  revoked: string[];
};

export type PeopleCreatePayload = {
  email: string;
  fullName: string;
  roles: AppRole[];
  department?: string;
  title?: string;
  countryCode?: string;
  timezone?: string;
  phone?: string;
  startDate?: string;
  managerId?: string;
  employmentType: EmploymentType;
  payrollMode?: PayrollMode;
  primaryCurrency: string;
  isNewEmployee?: boolean;
  accessOverrides?: PeopleAccessOverrides;
};

export type PeopleUpdatePayload = {
  fullName?: string;
  roles?: AppRole[];
  department?: string | null;
  title?: string | null;
  startDate?: string | null;
  dateOfBirth?: string | null;
  managerId?: string | null;
  status?: ProfileStatus;
  accessOverrides?: PeopleAccessOverrides;
  phone?: string | null;
  timezone?: string | null;
  pronouns?: string | null;
  emergencyContactName?: string | null;
  emergencyContactPhone?: string | null;
  emergencyContactRelationship?: string | null;
  avatarUrl?: string | null;
  bio?: string | null;
  favoriteMusic?: string | null;
  favoriteBooks?: string | null;
  favoriteSports?: string | null;
  socialLinkedin?: string | null;
  socialTwitter?: string | null;
  socialInstagram?: string | null;
  socialGithub?: string | null;
  socialWebsite?: string | null;
  directoryVisible?: boolean;
  privacySettings?: PrivacySettings;
};

export type PeopleUpdateResponseData = {
  person: PersonRecord;
};

export type PeopleUpdateResponse = ApiResponse<PeopleUpdateResponseData>;

export type PeopleInviteResponseData = {
  personId: string;
  email: string;
  inviteSent: boolean;
  isResend: boolean;
  inviteLink: string | null;
};

export type PeopleInviteResponse = ApiResponse<PeopleInviteResponseData>;

export type PeoplePasswordResetResponseData = {
  userId: string;
  resetInitiated: boolean;
  setupLink?: string | null;
};

export type PeoplePasswordResetResponse = ApiResponse<PeoplePasswordResetResponseData>;

/* ── The Crew (social team page) ── */

/** Public-facing crew member profile shown on The Crew page. */
export type CrewMember = {
  id: string;
  fullName: string;
  title: string | null;
  department: string | null;
  avatarUrl: string | null;
  bio: string | null;
  pronouns: string | null;
  countryCode: string | null;
  startDate: string | null;
  favoriteMusic: string | null;
  favoriteBooks: string | null;
  favoriteSports: string | null;
  socialLinkedin: string | null;
  socialTwitter: string | null;
  socialInstagram: string | null;
  socialGithub: string | null;
  socialWebsite: string | null;
};

export type CrewListResponseData = {
  members: CrewMember[];
  departmentCounts: Record<string, number>;
  totalCount: number;
};

export type CrewListResponse = ApiResponse<CrewListResponseData>;

export type CrewModeratePayload = {
  bio?: string | null;
  socialLinkedin?: string | null;
  socialTwitter?: string | null;
  socialInstagram?: string | null;
  socialGithub?: string | null;
  socialWebsite?: string | null;
  favoriteMusic?: string | null;
  favoriteBooks?: string | null;
  favoriteSports?: string | null;
  avatarUrl?: string | null;
  directoryVisible?: boolean;
};

export type CrewModerateResponse = ApiResponse<{ updated: true }>;
