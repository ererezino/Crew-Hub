export const APP_ROLES = [
  "EMPLOYEE",
  "TEAM_LEAD",
  "MANAGER",
  "HR_ADMIN",
  "FINANCE_ADMIN",
  "SUPER_ADMIN"
] as const;

export type AppRole = (typeof APP_ROLES)[number];

export type RoleAwareProfile = {
  roles: readonly string[] | null;
};

export type ApiError = {
  code: string;
  message: string;
};

export type ApiMeta = {
  timestamp: string;
};

export type ApiResponse<T> = {
  data: T | null;
  error: ApiError | null;
  meta: ApiMeta;
};

export type MeProfile = {
  id: string;
  org_id: string;
  email: string;
  full_name: string;
  avatar_url: string | null;
  roles: string[];
  payroll_mode: string;
  primary_currency: string;
  employment_type: string;
  status: string;
  country_code: string | null;
  timezone: string | null;
};

export type MeOrg = {
  id: string;
  name: string;
  logo_url: string | null;
};

export type MeResponseData = {
  profile: MeProfile;
  org: MeOrg;
};
