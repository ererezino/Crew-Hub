import type { ApiResponse } from "./auth";

export const COMPENSATION_BAND_LOCATION_TYPES = [
  "global",
  "country",
  "city",
  "zone"
] as const;

export type CompensationBandLocationType =
  (typeof COMPENSATION_BAND_LOCATION_TYPES)[number];

export type CompensationBandRecord = {
  id: string;
  orgId: string;
  title: string;
  level: string | null;
  department: string | null;
  locationType: CompensationBandLocationType;
  locationValue: string | null;
  currency: string;
  minSalaryAmount: number;
  midSalaryAmount: number;
  maxSalaryAmount: number;
  equityMin: number | null;
  equityMax: number | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  createdAt: string;
  updatedAt: string;
  assignedEmployeeCount: number;
};

export type BenchmarkDataRecord = {
  id: string;
  orgId: string;
  source: string;
  title: string;
  level: string | null;
  location: string | null;
  currency: string;
  p25: number | null;
  p50: number | null;
  p75: number | null;
  p90: number | null;
  importedAt: string;
};

export type CompensationBandAssignmentRecord = {
  id: string;
  orgId: string;
  bandId: string;
  employeeId: string;
  employeeName: string;
  bandLabel: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  assignedAt: string;
};

export type CompensationBandEmployeeOption = {
  id: string;
  fullName: string;
  title: string | null;
  department: string | null;
  countryCode: string | null;
  employmentType: "full_time" | "part_time" | "contractor";
  status: "active" | "inactive" | "onboarding" | "offboarding";
};

export const COMPENSATION_BAND_ALERT_STATUSES = [
  "below_band",
  "above_band",
  "missing_salary"
] as const;

export type CompensationBandAlertStatus =
  (typeof COMPENSATION_BAND_ALERT_STATUSES)[number];

export type CompensationBandAlertRecord = {
  employeeId: string;
  employeeName: string;
  employeeTitle: string | null;
  employeeDepartment: string | null;
  countryCode: string | null;
  bandId: string;
  bandLabel: string;
  currency: string;
  currentSalaryAmount: number | null;
  minSalaryAmount: number;
  midSalaryAmount: number;
  maxSalaryAmount: number;
  compaRatio: number | null;
  status: CompensationBandAlertStatus;
};

export type CompensationBandsResponseData = {
  bands: CompensationBandRecord[];
  benchmarks: BenchmarkDataRecord[];
  assignments: CompensationBandAssignmentRecord[];
  employeeOptions: CompensationBandEmployeeOption[];
  alerts: CompensationBandAlertRecord[];
};

export type CompensationBandsResponse = ApiResponse<CompensationBandsResponseData>;

export type CompensationBandCreateResponseData = {
  band: CompensationBandRecord;
};

export type CompensationBandCreateResponse =
  ApiResponse<CompensationBandCreateResponseData>;

export type BenchmarkCreateResponseData = {
  benchmark: BenchmarkDataRecord;
};

export type BenchmarkCreateResponse = ApiResponse<BenchmarkCreateResponseData>;

export type CompensationBandAssignmentCreateResponseData = {
  assignment: CompensationBandAssignmentRecord;
};

export type CompensationBandAssignmentCreateResponse =
  ApiResponse<CompensationBandAssignmentCreateResponseData>;
