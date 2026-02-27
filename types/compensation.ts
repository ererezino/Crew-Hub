import type { ApiResponse } from "./auth";

export const COMPENSATION_PAY_FREQUENCIES = [
  "weekly",
  "biweekly",
  "monthly",
  "quarterly",
  "annual"
] as const;

export type CompensationPayFrequency = (typeof COMPENSATION_PAY_FREQUENCIES)[number];

export const COMPENSATION_EMPLOYMENT_TYPES = [
  "full_time",
  "part_time",
  "contractor"
] as const;

export type CompensationEmploymentType = (typeof COMPENSATION_EMPLOYMENT_TYPES)[number];

export const ALLOWANCE_TYPES = [
  "housing",
  "transport",
  "communication",
  "meal",
  "internet",
  "wellness",
  "other"
] as const;

export type AllowanceType = (typeof ALLOWANCE_TYPES)[number];

export const EQUITY_GRANT_TYPES = ["ISO", "NSO", "RSU"] as const;

export type EquityGrantType = (typeof EQUITY_GRANT_TYPES)[number];

export const EQUITY_GRANT_STATUSES = [
  "draft",
  "active",
  "cancelled",
  "vested",
  "terminated"
] as const;

export type EquityGrantStatus = (typeof EQUITY_GRANT_STATUSES)[number];

export type CompensationEmployeeSummary = {
  id: string;
  fullName: string;
  department: string | null;
  title: string | null;
  countryCode: string | null;
  employmentType: CompensationEmploymentType;
  payrollMode: string;
  primaryCurrency: string;
};

export type CompensationRecord = {
  id: string;
  employeeId: string;
  orgId: string;
  baseSalaryAmount: number;
  currency: string;
  payFrequency: CompensationPayFrequency;
  employmentType: CompensationEmploymentType;
  effectiveFrom: string;
  effectiveTo: string | null;
  approvedBy: string | null;
  approvedByName: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AllowanceRecord = {
  id: string;
  employeeId: string;
  orgId: string;
  type: AllowanceType;
  label: string;
  amount: number;
  currency: string;
  isTaxable: boolean;
  effectiveFrom: string;
  effectiveTo: string | null;
  createdAt: string;
  updatedAt: string;
};

export type EquityGrantRecord = {
  id: string;
  employeeId: string;
  orgId: string;
  grantType: EquityGrantType;
  numberOfShares: number;
  exercisePriceCents: number | null;
  grantDate: string;
  vestingStartDate: string;
  cliffMonths: number;
  vestingDurationMonths: number;
  schedule: "monthly";
  status: EquityGrantStatus;
  approvedBy: string | null;
  approvedByName: string | null;
  boardApprovalDate: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CompensationSnapshot = {
  employee: CompensationEmployeeSummary;
  salaryRecords: CompensationRecord[];
  allowances: AllowanceRecord[];
  equityGrants: EquityGrantRecord[];
};

export type MeCompensationResponseData = CompensationSnapshot;

export type MeCompensationResponse = ApiResponse<MeCompensationResponseData>;

export type AdminCompensationEmployeeOption = {
  id: string;
  fullName: string;
  department: string | null;
  countryCode: string | null;
};

export type AdminCompensationResponseData = {
  employees: AdminCompensationEmployeeOption[];
  selectedEmployee: CompensationEmployeeSummary | null;
  salaryRecords: CompensationRecord[];
  allowances: AllowanceRecord[];
  equityGrants: EquityGrantRecord[];
};

export type AdminCompensationResponse = ApiResponse<AdminCompensationResponseData>;

export type CompensationMutationResponseData = {
  employeeId: string;
  salaryRecord?: CompensationRecord;
  allowance?: AllowanceRecord;
  equityGrant?: EquityGrantRecord;
};

export type CompensationMutationResponse = ApiResponse<CompensationMutationResponseData>;
