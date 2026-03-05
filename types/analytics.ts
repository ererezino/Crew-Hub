import type { ApiResponse } from "./auth";

/* ── People ── */

export type AnalyticsPeopleDepartmentRow = {
  key: string;
  label: string;
  count: number;
};

export type AnalyticsPeopleCountryRow = {
  key: string;
  count: number;
};

export type AnalyticsPeopleEmploymentTypeRow = {
  key: string;
  count: number;
};

export type AnalyticsPeopleStatusRow = {
  key: string;
  count: number;
};

export type AnalyticsPeopleTrendRow = {
  month: string;
  headcount: number;
  hires: number;
};

export type AnalyticsPeopleSection = {
  metrics: {
    activeHeadcount: number;
    newHires: number;
    departures: number;
    avgTenureMonths: number;
    newHiresThisMonth: number;
    activeDepartments: number;
    activeCountries: number;
  };
  byDepartment: AnalyticsPeopleDepartmentRow[];
  byCountry: AnalyticsPeopleCountryRow[];
  employmentType: AnalyticsPeopleEmploymentTypeRow[];
  statusDistribution: AnalyticsPeopleStatusRow[];
  trend: AnalyticsPeopleTrendRow[];
};

/* ── Time Off ── */

export type AnalyticsTimeOffByTypeRow = {
  key: string;
  totalDays: number;
  requestCount: number;
};

export type AnalyticsTimeOffTrendRow = {
  month: string;
  requestedDays: number;
  approvedDays: number;
};

export type AnalyticsTimeOffCurrentlyOutRow = {
  employeeId: string;
  fullName: string;
  department: string | null;
  countryCode: string | null;
  leaveType: string;
  totalDays: number;
  endDate: string;
};

export type AnalyticsTimeOffByDeptRow = {
  department: string;
  totalAllocated: number;
  totalUsed: number;
  utilizationPct: number;
};

export type AnalyticsTimeOffTopUserRow = {
  employeeId: string;
  fullName: string;
  department: string | null;
  totalDays: number;
  mainType: string;
};

export type AnalyticsTimeOffSection = {
  metrics: {
    totalDaysTaken: number;
    mostCommonType: string | null;
    avgLeaveBalance: number;
    requestedDays: number;
    approvedDays: number;
    pendingRequests: number;
    currentlyOutCount: number;
    utilizationRate: number;
  };
  byType: AnalyticsTimeOffByTypeRow[];
  trend: AnalyticsTimeOffTrendRow[];
  byDepartment: AnalyticsTimeOffByDeptRow[];
  topUsers: AnalyticsTimeOffTopUserRow[];
  currentlyOut: AnalyticsTimeOffCurrentlyOutRow[];
};

/* ── Payroll ── */

export type AnalyticsPayrollTrendRow = {
  month: string;
  totalNet: number;
  totalGross: number;
};

export type AnalyticsPayrollDepartmentRow = {
  key: string;
  label: string;
  totalNet: number;
  employeeCount: number;
  avgNet: number;
};

export type AnalyticsPayrollCountryRow = {
  key: string;
  totalNet: number;
  employeeCount: number;
  avgNet: number;
};

export type AnalyticsPayrollSection = {
  metrics: {
    lastRunGross: number;
    lastRunNet: number;
    avgGrossSalary: number;
    totalAllowances: number;
    totalGross: number;
    totalNet: number;
    totalDeductions: number;
    runCount: number;
    avgNetPerEmployee: number;
  };
  trend: AnalyticsPayrollTrendRow[];
  byDepartment: AnalyticsPayrollDepartmentRow[];
  byCountry: AnalyticsPayrollCountryRow[];
  compensationBands: {
    belowMidpoint: number;
    atMidpoint: number;
    aboveMidpoint: number;
  };
};

/* ── Expenses ── */

export type AnalyticsExpensesCategoryRow = {
  key: string;
  totalAmount: number;
  expenseCount: number;
};

export type AnalyticsExpensesTrendRow = {
  month: string;
  totalAmount: number;
  expenseCount: number;
};

export type AnalyticsExpensesTopSpenderRow = {
  employeeId: string;
  fullName: string;
  department: string | null;
  countryCode: string | null;
  totalAmount: number;
  expenseCount: number;
};

export type AnalyticsExpensesSection = {
  metrics: {
    totalAmount: number;
    reimbursedAmount: number;
    pendingAmount: number;
    avgProcessingDays: number;
    approvedAmount: number;
    expenseCount: number;
  };
  byCategory: AnalyticsExpensesCategoryRow[];
  trend: AnalyticsExpensesTrendRow[];
  topSpenders: AnalyticsExpensesTopSpenderRow[];
};

/* ── Pipeline ── */

export type AnalyticsPipelineSection = {
  onboarding: {
    active: number;
    overdue: number;
  };
  reviewCycles: {
    active: number;
    completionPct: number;
  };
  learning: {
    activeCourses: number;
    completionPct: number;
  };
  complianceHealth: {
    completedOnTimePct: number;
  };
};

/* ── Response Envelope ── */

export type AnalyticsFilterOptions = {
  countries: string[];
  departments: string[];
};

export type AnalyticsResponseData = {
  dateRange: {
    startDate: string;
    endDate: string;
  };
  filterOptions: AnalyticsFilterOptions;
  people: AnalyticsPeopleSection;
  timeOff: AnalyticsTimeOffSection;
  payroll: AnalyticsPayrollSection;
  expenses: AnalyticsExpensesSection;
  pipeline: AnalyticsPipelineSection;
};

export type AnalyticsCsvSection = "people" | "time_off" | "payroll" | "expenses" | "pipeline";

export type AnalyticsResponse = ApiResponse<AnalyticsResponseData>;
