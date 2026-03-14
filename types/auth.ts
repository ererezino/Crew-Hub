// Canonical role definition lives in lib/navigation.ts.
// These are compatibility re-exports so consumers importing from
// types/auth continue to work without changes.
export { USER_ROLES as APP_ROLES, type UserRole as AppRole } from "../lib/navigation";

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
