import type { ApiResponse } from "./auth";

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

export type AnalyticsPeopleTrendRow = {
  month: string;
  headcount: number;
  hires: number;
};

export type AnalyticsPeopleSection = {
  metrics: {
    activeHeadcount: number;
    newHires: number;
    activeDepartments: number;
    activeCountries: number;
  };
  byDepartment: AnalyticsPeopleDepartmentRow[];
  byCountry: AnalyticsPeopleCountryRow[];
  employmentType: AnalyticsPeopleEmploymentTypeRow[];
  trend: AnalyticsPeopleTrendRow[];
};

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

export type AnalyticsTimeOffSection = {
  metrics: {
    requestedDays: number;
    approvedDays: number;
    pendingRequests: number;
    currentlyOutCount: number;
    utilizationRate: number;
  };
  byType: AnalyticsTimeOffByTypeRow[];
  trend: AnalyticsTimeOffTrendRow[];
  currentlyOut: AnalyticsTimeOffCurrentlyOutRow[];
};

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
    totalGross: number;
    totalNet: number;
    totalDeductions: number;
    runCount: number;
    avgNetPerEmployee: number;
  };
  trend: AnalyticsPayrollTrendRow[];
  byDepartment: AnalyticsPayrollDepartmentRow[];
  byCountry: AnalyticsPayrollCountryRow[];
};

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
    approvedAmount: number;
    pendingAmount: number;
    expenseCount: number;
  };
  byCategory: AnalyticsExpensesCategoryRow[];
  trend: AnalyticsExpensesTrendRow[];
  topSpenders: AnalyticsExpensesTopSpenderRow[];
};

export type AnalyticsResponseData = {
  dateRange: {
    startDate: string;
    endDate: string;
  };
  people: AnalyticsPeopleSection;
  timeOff: AnalyticsTimeOffSection;
  payroll: AnalyticsPayrollSection;
  expenses: AnalyticsExpensesSection;
};

export type AnalyticsCsvSection = "people" | "time_off" | "payroll" | "expenses";

export type AnalyticsResponse = ApiResponse<AnalyticsResponseData>;
