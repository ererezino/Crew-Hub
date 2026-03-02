import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

import { encryptSensitiveValue } from "../../lib/crypto";
import { extractLast4Digits } from "../../lib/payment-details";

type SeedRole =
  | "EMPLOYEE"
  | "MANAGER"
  | "HR_ADMIN"
  | "FINANCE_ADMIN"
  | "SUPER_ADMIN";

type SeedStatus = "active" | "inactive" | "onboarding" | "offboarding";

type SeedMember = {
  key: string;
  fullName: string;
  email: string;
  title: string;
  department:
    | "Engineering"
    | "Operations"
    | "Compliance"
    | "Marketing"
    | "Business Development"
    | "Finance";
  countryCode: "NG" | "GH" | "KE" | "ZA" | "CA";
  timezone: string;
  roles: SeedRole[];
  managerKey: string | null;
  status: SeedStatus;
};

type SeedAnnouncement = {
  title: string;
  body: string;
  isPinned: boolean;
  authorKey: SeedMember["key"];
};

type SeedDocumentCategory =
  | "policy"
  | "contract"
  | "id_document"
  | "tax_form"
  | "compliance"
  | "payroll_statement"
  | "other";

type SeedDocument = {
  title: string;
  description: string;
  category: SeedDocumentCategory;
  ownerKey: SeedMember["key"] | null;
  createdByKey: SeedMember["key"];
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  expiryOffsetDays: number | null;
  countryCode: SeedMember["countryCode"] | null;
  versionCount: number;
};

type SeedOnboardingType = "onboarding" | "offboarding";

type SeedOnboardingInstanceStatus = "active" | "completed" | "cancelled";

type SeedOnboardingTaskStatus = "pending" | "in_progress" | "completed" | "blocked";

type SeedOnboardingTemplateTask = {
  title: string;
  description: string;
  category: string;
  dueOffsetDays: number | null;
};

type SeedOnboardingTemplate = {
  key: string;
  name: string;
  type: SeedOnboardingType;
  countryCode: SeedMember["countryCode"] | null;
  department: SeedMember["department"] | null;
  tasks: SeedOnboardingTemplateTask[];
};

type SeedOnboardingInstanceTask = {
  title: string;
  description: string;
  category: string;
  status: SeedOnboardingTaskStatus;
  assignedToKey: SeedMember["key"] | null;
  dueOffsetDays: number | null;
  completedOffsetDays: number | null;
  completedByKey: SeedMember["key"] | null;
  notes: string | null;
};

type SeedOnboardingInstance = {
  templateKey: SeedOnboardingTemplate["key"];
  employeeKey: SeedMember["key"];
  type: SeedOnboardingType;
  status: SeedOnboardingInstanceStatus;
  startedOffsetDays: number;
  completedOffsetDays: number | null;
  tasks: SeedOnboardingInstanceTask[];
};

type SeedLeaveAccrualType = "annual_upfront" | "monthly" | "quarterly" | "manual";

type SeedLeaveRequestStatus = "pending" | "approved" | "rejected" | "cancelled";

type SeedLeavePolicy = {
  countryCode: SeedMember["countryCode"];
  leaveType: "annual" | "sick";
  defaultDaysPerYear: number;
  accrualType: SeedLeaveAccrualType;
  carryOver: boolean;
  notes: string | null;
};

type SeedLeaveBalance = {
  employeeKey: SeedMember["key"];
  leaveType: "annual" | "sick";
  totalDays: number;
  usedDays: number;
  pendingDays: number;
  carriedDays: number;
};

type SeedHoliday = {
  countryCode: SeedMember["countryCode"];
  date: string;
  name: string;
};

type SeedLeaveRequest = {
  employeeKey: SeedMember["key"];
  leaveType: "annual" | "sick";
  startDate: string;
  endDate: string;
  totalDays: number;
  status: SeedLeaveRequestStatus;
  reason: string;
  approverKey: SeedMember["key"] | null;
  rejectionReason: string | null;
};

type SeedCompensationPayFrequency =
  | "weekly"
  | "biweekly"
  | "monthly"
  | "quarterly"
  | "annual";

type SeedCompensationEmploymentType = "full_time" | "part_time" | "contractor";

type SeedCompensationRecord = {
  employeeKey: SeedMember["key"];
  baseSalaryAmount: number;
  currency: "USD";
  payFrequency: SeedCompensationPayFrequency;
  employmentType: SeedCompensationEmploymentType;
  effectiveOffsetDays: number;
  effectiveToOffsetDays: number | null;
  approvedByKey: SeedMember["key"] | null;
};

type SeedAllowanceType =
  | "housing"
  | "transport"
  | "communication"
  | "meal"
  | "internet"
  | "wellness"
  | "other";

type SeedAllowance = {
  employeeKey: SeedMember["key"];
  type: SeedAllowanceType;
  label: string;
  amount: number;
  currency: "USD";
  isTaxable: boolean;
  effectiveOffsetDays: number;
  effectiveToOffsetDays: number | null;
};

type SeedEquityGrantType = "ISO" | "NSO" | "RSU";

type SeedEquityGrantStatus = "draft" | "active" | "cancelled" | "vested" | "terminated";

type SeedEquityGrant = {
  employeeKey: SeedMember["key"];
  grantType: SeedEquityGrantType;
  numberOfShares: number;
  exercisePriceCents: number | null;
  grantOffsetDays: number;
  vestingStartOffsetDays: number;
  cliffMonths: number;
  vestingDurationMonths: number;
  status: SeedEquityGrantStatus;
  approvedByKey: SeedMember["key"] | null;
  boardApprovalOffsetDays: number | null;
  notes: string | null;
};

type SeedPaymentMethod = "bank_transfer" | "mobile_money" | "wise";

type SeedPaymentDetailBase = {
  employeeKey: SeedMember["key"];
  currency: "USD";
  isVerified: boolean;
  changeEffectiveOffsetHours: number;
};

type SeedPaymentDetail =
  | (SeedPaymentDetailBase & {
      paymentMethod: "bank_transfer";
      bankName: string;
      bankAccountName: string;
      bankAccountNumber: string;
      bankRoutingNumber: string | null;
    })
  | (SeedPaymentDetailBase & {
      paymentMethod: "mobile_money";
      mobileMoneyProvider: string;
      mobileMoneyNumber: string;
    })
  | (SeedPaymentDetailBase & {
      paymentMethod: "wise";
      wiseRecipientId: string;
    });

type SeedExpenseCategory =
  | "travel"
  | "lodging"
  | "meals"
  | "transport"
  | "internet"
  | "office_supplies"
  | "software"
  | "wellness"
  | "other";

type SeedExpenseStatus = "pending" | "approved" | "rejected" | "reimbursed" | "cancelled";

type SeedExpense = {
  employeeKey: SeedMember["key"];
  category: SeedExpenseCategory;
  description: string;
  amount: number;
  currency: "USD";
  expenseDateOffsetDays: number;
  status: SeedExpenseStatus;
  approvedByKey?: SeedMember["key"] | null;
  approvedOffsetDays?: number | null;
  rejectedByKey?: SeedMember["key"] | null;
  rejectedOffsetDays?: number | null;
  rejectionReason?: string | null;
  reimbursedByKey?: SeedMember["key"] | null;
  reimbursedOffsetDays?: number | null;
  reimbursementReference?: string | null;
  reimbursementNotes?: string | null;
};

type SeedReviewCycleType = "quarterly" | "annual" | "probation";

type SeedReviewCycleStatus = "draft" | "active" | "in_review" | "completed";

type SeedReviewAssignmentStatus =
  | "pending_self"
  | "pending_manager"
  | "in_review"
  | "completed";

type SeedReviewResponseType = "self" | "manager";

type SeedReviewQuestionType = "rating" | "text";

type SeedReviewQuestion = {
  id: string;
  title: string;
  prompt: string;
  type: SeedReviewQuestionType;
  required: boolean;
  maxLength?: number;
};

type SeedReviewSection = {
  id: string;
  title: string;
  description: string;
  questions: SeedReviewQuestion[];
};

type SeedReviewCycle = {
  key: string;
  name: string;
  type: SeedReviewCycleType;
  status: SeedReviewCycleStatus;
  startOffsetDays: number;
  endOffsetDays: number;
  selfReviewDeadlineOffsetDays: number | null;
  managerReviewDeadlineOffsetDays: number | null;
  createdByKey: SeedMember["key"];
};

type SeedReviewTemplate = {
  key: string;
  name: string;
  sections: SeedReviewSection[];
  createdByKey: SeedMember["key"];
};

type SeedReviewAssignment = {
  key: string;
  cycleKey: SeedReviewCycle["key"];
  employeeKey: SeedMember["key"];
  reviewerKey: SeedMember["key"];
  templateKey: SeedReviewTemplate["key"];
  status: SeedReviewAssignmentStatus;
  dueOffsetDays: number | null;
};

type SeedReviewAnswerValue = {
  rating: number | null;
  text: string | null;
};

type SeedReviewAnswers = Record<string, SeedReviewAnswerValue>;

type SeedReviewResponse = {
  assignmentKey: SeedReviewAssignment["key"];
  respondentKey: SeedMember["key"];
  responseType: SeedReviewResponseType;
  answers: SeedReviewAnswers;
  submittedOffsetDays: number | null;
};

type SeedComplianceCadence = "monthly" | "annual" | "ongoing";

type SeedComplianceCategory =
  | "tax"
  | "pension"
  | "housing"
  | "social_insurance"
  | "health_insurance"
  | "regulatory";

type SeedComplianceStatus = "pending" | "in_progress" | "completed" | "overdue";

type SeedComplianceItem = {
  key: string;
  countryCode: SeedMember["countryCode"];
  authority: string;
  requirement: string;
  description: string;
  cadence: SeedComplianceCadence;
  category: SeedComplianceCategory;
  notes: string | null;
  dueDay: number | "end";
  assignedToKey: SeedMember["key"];
  annualMonthOffset?: number;
};

type SeedComplianceDeadline = {
  itemKey: SeedComplianceItem["key"];
  dueDate: string;
  status: SeedComplianceStatus;
  assignedToKey: SeedMember["key"];
  completedAt: string | null;
  notes: string | null;
};

type SeedNotification = {
  userKey: SeedMember["key"];
  type: string;
  title: string;
  body: string;
  link: string | null;
  isRead: boolean;
  createdOffsetDays: number;
};

type SeedDeductionRule = {
  countryCode: "NG";
  ruleType:
    | "income_tax"
    | "pension_employee"
    | "pension_employer"
    | "housing_fund"
    | "social_insurance"
    | "relief";
  ruleName: string;
  bracketMin: number | null;
  bracketMax: number | null;
  rate: number | null;
  flatAmount: number | null;
  employerPortionRate: number | null;
  calculationOrder: number;
  notes: string | null;
  effectiveFrom: string;
};

type SeedCompensationBandLocationType = "global" | "country" | "city" | "zone";

type SeedCompensationBand = {
  key: string;
  title: string;
  level: string | null;
  department: SeedMember["department"] | null;
  locationType: SeedCompensationBandLocationType;
  locationValue: string | null;
  currency: "USD";
  minSalaryAmount: number;
  midSalaryAmount: number;
  maxSalaryAmount: number;
  equityMin: number | null;
  equityMax: number | null;
  effectiveOffsetDays: number;
  effectiveToOffsetDays: number | null;
  createdByKey: SeedMember["key"];
};

type SeedBenchmarkData = {
  source: string;
  title: string;
  level: string | null;
  location: string | null;
  currency: "USD";
  p25: number | null;
  p50: number | null;
  p75: number | null;
  p90: number | null;
  importedOffsetDays: number;
  importedByKey: SeedMember["key"];
};

type SeedCompensationBandAssignment = {
  employeeKey: SeedMember["key"];
  bandKey: SeedCompensationBand["key"];
  effectiveOffsetDays: number;
  effectiveToOffsetDays: number | null;
  assignedByKey: SeedMember["key"];
};

const SEED_MEMBERS: SeedMember[] = [
  {
    key: "coo",
    fullName: "Amina Okafor",
    email: "coo@accrue.test",
    title: "Chief Operating Officer",
    department: "Business Development",
    countryCode: "NG",
    timezone: "Africa/Lagos",
    roles: ["SUPER_ADMIN"],
    managerKey: null,
    status: "active"
  },
  {
    key: "ceo",
    fullName: "Tunde Adeyemi",
    email: "ceo@accrue.test",
    title: "Chief Executive Officer",
    department: "Marketing",
    countryCode: "NG",
    timezone: "Africa/Lagos",
    roles: ["SUPER_ADMIN"],
    managerKey: "coo",
    status: "active"
  },
  {
    key: "head_people_finance",
    fullName: "Chioma Nwosu",
    email: "people.finance@accrue.test",
    title: "Head of People & Finance",
    department: "Finance",
    countryCode: "NG",
    timezone: "Africa/Lagos",
    roles: ["HR_ADMIN", "FINANCE_ADMIN"],
    managerKey: "coo",
    status: "active"
  },
  {
    key: "eng_manager",
    fullName: "Samuel Okeke",
    email: "eng.manager@accrue.test",
    title: "Engineering Manager",
    department: "Engineering",
    countryCode: "NG",
    timezone: "Africa/Lagos",
    roles: ["MANAGER"],
    managerKey: "coo",
    status: "active"
  },
  {
    key: "ops_manager",
    fullName: "Wanjiku Mwangi",
    email: "ops.manager@accrue.test",
    title: "Operations Manager",
    department: "Operations",
    countryCode: "KE",
    timezone: "Africa/Nairobi",
    roles: ["MANAGER"],
    managerKey: "coo",
    status: "active"
  },
  {
    key: "engineer_1",
    fullName: "Ifeanyi Eze",
    email: "engineer1@accrue.test",
    title: "Software Engineer",
    department: "Engineering",
    countryCode: "NG",
    timezone: "Africa/Lagos",
    roles: ["EMPLOYEE"],
    managerKey: "eng_manager",
    status: "active"
  },
  {
    key: "ops_associate",
    fullName: "Abena Owusu",
    email: "ops.associate@accrue.test",
    title: "Operations Associate",
    department: "Operations",
    countryCode: "GH",
    timezone: "Africa/Accra",
    roles: ["EMPLOYEE"],
    managerKey: "ops_manager",
    status: "onboarding"
  },
  {
    key: "engineer_2",
    fullName: "Brian Otieno",
    email: "engineer2@accrue.test",
    title: "Software Engineer",
    department: "Engineering",
    countryCode: "KE",
    timezone: "Africa/Nairobi",
    roles: ["EMPLOYEE"],
    managerKey: "eng_manager",
    status: "active"
  },
  {
    key: "compliance_officer",
    fullName: "Lerato Dlamini",
    email: "compliance@accrue.test",
    title: "Compliance Officer",
    department: "Compliance",
    countryCode: "ZA",
    timezone: "Africa/Johannesburg",
    roles: ["EMPLOYEE"],
    managerKey: "ops_manager",
    status: "active"
  },
  {
    key: "engineer_3",
    fullName: "Noah Patel",
    email: "engineer3@accrue.test",
    title: "Software Engineer",
    department: "Engineering",
    countryCode: "CA",
    timezone: "America/Toronto",
    roles: ["EMPLOYEE"],
    managerKey: "eng_manager",
    status: "onboarding"
  }
];

const SEED_ANNOUNCEMENTS: SeedAnnouncement[] = [
  {
    title: "Crew Hub rollout update",
    body: "Crew Hub is now the default hub for internal employee operations. Use it for announcements, settings, and upcoming workflow modules.",
    isPinned: true,
    authorKey: "coo"
  },
  {
    title: "Monthly all-hands schedule",
    body: "The monthly all-hands now runs on the first Wednesday of each month at 3:00 PM WAT. Calendar invites have been updated.",
    isPinned: false,
    authorKey: "ceo"
  },
  {
    title: "People ops office hours",
    body: "People and Finance office hours are open every Friday from 11:00 AM to 1:00 PM WAT for onboarding and policy questions.",
    isPinned: false,
    authorKey: "head_people_finance"
  }
];

const SEED_DOCUMENTS: SeedDocument[] = [
  {
    title: "Remote Work Policy",
    description: "Shared policy for distributed work expectations and communication cadence.",
    category: "policy",
    ownerKey: null,
    createdByKey: "head_people_finance",
    fileName: "remote-work-policy.pdf",
    mimeType: "application/pdf",
    sizeBytes: 184_220,
    expiryOffsetDays: 18,
    countryCode: "NG",
    versionCount: 2
  },
  {
    title: "Code of Conduct",
    description: "Company-wide standards on behavior, reporting channels, and accountability.",
    category: "policy",
    ownerKey: null,
    createdByKey: "coo",
    fileName: "code-of-conduct.pdf",
    mimeType: "application/pdf",
    sizeBytes: 142_900,
    expiryOffsetDays: null,
    countryCode: null,
    versionCount: 1
  },
  {
    title: "Ifeanyi Eze Passport",
    description: "Primary ID document for payroll and compliance processing.",
    category: "id_document",
    ownerKey: "engineer_1",
    createdByKey: "engineer_1",
    fileName: "ifeanyi-passport.jpg",
    mimeType: "image/jpeg",
    sizeBytes: 492_040,
    expiryOffsetDays: 240,
    countryCode: "NG",
    versionCount: 1
  },
  {
    title: "Ifeanyi Eze Tax Form",
    description: "Annual contractor tax form for USD payments.",
    category: "tax_form",
    ownerKey: "engineer_1",
    createdByKey: "engineer_1",
    fileName: "ifeanyi-tax-form.pdf",
    mimeType: "application/pdf",
    sizeBytes: 231_004,
    expiryOffsetDays: 12,
    countryCode: "NG",
    versionCount: 2
  },
  {
    title: "Abena Owusu Tax Form",
    description: "Current contractor tax declaration for reimbursements and payroll records.",
    category: "tax_form",
    ownerKey: "ops_associate",
    createdByKey: "ops_associate",
    fileName: "abena-tax-form.pdf",
    mimeType: "application/pdf",
    sizeBytes: 188_210,
    expiryOffsetDays: 64,
    countryCode: "GH",
    versionCount: 1
  }
];

const SEED_ONBOARDING_TEMPLATES: SeedOnboardingTemplate[] = [
  {
    key: "nigeria-engineering-onboarding",
    name: "Nigeria Engineering Onboarding",
    type: "onboarding",
    countryCode: "NG",
    department: "Engineering",
    tasks: [
      {
        title: "Complete contractor profile details",
        description: "Confirm legal name, phone number, and timezone in Crew Hub.",
        category: "People Ops",
        dueOffsetDays: 0
      },
      {
        title: "Sign contractor agreement",
        description: "Review and sign the standard contractor agreement package.",
        category: "People Ops",
        dueOffsetDays: 1
      },
      {
        title: "Set up Crew Hub and work accounts",
        description: "Confirm Crew Hub login, Slack access, and company email setup.",
        category: "IT",
        dueOffsetDays: 1
      },
      {
        title: "Configure GitHub and SSO",
        description: "Accept team invites, enable MFA, and validate SSO access.",
        category: "IT",
        dueOffsetDays: 2
      },
      {
        title: "Prepare local development environment",
        description: "Install toolchain and run the starter service locally.",
        category: "Engineering",
        dueOffsetDays: 3
      },
      {
        title: "Review engineering handbook",
        description: "Read coding standards, PR workflow, and release process.",
        category: "Engineering",
        dueOffsetDays: 4
      },
      {
        title: "Complete compliance acknowledgement",
        description: "Confirm policy training and submit required attestation.",
        category: "Compliance",
        dueOffsetDays: 5
      },
      {
        title: "Meet manager for first-week plan",
        description: "Align on onboarding goals and initial task ownership.",
        category: "Manager",
        dueOffsetDays: 6
      }
    ]
  }
];

const SEED_ONBOARDING_INSTANCES: SeedOnboardingInstance[] = [
  {
    templateKey: "nigeria-engineering-onboarding",
    employeeKey: "engineer_1",
    type: "onboarding",
    status: "active",
    startedOffsetDays: -4,
    completedOffsetDays: null,
    tasks: [
      {
        title: "Complete contractor profile details",
        description: "Confirm legal name, phone number, and timezone in Crew Hub.",
        category: "People Ops",
        status: "completed",
        assignedToKey: "engineer_1",
        dueOffsetDays: -4,
        completedOffsetDays: -4,
        completedByKey: "engineer_1",
        notes: "Profile fields confirmed."
      },
      {
        title: "Sign contractor agreement",
        description: "Review and sign the standard contractor agreement package.",
        category: "People Ops",
        status: "completed",
        assignedToKey: "engineer_1",
        dueOffsetDays: -3,
        completedOffsetDays: -3,
        completedByKey: "engineer_1",
        notes: "Signed agreement uploaded to documents."
      },
      {
        title: "Set up Crew Hub and work accounts",
        description: "Confirm Crew Hub login, Slack access, and company email setup.",
        category: "IT",
        status: "completed",
        assignedToKey: "eng_manager",
        dueOffsetDays: -3,
        completedOffsetDays: -2,
        completedByKey: "eng_manager",
        notes: "All account access verified."
      },
      {
        title: "Configure GitHub and SSO",
        description: "Accept team invites, enable MFA, and validate SSO access.",
        category: "IT",
        status: "in_progress",
        assignedToKey: "engineer_1",
        dueOffsetDays: 1,
        completedOffsetDays: null,
        completedByKey: null,
        notes: "Waiting on repository invite acceptance."
      },
      {
        title: "Prepare local development environment",
        description: "Install toolchain and run the starter service locally.",
        category: "Engineering",
        status: "pending",
        assignedToKey: "engineer_1",
        dueOffsetDays: 2,
        completedOffsetDays: null,
        completedByKey: null,
        notes: null
      },
      {
        title: "Review engineering handbook",
        description: "Read coding standards, PR workflow, and release process.",
        category: "Engineering",
        status: "pending",
        assignedToKey: "engineer_1",
        dueOffsetDays: 3,
        completedOffsetDays: null,
        completedByKey: null,
        notes: null
      },
      {
        title: "Complete compliance acknowledgement",
        description: "Confirm policy training and submit required attestation.",
        category: "Compliance",
        status: "blocked",
        assignedToKey: "head_people_finance",
        dueOffsetDays: 4,
        completedOffsetDays: null,
        completedByKey: null,
        notes: "Awaiting NDA signature from contractor."
      },
      {
        title: "Meet manager for first-week plan",
        description: "Align on onboarding goals and initial task ownership.",
        category: "Manager",
        status: "pending",
        assignedToKey: "eng_manager",
        dueOffsetDays: 1,
        completedOffsetDays: null,
        completedByKey: null,
        notes: null
      }
    ]
  }
];

const CURRENT_SEED_YEAR = new Date().getUTCFullYear();

function yearDate(monthDay: string): string {
  return `${String(CURRENT_SEED_YEAR)}-${monthDay}`;
}

const SEED_LEAVE_POLICIES: SeedLeavePolicy[] = [
  {
    countryCode: "NG",
    leaveType: "annual",
    defaultDaysPerYear: 20,
    accrualType: "annual_upfront",
    carryOver: true,
    notes: "Standard annual leave allocation for Nigeria employees."
  },
  {
    countryCode: "NG",
    leaveType: "sick",
    defaultDaysPerYear: 10,
    accrualType: "annual_upfront",
    carryOver: false,
    notes: "Sick leave allocation for Nigeria employees."
  }
];

const ANNUAL_BALANCE_OVERRIDES: Partial<
  Record<
    SeedMember["key"],
    {
      usedDays: number;
      pendingDays: number;
      carriedDays: number;
    }
  >
> = {
  engineer_1: {
    usedDays: 4,
    pendingDays: 3,
    carriedDays: 2
  },
  engineer_2: {
    usedDays: 5,
    pendingDays: 0,
    carriedDays: 1
  }
};

const SICK_BALANCE_OVERRIDES: Partial<
  Record<
    SeedMember["key"],
    {
      usedDays: number;
      pendingDays: number;
      carriedDays: number;
    }
  >
> = {
  ops_associate: {
    usedDays: 2,
    pendingDays: 0,
    carriedDays: 0
  }
};

const SEED_LEAVE_BALANCES: SeedLeaveBalance[] = SEED_MEMBERS.flatMap((member) => {
  const annualOverride = ANNUAL_BALANCE_OVERRIDES[member.key];
  const sickOverride = SICK_BALANCE_OVERRIDES[member.key];

  return [
    {
      employeeKey: member.key,
      leaveType: "annual",
      totalDays: 20,
      usedDays: annualOverride?.usedDays ?? 3,
      pendingDays: annualOverride?.pendingDays ?? 1,
      carriedDays: annualOverride?.carriedDays ?? 1
    },
    {
      employeeKey: member.key,
      leaveType: "sick",
      totalDays: 10,
      usedDays: sickOverride?.usedDays ?? 1,
      pendingDays: sickOverride?.pendingDays ?? 0,
      carriedDays: sickOverride?.carriedDays ?? 0
    }
  ];
});

const SEED_HOLIDAYS: SeedHoliday[] = [
  {
    countryCode: "NG",
    date: yearDate("01-01"),
    name: "New Year's Day"
  },
  {
    countryCode: "NG",
    date: yearDate("04-03"),
    name: "Good Friday"
  },
  {
    countryCode: "NG",
    date: yearDate("04-06"),
    name: "Easter Monday"
  },
  {
    countryCode: "NG",
    date: yearDate("05-01"),
    name: "Workers' Day"
  },
  {
    countryCode: "NG",
    date: yearDate("10-01"),
    name: "Independence Day"
  },
  {
    countryCode: "NG",
    date: yearDate("12-25"),
    name: "Christmas Day"
  }
];

const SEED_LEAVE_REQUESTS: SeedLeaveRequest[] = [
  {
    employeeKey: "engineer_1",
    leaveType: "annual",
    startDate: yearDate("03-10"),
    endDate: yearDate("03-12"),
    totalDays: 3,
    status: "pending",
    reason: "Planned personal time off for a family event.",
    approverKey: null,
    rejectionReason: null
  },
  {
    employeeKey: "ops_associate",
    leaveType: "sick",
    startDate: yearDate("02-17"),
    endDate: yearDate("02-18"),
    totalDays: 2,
    status: "approved",
    reason: "Medical rest and recovery period.",
    approverKey: "ops_manager",
    rejectionReason: null
  },
  {
    employeeKey: "engineer_2",
    leaveType: "annual",
    startDate: yearDate("01-20"),
    endDate: yearDate("01-22"),
    totalDays: 3,
    status: "rejected",
    reason: "Travel request during critical sprint delivery.",
    approverKey: "eng_manager",
    rejectionReason: "Coverage is unavailable during sprint close."
  }
];

const BASE_SALARY_BY_MEMBER: Record<SeedMember["key"], number> = {
  coo: 2_100_000,
  ceo: 2_300_000,
  head_people_finance: 1_700_000,
  eng_manager: 1_450_000,
  ops_manager: 1_250_000,
  engineer_1: 1_050_000,
  ops_associate: 800_000,
  engineer_2: 1_000_000,
  compliance_officer: 900_000,
  engineer_3: 1_150_000
};

const SEED_COMPENSATION_RECORDS: SeedCompensationRecord[] = SEED_MEMBERS.map((member) => ({
  employeeKey: member.key,
  baseSalaryAmount: BASE_SALARY_BY_MEMBER[member.key],
  currency: "USD",
  payFrequency: "monthly",
  employmentType: "contractor",
  effectiveOffsetDays: -180,
  effectiveToOffsetDays: null,
  approvedByKey: "coo"
}));

const SEED_ALLOWANCES: SeedAllowance[] = SEED_MEMBERS.flatMap((member) => [
  {
    employeeKey: member.key,
    type: "internet",
    label: "Internet Stipend",
    amount: 15_000,
    currency: "USD",
    isTaxable: false,
    effectiveOffsetDays: -120,
    effectiveToOffsetDays: null
  },
  {
    employeeKey: member.key,
    type: "wellness",
    label: "Wellness Stipend",
    amount: 10_000,
    currency: "USD",
    isTaxable: false,
    effectiveOffsetDays: -120,
    effectiveToOffsetDays: null
  }
]);

const SEED_EQUITY_GRANTS: SeedEquityGrant[] = [
  {
    employeeKey: "engineer_1",
    grantType: "RSU",
    numberOfShares: 12_000,
    exercisePriceCents: null,
    grantOffsetDays: -240,
    vestingStartOffsetDays: -220,
    cliffMonths: 12,
    vestingDurationMonths: 48,
    status: "active",
    approvedByKey: "coo",
    boardApprovalOffsetDays: -236,
    notes: "Core engineering retention grant."
  },
  {
    employeeKey: "eng_manager",
    grantType: "NSO",
    numberOfShares: 18_500,
    exercisePriceCents: 250,
    grantOffsetDays: -320,
    vestingStartOffsetDays: -300,
    cliffMonths: 12,
    vestingDurationMonths: 48,
    status: "active",
    approvedByKey: "coo",
    boardApprovalOffsetDays: -316,
    notes: "Manager leadership grant."
  },
  {
    employeeKey: "ceo",
    grantType: "ISO",
    numberOfShares: 30_000,
    exercisePriceCents: 100,
    grantOffsetDays: -760,
    vestingStartOffsetDays: -730,
    cliffMonths: 12,
    vestingDurationMonths: 48,
    status: "vested",
    approvedByKey: "coo",
    boardApprovalOffsetDays: -754,
    notes: "Executive founding grant."
  }
];

const SEED_COMPENSATION_BANDS: SeedCompensationBand[] = [
  {
    key: "executive-global",
    title: "Executive Leadership",
    level: "L1",
    department: null,
    locationType: "global",
    locationValue: null,
    currency: "USD",
    minSalaryAmount: 1_800_000,
    midSalaryAmount: 2_200_000,
    maxSalaryAmount: 2_600_000,
    equityMin: 20_000,
    equityMax: 45_000,
    effectiveOffsetDays: -180,
    effectiveToOffsetDays: null,
    createdByKey: "coo"
  },
  {
    key: "engineering-individual-contributor",
    title: "Software Engineer",
    level: "IC2",
    department: "Engineering",
    locationType: "global",
    locationValue: null,
    currency: "USD",
    minSalaryAmount: 900_000,
    midSalaryAmount: 1_050_000,
    maxSalaryAmount: 1_200_000,
    equityMin: 8_000,
    equityMax: 18_000,
    effectiveOffsetDays: -180,
    effectiveToOffsetDays: null,
    createdByKey: "head_people_finance"
  },
  {
    key: "engineering-manager",
    title: "Engineering Manager",
    level: "M1",
    department: "Engineering",
    locationType: "global",
    locationValue: null,
    currency: "USD",
    minSalaryAmount: 1_250_000,
    midSalaryAmount: 1_450_000,
    maxSalaryAmount: 1_700_000,
    equityMin: 14_000,
    equityMax: 24_000,
    effectiveOffsetDays: -180,
    effectiveToOffsetDays: null,
    createdByKey: "head_people_finance"
  },
  {
    key: "operations-generalist",
    title: "Operations",
    level: "M1",
    department: "Operations",
    locationType: "global",
    locationValue: null,
    currency: "USD",
    minSalaryAmount: 780_000,
    midSalaryAmount: 1_000_000,
    maxSalaryAmount: 1_250_000,
    equityMin: 5_000,
    equityMax: 12_000,
    effectiveOffsetDays: -180,
    effectiveToOffsetDays: null,
    createdByKey: "head_people_finance"
  },
  {
    key: "compliance-specialist",
    title: "Compliance Officer",
    level: "IC3",
    department: "Compliance",
    locationType: "global",
    locationValue: null,
    currency: "USD",
    minSalaryAmount: 820_000,
    midSalaryAmount: 900_000,
    maxSalaryAmount: 1_060_000,
    equityMin: 4_500,
    equityMax: 10_000,
    effectiveOffsetDays: -180,
    effectiveToOffsetDays: null,
    createdByKey: "head_people_finance"
  }
];

const SEED_BENCHMARK_DATA: SeedBenchmarkData[] = [
  {
    source: "Radford 2026",
    title: "Software Engineer",
    level: "IC2",
    location: "Global Remote",
    currency: "USD",
    p25: 880_000,
    p50: 1_040_000,
    p75: 1_230_000,
    p90: 1_360_000,
    importedOffsetDays: -10,
    importedByKey: "head_people_finance"
  },
  {
    source: "Mercer 2026",
    title: "Engineering Manager",
    level: "M1",
    location: "Global Remote",
    currency: "USD",
    p25: 1_240_000,
    p50: 1_450_000,
    p75: 1_700_000,
    p90: 1_900_000,
    importedOffsetDays: -10,
    importedByKey: "head_people_finance"
  },
  {
    source: "Figures 2026",
    title: "Operations Manager",
    level: "M1",
    location: "Global Remote",
    currency: "USD",
    p25: 760_000,
    p50: 980_000,
    p75: 1_180_000,
    p90: 1_320_000,
    importedOffsetDays: -8,
    importedByKey: "head_people_finance"
  }
];

const SEED_COMPENSATION_BAND_ASSIGNMENTS: SeedCompensationBandAssignment[] = [
  {
    employeeKey: "coo",
    bandKey: "executive-global",
    effectiveOffsetDays: -180,
    effectiveToOffsetDays: null,
    assignedByKey: "coo"
  },
  {
    employeeKey: "ceo",
    bandKey: "executive-global",
    effectiveOffsetDays: -180,
    effectiveToOffsetDays: null,
    assignedByKey: "coo"
  },
  {
    employeeKey: "head_people_finance",
    bandKey: "executive-global",
    effectiveOffsetDays: -180,
    effectiveToOffsetDays: null,
    assignedByKey: "coo"
  },
  {
    employeeKey: "eng_manager",
    bandKey: "engineering-manager",
    effectiveOffsetDays: -180,
    effectiveToOffsetDays: null,
    assignedByKey: "head_people_finance"
  },
  {
    employeeKey: "ops_manager",
    bandKey: "operations-generalist",
    effectiveOffsetDays: -180,
    effectiveToOffsetDays: null,
    assignedByKey: "head_people_finance"
  },
  {
    employeeKey: "engineer_1",
    bandKey: "engineering-individual-contributor",
    effectiveOffsetDays: -180,
    effectiveToOffsetDays: null,
    assignedByKey: "head_people_finance"
  },
  {
    employeeKey: "engineer_2",
    bandKey: "engineering-individual-contributor",
    effectiveOffsetDays: -180,
    effectiveToOffsetDays: null,
    assignedByKey: "head_people_finance"
  },
  {
    employeeKey: "engineer_3",
    bandKey: "engineering-individual-contributor",
    effectiveOffsetDays: -180,
    effectiveToOffsetDays: null,
    assignedByKey: "head_people_finance"
  },
  {
    employeeKey: "ops_associate",
    bandKey: "operations-generalist",
    effectiveOffsetDays: -180,
    effectiveToOffsetDays: null,
    assignedByKey: "head_people_finance"
  },
  {
    employeeKey: "compliance_officer",
    bandKey: "compliance-specialist",
    effectiveOffsetDays: -180,
    effectiveToOffsetDays: null,
    assignedByKey: "head_people_finance"
  }
];

const SEED_PAYMENT_DETAILS: SeedPaymentDetail[] = [
  {
    employeeKey: "coo",
    paymentMethod: "bank_transfer",
    bankName: "United Bank for Africa",
    bankAccountName: "Amina Okafor",
    bankAccountNumber: "1200456789",
    bankRoutingNumber: "044150149",
    currency: "USD",
    isVerified: true,
    changeEffectiveOffsetHours: -96
  },
  {
    employeeKey: "ceo",
    paymentMethod: "wise",
    wiseRecipientId: "wise-recipient-9083",
    currency: "USD",
    isVerified: true,
    changeEffectiveOffsetHours: -72
  },
  {
    employeeKey: "head_people_finance",
    paymentMethod: "mobile_money",
    mobileMoneyProvider: "MTN Mobile Money",
    mobileMoneyNumber: "+2348035551290",
    currency: "USD",
    isVerified: true,
    changeEffectiveOffsetHours: -60
  },
  {
    employeeKey: "eng_manager",
    paymentMethod: "bank_transfer",
    bankName: "Access Bank",
    bankAccountName: "Samuel Okeke",
    bankAccountNumber: "2100458891",
    bankRoutingNumber: "044150053",
    currency: "USD",
    isVerified: false,
    changeEffectiveOffsetHours: 30
  },
  {
    employeeKey: "ops_manager",
    paymentMethod: "mobile_money",
    mobileMoneyProvider: "M-Pesa",
    mobileMoneyNumber: "+254712345678",
    currency: "USD",
    isVerified: true,
    changeEffectiveOffsetHours: -84
  },
  {
    employeeKey: "engineer_1",
    paymentMethod: "wise",
    wiseRecipientId: "wise-recipient-3190",
    currency: "USD",
    isVerified: false,
    changeEffectiveOffsetHours: 22
  },
  {
    employeeKey: "ops_associate",
    paymentMethod: "mobile_money",
    mobileMoneyProvider: "MTN MoMo Ghana",
    mobileMoneyNumber: "+233245556780",
    currency: "USD",
    isVerified: true,
    changeEffectiveOffsetHours: -48
  },
  {
    employeeKey: "engineer_2",
    paymentMethod: "bank_transfer",
    bankName: "KCB Bank",
    bankAccountName: "Musa Bello",
    bankAccountNumber: "1147829011",
    bankRoutingNumber: "01100",
    currency: "USD",
    isVerified: true,
    changeEffectiveOffsetHours: -52
  },
  {
    employeeKey: "compliance_officer",
    paymentMethod: "wise",
    wiseRecipientId: "wise-recipient-7714",
    currency: "USD",
    isVerified: true,
    changeEffectiveOffsetHours: -64
  },
  {
    employeeKey: "engineer_3",
    paymentMethod: "bank_transfer",
    bankName: "Royal Bank of Canada",
    bankAccountName: "Sofia Campbell",
    bankAccountNumber: "6130048229",
    bankRoutingNumber: "003",
    currency: "USD",
    isVerified: true,
    changeEffectiveOffsetHours: -90
  }
];

const NIGERIA_DEDUCTION_EFFECTIVE_FROM = "2026-01-01";

const SEED_NIGERIA_DEDUCTION_RULES: SeedDeductionRule[] = [
  {
    countryCode: "NG",
    ruleType: "income_tax",
    ruleName: "PAYE 0 - 300,000 NGN",
    bracketMin: 0,
    bracketMax: 30_000_000,
    rate: 0.07,
    flatAmount: null,
    employerPortionRate: null,
    calculationOrder: 0,
    notes: "PAYE bracket 1",
    effectiveFrom: NIGERIA_DEDUCTION_EFFECTIVE_FROM
  },
  {
    countryCode: "NG",
    ruleType: "income_tax",
    ruleName: "PAYE 300,000 - 600,000 NGN",
    bracketMin: 30_000_000,
    bracketMax: 60_000_000,
    rate: 0.11,
    flatAmount: null,
    employerPortionRate: null,
    calculationOrder: 1,
    notes: "PAYE bracket 2",
    effectiveFrom: NIGERIA_DEDUCTION_EFFECTIVE_FROM
  },
  {
    countryCode: "NG",
    ruleType: "income_tax",
    ruleName: "PAYE 600,000 - 1,100,000 NGN",
    bracketMin: 60_000_000,
    bracketMax: 110_000_000,
    rate: 0.15,
    flatAmount: null,
    employerPortionRate: null,
    calculationOrder: 2,
    notes: "PAYE bracket 3",
    effectiveFrom: NIGERIA_DEDUCTION_EFFECTIVE_FROM
  },
  {
    countryCode: "NG",
    ruleType: "income_tax",
    ruleName: "PAYE 1,100,000 - 1,600,000 NGN",
    bracketMin: 110_000_000,
    bracketMax: 160_000_000,
    rate: 0.19,
    flatAmount: null,
    employerPortionRate: null,
    calculationOrder: 3,
    notes: "PAYE bracket 4",
    effectiveFrom: NIGERIA_DEDUCTION_EFFECTIVE_FROM
  },
  {
    countryCode: "NG",
    ruleType: "income_tax",
    ruleName: "PAYE 1,600,000 - 3,200,000 NGN",
    bracketMin: 160_000_000,
    bracketMax: 320_000_000,
    rate: 0.21,
    flatAmount: null,
    employerPortionRate: null,
    calculationOrder: 4,
    notes: "PAYE bracket 5",
    effectiveFrom: NIGERIA_DEDUCTION_EFFECTIVE_FROM
  },
  {
    countryCode: "NG",
    ruleType: "income_tax",
    ruleName: "PAYE Above 3,200,000 NGN",
    bracketMin: 320_000_000,
    bracketMax: null,
    rate: 0.24,
    flatAmount: null,
    employerPortionRate: null,
    calculationOrder: 5,
    notes: "PAYE top bracket",
    effectiveFrom: NIGERIA_DEDUCTION_EFFECTIVE_FROM
  },
  {
    countryCode: "NG",
    ruleType: "relief",
    ruleName: "CRA Fixed",
    bracketMin: null,
    bracketMax: null,
    rate: null,
    flatAmount: 20_000_000,
    employerPortionRate: null,
    calculationOrder: 100,
    notes: "CRA fixed amount",
    effectiveFrom: NIGERIA_DEDUCTION_EFFECTIVE_FROM
  },
  {
    countryCode: "NG",
    ruleType: "relief",
    ruleName: "CRA 1%",
    bracketMin: null,
    bracketMax: null,
    rate: 0.01,
    flatAmount: null,
    employerPortionRate: null,
    calculationOrder: 101,
    notes: "CRA 1% component",
    effectiveFrom: NIGERIA_DEDUCTION_EFFECTIVE_FROM
  },
  {
    countryCode: "NG",
    ruleType: "relief",
    ruleName: "CRA 20%",
    bracketMin: null,
    bracketMax: null,
    rate: 0.2,
    flatAmount: null,
    employerPortionRate: null,
    calculationOrder: 102,
    notes: "CRA 20% component",
    effectiveFrom: NIGERIA_DEDUCTION_EFFECTIVE_FROM
  },
  {
    countryCode: "NG",
    ruleType: "pension_employee",
    ruleName: "Pension (Employee)",
    bracketMin: null,
    bracketMax: null,
    rate: 0.08,
    flatAmount: null,
    employerPortionRate: null,
    calculationOrder: 200,
    notes: "Employee pension contribution",
    effectiveFrom: NIGERIA_DEDUCTION_EFFECTIVE_FROM
  },
  {
    countryCode: "NG",
    ruleType: "pension_employer",
    ruleName: "Pension (Employer)",
    bracketMin: null,
    bracketMax: null,
    rate: null,
    flatAmount: null,
    employerPortionRate: 0.1,
    calculationOrder: 201,
    notes: "Employer pension contribution",
    effectiveFrom: NIGERIA_DEDUCTION_EFFECTIVE_FROM
  },
  {
    countryCode: "NG",
    ruleType: "housing_fund",
    ruleName: "NHF",
    bracketMin: null,
    bracketMax: null,
    rate: 0.025,
    flatAmount: null,
    employerPortionRate: null,
    calculationOrder: 300,
    notes: "National Housing Fund contribution",
    effectiveFrom: NIGERIA_DEDUCTION_EFFECTIVE_FROM
  },
  {
    countryCode: "NG",
    ruleType: "social_insurance",
    ruleName: "NSITF",
    bracketMin: null,
    bracketMax: null,
    rate: 0.01,
    flatAmount: null,
    employerPortionRate: 0.01,
    calculationOrder: 400,
    notes: "National Social Insurance Trust Fund contribution",
    effectiveFrom: NIGERIA_DEDUCTION_EFFECTIVE_FROM
  }
];

const SEED_PERFORMANCE_TEMPLATE_SECTIONS: SeedReviewSection[] = [
  {
    id: "delivery",
    title: "Delivery",
    description: "Execution quality and measurable outcomes.",
    questions: [
      {
        id: "delivery-impact-rating",
        title: "Delivery impact",
        prompt: "Rate delivery impact for this review period.",
        type: "rating",
        required: true
      },
      {
        id: "delivery-commentary",
        title: "Delivery notes",
        prompt: "Share specific examples of delivery outcomes.",
        type: "text",
        required: true,
        maxLength: 1200
      }
    ]
  },
  {
    id: "collaboration",
    title: "Collaboration",
    description: "Communication, teamwork, and growth focus.",
    questions: [
      {
        id: "collaboration-rating",
        title: "Collaboration effectiveness",
        prompt: "Rate collaboration with teammates and stakeholders.",
        type: "rating",
        required: true
      },
      {
        id: "growth-focus",
        title: "Growth focus",
        prompt: "What should this person continue or improve next cycle?",
        type: "text",
        required: true,
        maxLength: 1200
      }
    ]
  }
];

const SEED_REVIEW_CYCLES: SeedReviewCycle[] = [
  {
    key: "q1_active",
    name: "Q1 2026 Performance Cycle",
    type: "quarterly",
    status: "active",
    startOffsetDays: -21,
    endOffsetDays: 42,
    selfReviewDeadlineOffsetDays: 7,
    managerReviewDeadlineOffsetDays: 18,
    createdByKey: "head_people_finance"
  },
  {
    key: "q4_completed",
    name: "Q4 2025 Performance Cycle",
    type: "quarterly",
    status: "completed",
    startOffsetDays: -170,
    endOffsetDays: -95,
    selfReviewDeadlineOffsetDays: -125,
    managerReviewDeadlineOffsetDays: -110,
    createdByKey: "head_people_finance"
  }
];

const SEED_REVIEW_TEMPLATES: SeedReviewTemplate[] = [
  {
    key: "standard_performance",
    name: "Standard Performance Template",
    sections: SEED_PERFORMANCE_TEMPLATE_SECTIONS,
    createdByKey: "head_people_finance"
  }
];

const SEED_REVIEW_ASSIGNMENTS: SeedReviewAssignment[] = [
  {
    key: "active_engineer_1",
    cycleKey: "q1_active",
    employeeKey: "engineer_1",
    reviewerKey: "eng_manager",
    templateKey: "standard_performance",
    status: "pending_manager",
    dueOffsetDays: 9
  },
  {
    key: "active_ops_associate",
    cycleKey: "q1_active",
    employeeKey: "ops_associate",
    reviewerKey: "ops_manager",
    templateKey: "standard_performance",
    status: "completed",
    dueOffsetDays: 9
  },
  {
    key: "active_engineer_2",
    cycleKey: "q1_active",
    employeeKey: "engineer_2",
    reviewerKey: "ops_manager",
    templateKey: "standard_performance",
    status: "pending_self",
    dueOffsetDays: 9
  },
  {
    key: "active_compliance_officer",
    cycleKey: "q1_active",
    employeeKey: "compliance_officer",
    reviewerKey: "coo",
    templateKey: "standard_performance",
    status: "in_review",
    dueOffsetDays: 10
  },
  {
    key: "active_engineer_3",
    cycleKey: "q1_active",
    employeeKey: "engineer_3",
    reviewerKey: "coo",
    templateKey: "standard_performance",
    status: "pending_self",
    dueOffsetDays: 10
  },
  {
    key: "completed_engineer_1",
    cycleKey: "q4_completed",
    employeeKey: "engineer_1",
    reviewerKey: "eng_manager",
    templateKey: "standard_performance",
    status: "completed",
    dueOffsetDays: -112
  }
];

const SEED_REVIEW_RESPONSES: SeedReviewResponse[] = [
  {
    assignmentKey: "active_engineer_1",
    respondentKey: "engineer_1",
    responseType: "self",
    submittedOffsetDays: -2,
    answers: {
      "delivery-impact-rating": { rating: 4, text: null },
      "delivery-commentary": {
        rating: null,
        text: "Delivered migration tooling ahead of schedule and reduced deployment rollback rate."
      },
      "collaboration-rating": { rating: 4, text: null },
      "growth-focus": {
        rating: null,
        text: "Improve cross-team planning by sharing draft implementation notes earlier."
      }
    }
  },
  {
    assignmentKey: "active_ops_associate",
    respondentKey: "ops_associate",
    responseType: "self",
    submittedOffsetDays: -6,
    answers: {
      "delivery-impact-rating": { rating: 4, text: null },
      "delivery-commentary": {
        rating: null,
        text: "Closed operations tickets within SLA and improved handoff quality across shifts."
      },
      "collaboration-rating": { rating: 5, text: null },
      "growth-focus": {
        rating: null,
        text: "Keep documentation current and improve automation coverage for recurring requests."
      }
    }
  },
  {
    assignmentKey: "active_ops_associate",
    respondentKey: "ops_manager",
    responseType: "manager",
    submittedOffsetDays: -4,
    answers: {
      "delivery-impact-rating": { rating: 5, text: null },
      "delivery-commentary": {
        rating: null,
        text: "Consistently handled high-priority partner escalations with clear ownership."
      },
      "collaboration-rating": { rating: 5, text: null },
      "growth-focus": {
        rating: null,
        text: "Strong communicator. Next goal is mentoring newer teammates on incident workflow."
      }
    }
  },
  {
    assignmentKey: "active_compliance_officer",
    respondentKey: "coo",
    responseType: "manager",
    submittedOffsetDays: -1,
    answers: {
      "delivery-impact-rating": { rating: 4, text: null },
      "delivery-commentary": {
        rating: null,
        text: "Maintained complete regulatory filing record and reduced follow-up requests."
      },
      "collaboration-rating": { rating: 3, text: null },
      "growth-focus": {
        rating: null,
        text: "Prioritize early escalation of cross-country compliance blockers."
      }
    }
  },
  {
    assignmentKey: "completed_engineer_1",
    respondentKey: "engineer_1",
    responseType: "self",
    submittedOffsetDays: -126,
    answers: {
      "delivery-impact-rating": { rating: 4, text: null },
      "delivery-commentary": {
        rating: null,
        text: "Delivered key platform reliability upgrades and improved alerting quality."
      },
      "collaboration-rating": { rating: 4, text: null },
      "growth-focus": {
        rating: null,
        text: "Continue partnering with operations earlier in project scoping."
      }
    }
  },
  {
    assignmentKey: "completed_engineer_1",
    respondentKey: "eng_manager",
    responseType: "manager",
    submittedOffsetDays: -121,
    answers: {
      "delivery-impact-rating": { rating: 5, text: null },
      "delivery-commentary": {
        rating: null,
        text: "Strong execution and incident leadership across high-priority releases."
      },
      "collaboration-rating": { rating: 4, text: null },
      "growth-focus": {
        rating: null,
        text: "Increase delegation to create room for mentoring junior engineers."
      }
    }
  }
];

const SEED_COMPLIANCE_ITEMS: SeedComplianceItem[] = [
  {
    key: "ng_paye",
    countryCode: "NG",
    authority: "FIRS",
    requirement: "PAYE Filing & Remittance",
    description: "Submit monthly PAYE return and remit tax deductions.",
    cadence: "monthly",
    category: "tax",
    notes: "Due by the 10th of each month.",
    dueDay: 10,
    assignedToKey: "head_people_finance"
  },
  {
    key: "ng_pension",
    countryCode: "NG",
    authority: "PENCOM",
    requirement: "Pension Contribution Remittance",
    description: "Remit pension contributions to approved PFAs.",
    cadence: "monthly",
    category: "pension",
    notes: "Due within 7 days after month end.",
    dueDay: 7,
    assignedToKey: "head_people_finance"
  },
  {
    key: "ng_nhf",
    countryCode: "NG",
    authority: "Federal Mortgage Bank of Nigeria",
    requirement: "NHF Contribution Remittance",
    description: "Remit NHF deductions for eligible workers.",
    cadence: "monthly",
    category: "housing",
    notes: "Due at month end.",
    dueDay: "end",
    assignedToKey: "head_people_finance"
  },
  {
    key: "ng_nsitf",
    countryCode: "NG",
    authority: "NSITF",
    requirement: "NSITF Contribution Remittance",
    description: "Remit NSITF social insurance contributions.",
    cadence: "monthly",
    category: "social_insurance",
    notes: "Due at month end.",
    dueDay: "end",
    assignedToKey: "head_people_finance"
  },
  {
    key: "gh_paye",
    countryCode: "GH",
    authority: "GRA",
    requirement: "PAYE Filing & Remittance",
    description: "Submit PAYE filings and settle monthly liabilities.",
    cadence: "monthly",
    category: "tax",
    notes: "Due by the 15th of each month.",
    dueDay: 15,
    assignedToKey: "head_people_finance"
  },
  {
    key: "gh_ssnit",
    countryCode: "GH",
    authority: "SSNIT",
    requirement: "SSNIT Contribution Remittance",
    description: "Remit monthly social security contributions.",
    cadence: "monthly",
    category: "social_insurance",
    notes: "Due by the 14th of each month.",
    dueDay: 14,
    assignedToKey: "head_people_finance"
  },
  {
    key: "ke_paye",
    countryCode: "KE",
    authority: "KRA",
    requirement: "PAYE Filing & Remittance",
    description: "Submit PAYE returns and remit statutory deductions.",
    cadence: "monthly",
    category: "tax",
    notes: "Due by the 9th of each month.",
    dueDay: 9,
    assignedToKey: "ops_manager"
  },
  {
    key: "ke_nssf",
    countryCode: "KE",
    authority: "NSSF",
    requirement: "NSSF Contribution Remittance",
    description: "Remit NSSF contributions for applicable employees.",
    cadence: "monthly",
    category: "pension",
    notes: "Due by the 15th of each month.",
    dueDay: 15,
    assignedToKey: "ops_manager"
  },
  {
    key: "ke_nhif_shif",
    countryCode: "KE",
    authority: "Social Health Authority",
    requirement: "NHIF/SHIF Contribution Remittance",
    description: "Remit NHIF/SHIF deductions before due date.",
    cadence: "monthly",
    category: "health_insurance",
    notes: "Due by the 15th of each month.",
    dueDay: 15,
    assignedToKey: "ops_manager"
  },
  {
    key: "ke_housing",
    countryCode: "KE",
    authority: "KRA",
    requirement: "Affordable Housing Levy Remittance",
    description: "File and remit the affordable housing levy.",
    cadence: "monthly",
    category: "housing",
    notes: "Due by the 9th of each month.",
    dueDay: 9,
    assignedToKey: "ops_manager"
  },
  {
    key: "za_emp201",
    countryCode: "ZA",
    authority: "SARS",
    requirement: "EMP201 Filing & Payment",
    description: "Submit EMP201 and settle PAYE/UIF/SDL liabilities.",
    cadence: "monthly",
    category: "tax",
    notes: "Due by the 7th of each month.",
    dueDay: 7,
    assignedToKey: "compliance_officer"
  },
  {
    key: "za_uif",
    countryCode: "ZA",
    authority: "UIF",
    requirement: "UIF Contribution Remittance",
    description: "Submit and settle UIF monthly returns.",
    cadence: "monthly",
    category: "social_insurance",
    notes: "Due by the 7th of each month.",
    dueDay: 7,
    assignedToKey: "compliance_officer"
  },
  {
    key: "za_bbbee",
    countryCode: "ZA",
    authority: "B-BBEE Commission",
    requirement: "B-BBEE Annual Compliance Submission",
    description: "Submit annual B-BBEE compliance report.",
    cadence: "annual",
    category: "regulatory",
    notes: "Annual filing tracked in this cycle.",
    dueDay: 25,
    assignedToKey: "compliance_officer",
    annualMonthOffset: 2
  },
  {
    key: "ca_cra",
    countryCode: "CA",
    authority: "CRA",
    requirement: "Payroll Source Deduction Remittance",
    description: "Remit payroll source deductions to CRA.",
    cadence: "monthly",
    category: "tax",
    notes: "Due by the 15th of each month.",
    dueDay: 15,
    assignedToKey: "head_people_finance"
  },
  {
    key: "ca_fintrac",
    countryCode: "CA",
    authority: "FINTRAC",
    requirement: "Ongoing AML/ATF Compliance Monitoring",
    description: "Track and document ongoing FINTRAC obligations.",
    cadence: "ongoing",
    category: "regulatory",
    notes: "Operational monthly compliance checkpoint.",
    dueDay: "end",
    assignedToKey: "compliance_officer"
  }
];

function padMonthDay(value: number): string {
  return String(value).padStart(2, "0");
}

function monthKeyFromParts(year: number, monthOneBased: number): string {
  return `${year}-${padMonthDay(monthOneBased)}`;
}

function monthSeries(nextMonths: number): Array<{ year: number; monthOneBased: number }> {
  const today = new Date();
  const series: Array<{ year: number; monthOneBased: number }> = [];

  for (let offset = 0; offset < nextMonths; offset += 1) {
    const monthDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + offset, 1));
    series.push({
      year: monthDate.getUTCFullYear(),
      monthOneBased: monthDate.getUTCMonth() + 1
    });
  }

  return series;
}

function dueDateFromMonth({
  year,
  monthOneBased,
  dueDay
}: {
  year: number;
  monthOneBased: number;
  dueDay: number | "end";
}): string {
  const lastDay = new Date(Date.UTC(year, monthOneBased, 0)).getUTCDate();
  const resolvedDay = dueDay === "end" ? lastDay : Math.min(dueDay, lastDay);
  return `${monthKeyFromParts(year, monthOneBased)}-${padMonthDay(resolvedDay)}`;
}

function addDaysToIsoDate(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

function buildComplianceDeadlines(items: readonly SeedComplianceItem[]): SeedComplianceDeadline[] {
  const today = new Date().toISOString().slice(0, 10);
  const dueSoonLimitDate = new Date();
  dueSoonLimitDate.setUTCDate(dueSoonLimitDate.getUTCDate() + 7);
  const dueSoonLimit = dueSoonLimitDate.toISOString().slice(0, 10);
  const months = monthSeries(3);
  const deadlines: SeedComplianceDeadline[] = [];

  for (const item of items) {
    if (item.cadence === "annual") {
      const annualOffset = item.annualMonthOffset ?? 2;
      const annualMonth = months[Math.min(annualOffset, months.length - 1)];

      if (!annualMonth) {
        continue;
      }

      const dueDate = dueDateFromMonth({
        year: annualMonth.year,
        monthOneBased: annualMonth.monthOneBased,
        dueDay: item.dueDay
      });

      deadlines.push({
        itemKey: item.key,
        dueDate,
        status: dueDate <= dueSoonLimit ? "in_progress" : "pending",
        assignedToKey: item.assignedToKey,
        completedAt: null,
        notes: "Annual filing milestone."
      });

      continue;
    }

    for (let monthIndex = 0; monthIndex < months.length; monthIndex += 1) {
      const month = months[monthIndex];
      const dueDate = dueDateFromMonth({
        year: month.year,
        monthOneBased: month.monthOneBased,
        dueDay: item.dueDay
      });

      let status: SeedComplianceStatus = "pending";
      let completedAt: string | null = null;

      if (item.key === "gh_paye" && monthIndex === 0) {
        status = "completed";
        completedAt = addDaysToIsoDate(dueDate, -1);
      } else if (dueDate < today) {
        status = "overdue";
      } else if (dueDate <= dueSoonLimit) {
        status = "in_progress";
      }

      deadlines.push({
        itemKey: item.key,
        dueDate,
        status,
        assignedToKey: item.assignedToKey,
        completedAt,
        notes:
          item.cadence === "ongoing"
            ? "Ongoing compliance checkpoint."
            : null
      });
    }
  }

  return deadlines;
}

const SEED_COMPLIANCE_DEADLINES = buildComplianceDeadlines(SEED_COMPLIANCE_ITEMS);

const SEED_EXPENSES: SeedExpense[] = [
  {
    employeeKey: "engineer_1",
    category: "software",
    description: "Annual API testing tool subscription renewal.",
    amount: 24_900,
    currency: "USD",
    expenseDateOffsetDays: -18,
    status: "pending"
  },
  {
    employeeKey: "ops_associate",
    category: "transport",
    description: "Intercity transit for partner onboarding visit.",
    amount: 12_500,
    currency: "USD",
    expenseDateOffsetDays: -15,
    status: "approved",
    approvedByKey: "ops_manager",
    approvedOffsetDays: -13
  },
  {
    employeeKey: "engineer_2",
    category: "internet",
    description: "Monthly high-bandwidth internet reimbursement.",
    amount: 15_000,
    currency: "USD",
    expenseDateOffsetDays: -12,
    status: "reimbursed",
    approvedByKey: "eng_manager",
    approvedOffsetDays: -10,
    reimbursedByKey: "head_people_finance",
    reimbursedOffsetDays: -8,
    reimbursementReference: "RBM-2026-1102",
    reimbursementNotes: "Paid via monthly reimbursement batch."
  },
  {
    employeeKey: "compliance_officer",
    category: "travel",
    description: "Flight and local transit for regulatory workshop.",
    amount: 86_000,
    currency: "USD",
    expenseDateOffsetDays: -21,
    status: "rejected",
    rejectedByKey: "head_people_finance",
    rejectedOffsetDays: -19,
    rejectionReason: "Workshop approval code was missing from the receipt."
  },
  {
    employeeKey: "engineer_3",
    category: "wellness",
    description: "Quarterly wellness allowance reimbursement.",
    amount: 10_000,
    currency: "USD",
    expenseDateOffsetDays: -30,
    status: "reimbursed",
    approvedByKey: "coo",
    approvedOffsetDays: -28,
    reimbursedByKey: "head_people_finance",
    reimbursedOffsetDays: -26,
    reimbursementReference: "RBM-2026-1079",
    reimbursementNotes: "Approved under quarterly wellness policy."
  },
  {
    employeeKey: "ops_manager",
    category: "meals",
    description: "Team meal during cross-country operations planning.",
    amount: 32_450,
    currency: "USD",
    expenseDateOffsetDays: -9,
    status: "pending"
  },
  {
    employeeKey: "eng_manager",
    category: "office_supplies",
    description: "Ergonomic keyboard and headset replacement.",
    amount: 18_990,
    currency: "USD",
    expenseDateOffsetDays: -7,
    status: "approved",
    approvedByKey: "head_people_finance",
    approvedOffsetDays: -6
  }
];

const SEED_NOTIFICATIONS: SeedNotification[] = [
  {
    userKey: "engineer_1",
    type: "leave_status",
    title: "Leave request approved",
    body: "Your annual leave request for next week was approved.",
    link: "/time-off",
    isRead: false,
    createdOffsetDays: -1
  },
  {
    userKey: "ops_associate",
    type: "expense_status",
    title: "Expense approved",
    body: "Your transport expense has been approved.",
    link: "/expenses",
    isRead: false,
    createdOffsetDays: -2
  },
  {
    userKey: "engineer_2",
    type: "payslip_ready",
    title: "Payment statement ready",
    body: "Your latest payment statement is available.",
    link: "/me/payslips",
    isRead: false,
    createdOffsetDays: -3
  },
  {
    userKey: "head_people_finance",
    type: "expense_submitted",
    title: "Expense submitted by Jordan Okoye",
    body: "A new expense submission needs review.",
    link: "/expenses/approvals",
    isRead: false,
    createdOffsetDays: -1
  },
  {
    userKey: "ops_manager",
    type: "leave_submitted",
    title: "Leave request submitted by Sofia Campbell",
    body: "A new leave request is pending approval.",
    link: "/time-off/approvals",
    isRead: true,
    createdOffsetDays: -5
  },
  {
    userKey: "compliance_officer",
    type: "compliance_deadline",
    title: "Compliance reminder",
    body: "EMP201 filing is due this week.",
    link: "/compliance",
    isRead: false,
    createdOffsetDays: -1
  },
  {
    userKey: "coo",
    type: "announcement",
    title: "New announcement: Crew retreat planning",
    body: "New team announcement is available in Announcements.",
    link: "/announcements",
    isRead: true,
    createdOffsetDays: -6
  }
];

function requiredEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function createServiceRoleClient(): SupabaseClient {
  const supabaseUrl = requiredEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
}

async function ensureOrg(client: SupabaseClient): Promise<{ id: string; name: string }> {
  const { data: existingOrg, error: existingOrgError } = await client
    .from("orgs")
    .select("id, name")
    .eq("name", "Accrue")
    .maybeSingle();

  if (existingOrgError) {
    throw new Error(`Unable to query orgs table: ${existingOrgError.message}`);
  }

  if (existingOrg) {
    return existingOrg;
  }

  const { data: createdOrg, error: createOrgError } = await client
    .from("orgs")
    .insert({ name: "Accrue" })
    .select("id, name")
    .single();

  if (createOrgError || !createdOrg) {
    throw new Error(`Unable to create org: ${createOrgError?.message ?? "unknown error"}`);
  }

  return createdOrg;
}

async function listUsersByEmail(client: SupabaseClient): Promise<Map<string, User>> {
  const usersByEmail = new Map<string, User>();
  let page = 1;
  const perPage = 200;

  while (true) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage });

    if (error) {
      throw new Error(`Unable to list auth users: ${error.message}`);
    }

    for (const user of data.users) {
      if (user.email) {
        usersByEmail.set(user.email.toLowerCase(), user);
      }
    }

    if (data.users.length < perPage) {
      break;
    }

    page += 1;
  }

  return usersByEmail;
}

async function ensureAuthUser(
  client: SupabaseClient,
  existingUsersByEmail: Map<string, User>,
  member: SeedMember,
  sharedPassword: string
): Promise<string> {
  const emailKey = member.email.toLowerCase();
  const existingUser = existingUsersByEmail.get(emailKey);

  if (existingUser) {
    return existingUser.id;
  }

  const { data, error } = await client.auth.admin.createUser({
    email: member.email,
    password: sharedPassword,
    email_confirm: true,
    user_metadata: {
      full_name: member.fullName
    }
  });

  if (error || !data.user) {
    throw new Error(`Unable to create auth user for ${member.email}: ${error?.message ?? "unknown error"}`);
  }

  existingUsersByEmail.set(emailKey, data.user);
  return data.user.id;
}

type ProfileRow = {
  id: string;
  org_id: string;
  email: string;
  full_name: string;
  roles: SeedRole[];
  department: SeedMember["department"];
  title: string;
  country_code: SeedMember["countryCode"];
  timezone: string;
  employment_type: "contractor";
  payroll_mode: "contractor_usd_no_withholding";
  primary_currency: "USD";
  manager_id: string | null;
  status: SeedStatus;
  notification_preferences: Record<string, never>;
};

async function upsertProfiles(client: SupabaseClient, rows: ProfileRow[]): Promise<void> {
  const { error } = await client.from("profiles").upsert(rows, { onConflict: "id" });

  if (error) {
    throw new Error(`Unable to upsert profiles: ${error.message}`);
  }
}

async function upsertSeedAnnouncements(
  client: SupabaseClient,
  orgId: string,
  userIdByKey: ReadonlyMap<string, string>
): Promise<void> {
  if (SEED_ANNOUNCEMENTS.length === 0) {
    return;
  }

  const announcementTitles = SEED_ANNOUNCEMENTS.map((announcement) => announcement.title);

  const { data: existingRows, error: existingRowsError } = await client
    .from("announcements")
    .select("id, title")
    .eq("org_id", orgId)
    .is("deleted_at", null)
    .in("title", announcementTitles);

  if (existingRowsError) {
    throw new Error(`Unable to query existing announcements: ${existingRowsError.message}`);
  }

  const existingIdByTitle = new Map(
    (existingRows ?? []).map((row) => [row.title, row.id] as const)
  );
  const announcementReadRows: Array<{
    announcement_id: string;
    user_id: string;
    read_at: string;
  }> = [];

  for (const announcement of SEED_ANNOUNCEMENTS) {
    const authorId = userIdByKey.get(announcement.authorKey);

    if (!authorId) {
      throw new Error(`Missing author user id for announcement ${announcement.title}`);
    }

    const existingAnnouncementId = existingIdByTitle.get(announcement.title);

    if (existingAnnouncementId) {
      const { data: updatedRow, error: updateError } = await client
        .from("announcements")
        .update({
          title: announcement.title,
          body: announcement.body,
          is_pinned: announcement.isPinned,
          created_by: authorId,
          deleted_at: null
        })
        .eq("id", existingAnnouncementId)
        .eq("org_id", orgId)
        .select("id")
        .single();

      if (updateError || !updatedRow) {
        throw new Error(`Unable to update announcement ${announcement.title}: ${updateError?.message ?? "unknown error"}`);
      }

      announcementReadRows.push({
        announcement_id: updatedRow.id,
        user_id: authorId,
        read_at: new Date().toISOString()
      });

      continue;
    }

    const { data: insertedRow, error: insertError } = await client
      .from("announcements")
      .insert({
        org_id: orgId,
        title: announcement.title,
        body: announcement.body,
        is_pinned: announcement.isPinned,
        created_by: authorId
      })
      .select("id")
      .single();

    if (insertError || !insertedRow) {
      throw new Error(`Unable to insert announcement ${announcement.title}: ${insertError?.message ?? "unknown error"}`);
    }

    announcementReadRows.push({
      announcement_id: insertedRow.id,
      user_id: authorId,
      read_at: new Date().toISOString()
    });
  }

  if (announcementReadRows.length > 0) {
    const { error: readUpsertError } = await client
      .from("announcement_reads")
      .upsert(announcementReadRows, { onConflict: "announcement_id,user_id" });

    if (readUpsertError) {
      throw new Error(`Unable to upsert announcement reads: ${readUpsertError.message}`);
    }
  }
}

function dateWithOffset(offsetDays: number): string {
  const baseDate = new Date();
  baseDate.setUTCDate(baseDate.getUTCDate() + offsetDays);
  return baseDate.toISOString().slice(0, 10);
}

function oneDayBeforeDate(isoDate: string): string {
  const parsedDate = new Date(`${isoDate}T00:00:00.000Z`);
  parsedDate.setUTCDate(parsedDate.getUTCDate() - 1);
  return parsedDate.toISOString().slice(0, 10);
}

function timestampWithOffsetDays(offsetDays: number): string {
  const baseDate = new Date();
  baseDate.setUTCDate(baseDate.getUTCDate() + offsetDays);
  return baseDate.toISOString();
}

function timestampWithOffsetHours(offsetHours: number): string {
  const baseDate = new Date();
  baseDate.setUTCHours(baseDate.getUTCHours() + offsetHours);
  return baseDate.toISOString();
}

function slugifyForPath(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

async function upsertSeedDocuments(
  client: SupabaseClient,
  orgId: string,
  userIdByKey: ReadonlyMap<string, string>
): Promise<void> {
  if (SEED_DOCUMENTS.length === 0) {
    return;
  }

  const documentTitles = SEED_DOCUMENTS.map((document) => document.title);

  const { data: existingRows, error: existingRowsError } = await client
    .from("documents")
    .select("id, title")
    .eq("org_id", orgId)
    .is("deleted_at", null)
    .in("title", documentTitles);

  if (existingRowsError) {
    throw new Error(`Unable to query existing documents: ${existingRowsError.message}`);
  }

  const existingIdByTitle = new Map(
    (existingRows ?? []).map((row) => [row.title, row.id] as const)
  );

  const versionRows: Array<{
    org_id: string;
    document_id: string;
    version: number;
    file_path: string;
    uploaded_by: string;
  }> = [];

  for (const document of SEED_DOCUMENTS) {
    const ownerUserId = document.ownerKey ? userIdByKey.get(document.ownerKey) ?? null : null;
    const createdByUserId = userIdByKey.get(document.createdByKey);

    if (!createdByUserId) {
      throw new Error(`Missing creator user id for document ${document.title}`);
    }

    if (document.ownerKey && !ownerUserId) {
      throw new Error(`Missing owner user id for document ${document.title}`);
    }

    const baseSlug = slugifyForPath(document.title);
    const latestVersion = Math.max(1, document.versionCount);
    const latestPath = `${orgId}/seed/${baseSlug}/v${latestVersion}-${document.fileName}`;
    const expiryDate =
      document.expiryOffsetDays === null ? null : dateWithOffset(document.expiryOffsetDays);
    const existingDocumentId = existingIdByTitle.get(document.title);

    let documentId: string;

    if (existingDocumentId) {
      const { data: updatedRow, error: updateError } = await client
        .from("documents")
        .update({
          owner_user_id: ownerUserId,
          category: document.category,
          title: document.title,
          description: document.description,
          file_path: latestPath,
          file_name: document.fileName,
          mime_type: document.mimeType,
          size_bytes: document.sizeBytes,
          expiry_date: expiryDate,
          country_code: document.countryCode,
          created_by: createdByUserId,
          deleted_at: null
        })
        .eq("id", existingDocumentId)
        .eq("org_id", orgId)
        .select("id")
        .single();

      if (updateError || !updatedRow) {
        throw new Error(`Unable to update document ${document.title}: ${updateError?.message ?? "unknown error"}`);
      }

      documentId = updatedRow.id;
    } else {
      const { data: insertedRow, error: insertError } = await client
        .from("documents")
        .insert({
          org_id: orgId,
          owner_user_id: ownerUserId,
          category: document.category,
          title: document.title,
          description: document.description,
          file_path: latestPath,
          file_name: document.fileName,
          mime_type: document.mimeType,
          size_bytes: document.sizeBytes,
          expiry_date: expiryDate,
          country_code: document.countryCode,
          created_by: createdByUserId
        })
        .select("id")
        .single();

      if (insertError || !insertedRow) {
        throw new Error(`Unable to insert document ${document.title}: ${insertError?.message ?? "unknown error"}`);
      }

      documentId = insertedRow.id;
    }

    for (let version = 1; version <= latestVersion; version += 1) {
      const versionPath = `${orgId}/seed/${baseSlug}/v${version}-${document.fileName}`;

      versionRows.push({
        org_id: orgId,
        document_id: documentId,
        version,
        file_path: versionPath,
        uploaded_by: createdByUserId
      });
    }
  }

  if (versionRows.length > 0) {
    const { error: versionUpsertError } = await client
      .from("document_versions")
      .upsert(versionRows, { onConflict: "document_id,version" });

    if (versionUpsertError) {
      throw new Error(`Unable to upsert document versions: ${versionUpsertError.message}`);
    }
  }
}

async function upsertSeedOnboarding(
  client: SupabaseClient,
  orgId: string,
  userIdByKey: ReadonlyMap<string, string>
): Promise<void> {
  if (SEED_ONBOARDING_TEMPLATES.length === 0 && SEED_ONBOARDING_INSTANCES.length === 0) {
    return;
  }

  const templateNames = SEED_ONBOARDING_TEMPLATES.map((template) => template.name);

  const { data: existingTemplateRows, error: existingTemplateError } = await client
    .from("onboarding_templates")
    .select("id, name")
    .eq("org_id", orgId)
    .is("deleted_at", null)
    .in("name", templateNames);

  if (existingTemplateError) {
    throw new Error(`Unable to query existing onboarding templates: ${existingTemplateError.message}`);
  }

  const existingTemplateIdByName = new Map(
    (existingTemplateRows ?? []).map((row) => [row.name, row.id] as const)
  );
  const templateIdByKey = new Map<string, string>();

  for (const template of SEED_ONBOARDING_TEMPLATES) {
    const templatePayload = {
      org_id: orgId,
      name: template.name,
      type: template.type,
      country_code: template.countryCode,
      department: template.department,
      tasks: template.tasks.map((task) => ({
        title: task.title,
        description: task.description,
        category: task.category,
        dueOffsetDays: task.dueOffsetDays
      }))
    };

    const existingTemplateId = existingTemplateIdByName.get(template.name);
    let templateId: string;

    if (existingTemplateId) {
      const { data: updatedTemplate, error: updateTemplateError } = await client
        .from("onboarding_templates")
        .update({
          ...templatePayload,
          deleted_at: null
        })
        .eq("id", existingTemplateId)
        .eq("org_id", orgId)
        .select("id")
        .single();

      if (updateTemplateError || !updatedTemplate) {
        throw new Error(
          `Unable to update onboarding template ${template.name}: ${updateTemplateError?.message ?? "unknown error"}`
        );
      }

      templateId = updatedTemplate.id;
    } else {
      const { data: insertedTemplate, error: insertTemplateError } = await client
        .from("onboarding_templates")
        .insert(templatePayload)
        .select("id")
        .single();

      if (insertTemplateError || !insertedTemplate) {
        throw new Error(
          `Unable to insert onboarding template ${template.name}: ${insertTemplateError?.message ?? "unknown error"}`
        );
      }

      templateId = insertedTemplate.id;
    }

    templateIdByKey.set(template.key, templateId);
  }

  for (const instance of SEED_ONBOARDING_INSTANCES) {
    const templateId = templateIdByKey.get(instance.templateKey);

    if (!templateId) {
      throw new Error(`Missing template id for onboarding instance template ${instance.templateKey}`);
    }

    const employeeId = userIdByKey.get(instance.employeeKey);

    if (!employeeId) {
      throw new Error(`Missing employee user id for onboarding instance ${instance.employeeKey}`);
    }

    const startedAt = timestampWithOffsetDays(instance.startedOffsetDays);
    const completedAt =
      instance.completedOffsetDays === null
        ? null
        : timestampWithOffsetDays(instance.completedOffsetDays);

    const { data: existingInstance, error: existingInstanceError } = await client
      .from("onboarding_instances")
      .select("id")
      .eq("org_id", orgId)
      .eq("employee_id", employeeId)
      .eq("template_id", templateId)
      .eq("type", instance.type)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingInstanceError) {
      throw new Error(`Unable to query existing onboarding instances: ${existingInstanceError.message}`);
    }

    const instancePayload = {
      org_id: orgId,
      employee_id: employeeId,
      template_id: templateId,
      type: instance.type,
      status: instance.status,
      started_at: startedAt,
      completed_at: completedAt
    };

    let instanceId: string;

    if (existingInstance?.id) {
      const { data: updatedInstance, error: updateInstanceError } = await client
        .from("onboarding_instances")
        .update({
          ...instancePayload,
          deleted_at: null
        })
        .eq("id", existingInstance.id)
        .eq("org_id", orgId)
        .select("id")
        .single();

      if (updateInstanceError || !updatedInstance) {
        throw new Error(
          `Unable to update onboarding instance for ${instance.employeeKey}: ${updateInstanceError?.message ?? "unknown error"}`
        );
      }

      instanceId = updatedInstance.id;
    } else {
      const { data: insertedInstance, error: insertInstanceError } = await client
        .from("onboarding_instances")
        .insert(instancePayload)
        .select("id")
        .single();

      if (insertInstanceError || !insertedInstance) {
        throw new Error(
          `Unable to insert onboarding instance for ${instance.employeeKey}: ${insertInstanceError?.message ?? "unknown error"}`
        );
      }

      instanceId = insertedInstance.id;
    }

    const { data: existingTaskRows, error: existingTasksError } = await client
      .from("onboarding_tasks")
      .select("id, title")
      .eq("org_id", orgId)
      .eq("instance_id", instanceId)
      .is("deleted_at", null);

    if (existingTasksError) {
      throw new Error(`Unable to query existing onboarding tasks: ${existingTasksError.message}`);
    }

    const existingTaskIdByTitle = new Map(
      (existingTaskRows ?? []).map((row) => [row.title, row.id] as const)
    );

    for (const task of instance.tasks) {
      const assignedToUserId =
        task.assignedToKey === null ? null : userIdByKey.get(task.assignedToKey) ?? null;

      if (task.assignedToKey && !assignedToUserId) {
        throw new Error(
          `Missing assigned user id for onboarding task ${task.title} (${task.assignedToKey})`
        );
      }

      const completedByUserId =
        task.completedByKey === null ? null : userIdByKey.get(task.completedByKey) ?? null;

      if (task.completedByKey && !completedByUserId) {
        throw new Error(
          `Missing completed_by user id for onboarding task ${task.title} (${task.completedByKey})`
        );
      }

      const taskPayload = {
        org_id: orgId,
        instance_id: instanceId,
        title: task.title,
        description: task.description,
        category: task.category,
        status: task.status,
        assigned_to: assignedToUserId,
        due_date: task.dueOffsetDays === null ? null : dateWithOffset(task.dueOffsetDays),
        completed_at:
          task.completedOffsetDays === null ? null : timestampWithOffsetDays(task.completedOffsetDays),
        completed_by: completedByUserId,
        notes: task.notes
      };

      const existingTaskId = existingTaskIdByTitle.get(task.title);

      if (existingTaskId) {
        const { error: updateTaskError } = await client
          .from("onboarding_tasks")
          .update({
            ...taskPayload,
            deleted_at: null
          })
          .eq("id", existingTaskId)
          .eq("org_id", orgId);

        if (updateTaskError) {
          throw new Error(
            `Unable to update onboarding task ${task.title}: ${updateTaskError.message}`
          );
        }
      } else {
        const { error: insertTaskError } = await client
          .from("onboarding_tasks")
          .insert(taskPayload);

        if (insertTaskError) {
          throw new Error(
            `Unable to insert onboarding task ${task.title}: ${insertTaskError.message}`
          );
        }
      }
    }
  }
}

async function upsertSeedTimeOff(
  client: SupabaseClient,
  orgId: string,
  userIdByKey: ReadonlyMap<string, string>
): Promise<void> {
  if (SEED_LEAVE_POLICIES.length > 0) {
    const policyRows = SEED_LEAVE_POLICIES.map((policy) => ({
      org_id: orgId,
      country_code: policy.countryCode,
      leave_type: policy.leaveType,
      default_days_per_year: policy.defaultDaysPerYear,
      accrual_type: policy.accrualType,
      carry_over: policy.carryOver,
      notes: policy.notes,
      deleted_at: null
    }));

    const { error: policyUpsertError } = await client
      .from("leave_policies")
      .upsert(policyRows, { onConflict: "org_id,country_code,leave_type" });

    if (policyUpsertError) {
      throw new Error(`Unable to upsert leave policies: ${policyUpsertError.message}`);
    }
  }

  if (SEED_HOLIDAYS.length > 0) {
    const holidayRows = SEED_HOLIDAYS.map((holiday) => ({
      org_id: orgId,
      country_code: holiday.countryCode,
      date: holiday.date,
      name: holiday.name,
      year: Number.parseInt(holiday.date.slice(0, 4), 10),
      deleted_at: null
    }));

    const { error: holidayUpsertError } = await client
      .from("holiday_calendars")
      .upsert(holidayRows, { onConflict: "org_id,country_code,date" });

    if (holidayUpsertError) {
      throw new Error(`Unable to upsert holiday calendars: ${holidayUpsertError.message}`);
    }
  }

  if (SEED_LEAVE_BALANCES.length > 0) {
    const balanceRows = SEED_LEAVE_BALANCES.map((balance) => {
      const employeeId = userIdByKey.get(balance.employeeKey);

      if (!employeeId) {
        throw new Error(`Missing employee user id for leave balance seed (${balance.employeeKey})`);
      }

      return {
        org_id: orgId,
        employee_id: employeeId,
        leave_type: balance.leaveType,
        year: CURRENT_SEED_YEAR,
        total_days: balance.totalDays,
        used_days: balance.usedDays,
        pending_days: balance.pendingDays,
        carried_days: balance.carriedDays,
        deleted_at: null
      };
    });

    const { error: balanceUpsertError } = await client
      .from("leave_balances")
      .upsert(balanceRows, { onConflict: "employee_id,leave_type,year" });

    if (balanceUpsertError) {
      throw new Error(`Unable to upsert leave balances: ${balanceUpsertError.message}`);
    }
  }

  for (const request of SEED_LEAVE_REQUESTS) {
    const employeeId = userIdByKey.get(request.employeeKey);

    if (!employeeId) {
      throw new Error(`Missing employee user id for leave request seed (${request.employeeKey})`);
    }

    const approverId = request.approverKey ? userIdByKey.get(request.approverKey) ?? null : null;

    if (request.approverKey && !approverId) {
      throw new Error(`Missing approver user id for leave request seed (${request.approverKey})`);
    }

    const { data: existingRequest, error: existingRequestError } = await client
      .from("leave_requests")
      .select("id")
      .eq("org_id", orgId)
      .eq("employee_id", employeeId)
      .eq("leave_type", request.leaveType)
      .eq("start_date", request.startDate)
      .eq("end_date", request.endDate)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingRequestError) {
      throw new Error(`Unable to query leave requests seed data: ${existingRequestError.message}`);
    }

    const payload = {
      org_id: orgId,
      employee_id: employeeId,
      leave_type: request.leaveType,
      start_date: request.startDate,
      end_date: request.endDate,
      total_days: request.totalDays,
      status: request.status,
      reason: request.reason,
      approver_id: approverId,
      rejection_reason: request.rejectionReason,
      deleted_at: null
    };

    if (existingRequest?.id) {
      const { error: updateError } = await client
        .from("leave_requests")
        .update(payload)
        .eq("id", existingRequest.id)
        .eq("org_id", orgId);

      if (updateError) {
        throw new Error(`Unable to update leave request seed data: ${updateError.message}`);
      }
    } else {
      const { error: insertError } = await client.from("leave_requests").insert(payload);

      if (insertError) {
        throw new Error(`Unable to insert leave request seed data: ${insertError.message}`);
      }
    }
  }
}

async function upsertSeedCompensation(
  client: SupabaseClient,
  orgId: string,
  userIdByKey: ReadonlyMap<string, string>
): Promise<void> {
  for (const compensation of SEED_COMPENSATION_RECORDS) {
    const employeeId = userIdByKey.get(compensation.employeeKey);

    if (!employeeId) {
      throw new Error(
        `Missing employee user id for compensation seed (${compensation.employeeKey})`
      );
    }

    const approvedById = compensation.approvedByKey
      ? userIdByKey.get(compensation.approvedByKey) ?? null
      : null;

    if (compensation.approvedByKey && !approvedById) {
      throw new Error(
        `Missing approver user id for compensation seed (${compensation.approvedByKey})`
      );
    }

    const effectiveFrom = dateWithOffset(compensation.effectiveOffsetDays);
    const effectiveTo =
      compensation.effectiveToOffsetDays === null
        ? null
        : dateWithOffset(compensation.effectiveToOffsetDays);

    const { data: existingRecord, error: existingRecordError } = await client
      .from("compensation_records")
      .select("id")
      .eq("org_id", orgId)
      .eq("employee_id", employeeId)
      .eq("effective_from", effectiveFrom)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingRecordError) {
      throw new Error(
        `Unable to query compensation records seed data: ${existingRecordError.message}`
      );
    }

    const payload = {
      org_id: orgId,
      employee_id: employeeId,
      base_salary_amount: compensation.baseSalaryAmount,
      currency: compensation.currency,
      pay_frequency: compensation.payFrequency,
      employment_type: compensation.employmentType,
      effective_from: effectiveFrom,
      effective_to: effectiveTo,
      approved_by: approvedById,
      deleted_at: null
    };

    if (existingRecord?.id) {
      const { error: updateError } = await client
        .from("compensation_records")
        .update(payload)
        .eq("id", existingRecord.id)
        .eq("org_id", orgId);

      if (updateError) {
        throw new Error(
          `Unable to update compensation record seed data: ${updateError.message}`
        );
      }
    } else {
      const { error: insertError } = await client
        .from("compensation_records")
        .insert(payload);

      if (insertError) {
        throw new Error(
          `Unable to insert compensation record seed data: ${insertError.message}`
        );
      }
    }
  }

  for (const allowance of SEED_ALLOWANCES) {
    const employeeId = userIdByKey.get(allowance.employeeKey);

    if (!employeeId) {
      throw new Error(
        `Missing employee user id for allowance seed (${allowance.employeeKey})`
      );
    }

    const effectiveFrom = dateWithOffset(allowance.effectiveOffsetDays);
    const effectiveTo =
      allowance.effectiveToOffsetDays === null
        ? null
        : dateWithOffset(allowance.effectiveToOffsetDays);

    const { data: existingAllowance, error: existingAllowanceError } = await client
      .from("allowances")
      .select("id")
      .eq("org_id", orgId)
      .eq("employee_id", employeeId)
      .eq("type", allowance.type)
      .eq("label", allowance.label)
      .eq("effective_from", effectiveFrom)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingAllowanceError) {
      throw new Error(
        `Unable to query allowance seed data: ${existingAllowanceError.message}`
      );
    }

    const payload = {
      org_id: orgId,
      employee_id: employeeId,
      type: allowance.type,
      label: allowance.label,
      amount: allowance.amount,
      currency: allowance.currency,
      is_taxable: allowance.isTaxable,
      effective_from: effectiveFrom,
      effective_to: effectiveTo,
      deleted_at: null
    };

    if (existingAllowance?.id) {
      const { error: updateError } = await client
        .from("allowances")
        .update(payload)
        .eq("id", existingAllowance.id)
        .eq("org_id", orgId);

      if (updateError) {
        throw new Error(`Unable to update allowance seed data: ${updateError.message}`);
      }
    } else {
      const { error: insertError } = await client.from("allowances").insert(payload);

      if (insertError) {
        throw new Error(`Unable to insert allowance seed data: ${insertError.message}`);
      }
    }
  }

  for (const grant of SEED_EQUITY_GRANTS) {
    const employeeId = userIdByKey.get(grant.employeeKey);

    if (!employeeId) {
      throw new Error(`Missing employee user id for equity seed (${grant.employeeKey})`);
    }

    const approvedById = grant.approvedByKey
      ? userIdByKey.get(grant.approvedByKey) ?? null
      : null;

    if (grant.approvedByKey && !approvedById) {
      throw new Error(
        `Missing approver user id for equity seed (${grant.approvedByKey})`
      );
    }

    const grantDate = dateWithOffset(grant.grantOffsetDays);
    const vestingStartDate = dateWithOffset(grant.vestingStartOffsetDays);
    const boardApprovalDate =
      grant.boardApprovalOffsetDays === null
        ? null
        : dateWithOffset(grant.boardApprovalOffsetDays);

    const { data: existingGrant, error: existingGrantError } = await client
      .from("equity_grants")
      .select("id")
      .eq("org_id", orgId)
      .eq("employee_id", employeeId)
      .eq("grant_type", grant.grantType)
      .eq("grant_date", grantDate)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingGrantError) {
      throw new Error(`Unable to query equity seed data: ${existingGrantError.message}`);
    }

    const payload = {
      org_id: orgId,
      employee_id: employeeId,
      grant_type: grant.grantType,
      number_of_shares: grant.numberOfShares,
      exercise_price_cents: grant.exercisePriceCents,
      grant_date: grantDate,
      vesting_start_date: vestingStartDate,
      cliff_months: grant.cliffMonths,
      vesting_duration_months: grant.vestingDurationMonths,
      schedule: "monthly",
      status: grant.status,
      approved_by: approvedById,
      board_approval_date: boardApprovalDate,
      notes: grant.notes,
      deleted_at: null
    };

    if (existingGrant?.id) {
      const { error: updateError } = await client
        .from("equity_grants")
        .update(payload)
        .eq("id", existingGrant.id)
        .eq("org_id", orgId);

      if (updateError) {
        throw new Error(`Unable to update equity seed data: ${updateError.message}`);
      }
    } else {
      const { error: insertError } = await client.from("equity_grants").insert(payload);

      if (insertError) {
        throw new Error(`Unable to insert equity seed data: ${insertError.message}`);
      }
    }
  }
}

async function upsertSeedCompensationBands(
  client: SupabaseClient,
  orgId: string,
  userIdByKey: ReadonlyMap<string, string>
): Promise<void> {
  const bandIdByKey = new Map<string, string>();

  for (const band of SEED_COMPENSATION_BANDS) {
    const createdById = userIdByKey.get(band.createdByKey);

    if (!createdById) {
      throw new Error(`Missing creator id for compensation band seed (${band.createdByKey})`);
    }

    const effectiveFrom = dateWithOffset(band.effectiveOffsetDays);
    const effectiveTo =
      band.effectiveToOffsetDays === null ? null : dateWithOffset(band.effectiveToOffsetDays);

    const { data: existingBand, error: existingBandError } = await client
      .from("compensation_bands")
      .select("id")
      .eq("org_id", orgId)
      .eq("title", band.title)
      .eq("level", band.level)
      .eq("location_type", band.locationType)
      .eq("location_value", band.locationValue)
      .eq("effective_from", effectiveFrom)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingBandError) {
      throw new Error(`Unable to query compensation bands seed data: ${existingBandError.message}`);
    }

    const payload = {
      org_id: orgId,
      title: band.title,
      level: band.level,
      department: band.department,
      location_type: band.locationType,
      location_value: band.locationValue,
      currency: band.currency,
      min_salary_amount: band.minSalaryAmount,
      mid_salary_amount: band.midSalaryAmount,
      max_salary_amount: band.maxSalaryAmount,
      equity_min: band.equityMin,
      equity_max: band.equityMax,
      effective_from: effectiveFrom,
      effective_to: effectiveTo,
      created_by: createdById,
      updated_by: createdById,
      deleted_at: null as string | null
    };

    if (existingBand?.id) {
      const { error: updateError } = await client
        .from("compensation_bands")
        .update(payload)
        .eq("id", existingBand.id)
        .eq("org_id", orgId);

      if (updateError) {
        throw new Error(`Unable to update compensation band seed data: ${updateError.message}`);
      }

      bandIdByKey.set(band.key, existingBand.id);
    } else {
      const { data: insertedBand, error: insertError } = await client
        .from("compensation_bands")
        .insert(payload)
        .select("id")
        .single();

      if (insertError || !insertedBand?.id) {
        throw new Error(
          `Unable to insert compensation band seed data: ${insertError?.message ?? "unknown error"}`
        );
      }

      bandIdByKey.set(band.key, insertedBand.id);
    }
  }

  for (const benchmark of SEED_BENCHMARK_DATA) {
    const importedById = userIdByKey.get(benchmark.importedByKey);

    if (!importedById) {
      throw new Error(`Missing importer id for benchmark seed (${benchmark.importedByKey})`);
    }

    const { data: existingBenchmark, error: existingBenchmarkError } = await client
      .from("benchmark_data")
      .select("id")
      .eq("org_id", orgId)
      .eq("source", benchmark.source)
      .eq("title", benchmark.title)
      .eq("level", benchmark.level)
      .eq("location", benchmark.location)
      .is("deleted_at", null)
      .order("imported_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingBenchmarkError) {
      throw new Error(`Unable to query benchmark seed data: ${existingBenchmarkError.message}`);
    }

    const payload = {
      org_id: orgId,
      source: benchmark.source,
      title: benchmark.title,
      level: benchmark.level,
      location: benchmark.location,
      currency: benchmark.currency,
      p25: benchmark.p25,
      p50: benchmark.p50,
      p75: benchmark.p75,
      p90: benchmark.p90,
      imported_by: importedById,
      imported_at: timestampWithOffsetDays(benchmark.importedOffsetDays),
      deleted_at: null as string | null
    };

    if (existingBenchmark?.id) {
      const { error: updateError } = await client
        .from("benchmark_data")
        .update(payload)
        .eq("id", existingBenchmark.id)
        .eq("org_id", orgId);

      if (updateError) {
        throw new Error(`Unable to update benchmark seed data: ${updateError.message}`);
      }
    } else {
      const { error: insertError } = await client.from("benchmark_data").insert(payload);

      if (insertError) {
        throw new Error(`Unable to insert benchmark seed data: ${insertError.message}`);
      }
    }
  }

  for (const assignment of SEED_COMPENSATION_BAND_ASSIGNMENTS) {
    const employeeId = userIdByKey.get(assignment.employeeKey);
    const assignedById = userIdByKey.get(assignment.assignedByKey);
    const bandId = bandIdByKey.get(assignment.bandKey);

    if (!employeeId) {
      throw new Error(`Missing employee id for compensation band assignment (${assignment.employeeKey})`);
    }

    if (!assignedById) {
      throw new Error(`Missing assigner id for compensation band assignment (${assignment.assignedByKey})`);
    }

    if (!bandId) {
      throw new Error(`Missing band id for compensation band assignment (${assignment.bandKey})`);
    }

    const effectiveFrom = dateWithOffset(assignment.effectiveOffsetDays);
    const effectiveTo =
      assignment.effectiveToOffsetDays === null
        ? null
        : dateWithOffset(assignment.effectiveToOffsetDays);

    const payload = {
      org_id: orgId,
      employee_id: employeeId,
      band_id: bandId,
      assigned_by: assignedById,
      effective_from: effectiveFrom,
      effective_to: effectiveTo,
      deleted_at: null as string | null
    };

    const { data: existingAssignment, error: existingAssignmentError } = await client
      .from("compensation_band_assignments")
      .select("id")
      .eq("org_id", orgId)
      .eq("employee_id", employeeId)
      .eq("band_id", bandId)
      .eq("effective_from", effectiveFrom)
      .is("deleted_at", null)
      .order("assigned_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingAssignmentError) {
      throw new Error(
        `Unable to query compensation band assignment seed data: ${existingAssignmentError.message}`
      );
    }

    if (existingAssignment?.id) {
      const { error: updateError } = await client
        .from("compensation_band_assignments")
        .update(payload)
        .eq("id", existingAssignment.id)
        .eq("org_id", orgId);

      if (updateError) {
        throw new Error(
          `Unable to update compensation band assignment seed data: ${updateError.message}`
        );
      }

      continue;
    }

    const { data: activeAssignments, error: activeAssignmentsError } = await client
      .from("compensation_band_assignments")
      .select("id, effective_from")
      .eq("org_id", orgId)
      .eq("employee_id", employeeId)
      .is("deleted_at", null)
      .is("effective_to", null)
      .order("effective_from", { ascending: false });

    if (activeAssignmentsError) {
      throw new Error(
        `Unable to query active compensation band assignments: ${activeAssignmentsError.message}`
      );
    }

    const sameStartAssignment = (activeAssignments ?? []).find(
      (row) => typeof row.effective_from === "string" && row.effective_from === effectiveFrom
    );

    if (sameStartAssignment?.id) {
      const { error: sameStartUpdateError } = await client
        .from("compensation_band_assignments")
        .update(payload)
        .eq("id", sameStartAssignment.id)
        .eq("org_id", orgId);

      if (sameStartUpdateError) {
        throw new Error(
          `Unable to update compensation band assignment with same start date: ${sameStartUpdateError.message}`
        );
      }

      continue;
    }

    const closeDate = oneDayBeforeDate(effectiveFrom);

    for (const row of activeAssignments ?? []) {
      if (typeof row.id !== "string" || typeof row.effective_from !== "string") {
        continue;
      }

      if (row.effective_from >= effectiveFrom) {
        continue;
      }

      const { error: closeError } = await client
        .from("compensation_band_assignments")
        .update({ effective_to: closeDate })
        .eq("id", row.id)
        .eq("org_id", orgId);

      if (closeError) {
        throw new Error(
          `Unable to close active compensation band assignment: ${closeError.message}`
        );
      }
    }

    const { error: insertError } = await client
      .from("compensation_band_assignments")
      .insert(payload);

    if (insertError) {
      throw new Error(
        `Unable to insert compensation band assignment seed data: ${insertError.message}`
      );
    }
  }
}

async function upsertSeedPaymentDetails(
  client: SupabaseClient,
  orgId: string,
  userIdByKey: ReadonlyMap<string, string>
): Promise<void> {
  for (const detail of SEED_PAYMENT_DETAILS) {
    const employeeId = userIdByKey.get(detail.employeeKey);

    if (!employeeId) {
      throw new Error(
        `Missing employee user id for payment detail seed (${detail.employeeKey})`
      );
    }

    const payload = {
      org_id: orgId,
      employee_id: employeeId,
      payment_method: detail.paymentMethod as SeedPaymentMethod,
      bank_name_encrypted: null as string | null,
      bank_account_name_encrypted: null as string | null,
      bank_account_number_encrypted: null as string | null,
      bank_routing_number_encrypted: null as string | null,
      mobile_money_provider_encrypted: null as string | null,
      mobile_money_number_encrypted: null as string | null,
      wise_recipient_id: null as string | null,
      currency: detail.currency,
      bank_account_last4: null as string | null,
      mobile_money_last4: null as string | null,
      is_primary: true,
      is_verified: detail.isVerified,
      change_effective_at: timestampWithOffsetHours(detail.changeEffectiveOffsetHours),
      deleted_at: null as string | null
    };

    if (detail.paymentMethod === "bank_transfer") {
      payload.bank_name_encrypted = encryptSensitiveValue(detail.bankName);
      payload.bank_account_name_encrypted = encryptSensitiveValue(detail.bankAccountName);
      payload.bank_account_number_encrypted = encryptSensitiveValue(detail.bankAccountNumber);
      payload.bank_routing_number_encrypted = detail.bankRoutingNumber
        ? encryptSensitiveValue(detail.bankRoutingNumber)
        : null;
      payload.bank_account_last4 = extractLast4Digits(detail.bankAccountNumber);
    }

    if (detail.paymentMethod === "mobile_money") {
      payload.mobile_money_provider_encrypted = encryptSensitiveValue(
        detail.mobileMoneyProvider
      );
      payload.mobile_money_number_encrypted = encryptSensitiveValue(detail.mobileMoneyNumber);
      payload.mobile_money_last4 = extractLast4Digits(detail.mobileMoneyNumber);
    }

    if (detail.paymentMethod === "wise") {
      payload.wise_recipient_id = detail.wiseRecipientId;
    }

    const { data: existingRow, error: existingRowError } = await client
      .from("employee_payment_details")
      .select("id")
      .eq("org_id", orgId)
      .eq("employee_id", employeeId)
      .eq("is_primary", true)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingRowError) {
      throw new Error(
        `Unable to query payment detail seed data: ${existingRowError.message}`
      );
    }

    if (existingRow?.id) {
      const { error: updateError } = await client
        .from("employee_payment_details")
        .update(payload)
        .eq("id", existingRow.id)
        .eq("org_id", orgId);

      if (updateError) {
        throw new Error(`Unable to update payment detail seed data: ${updateError.message}`);
      }
    } else {
      const { error: insertError } = await client
        .from("employee_payment_details")
        .insert(payload);

      if (insertError) {
        throw new Error(`Unable to insert payment detail seed data: ${insertError.message}`);
      }
    }
  }
}

function deductionRuleKey(rule: {
  rule_type: string;
  rule_name: string;
  bracket_min: number | null;
  bracket_max: number | null;
}): string {
  return [
    rule.rule_type,
    rule.rule_name,
    rule.bracket_min === null ? "null" : String(rule.bracket_min),
    rule.bracket_max === null ? "null" : String(rule.bracket_max)
  ].join("|");
}

async function upsertSeedDeductionRules(
  client: SupabaseClient,
  orgId: string
): Promise<void> {
  const { data: existingRows, error: existingRowsError } = await client
    .from("deduction_rules")
    .select("id, rule_type, rule_name, bracket_min, bracket_max, effective_from")
    .eq("org_id", orgId)
    .eq("country_code", "NG");

  if (existingRowsError) {
    throw new Error(
      `Unable to query deduction rule seed data: ${existingRowsError.message}`
    );
  }

  const existingByKey = new Map<string, string>();

  for (const row of existingRows ?? []) {
    if (typeof row.id !== "string") {
      continue;
    }

    const bracketMin =
      typeof row.bracket_min === "number"
        ? Math.trunc(row.bracket_min)
        : typeof row.bracket_min === "string"
          ? Math.trunc(Number.parseFloat(row.bracket_min))
          : null;
    const bracketMax =
      typeof row.bracket_max === "number"
        ? Math.trunc(row.bracket_max)
        : typeof row.bracket_max === "string"
          ? Math.trunc(Number.parseFloat(row.bracket_max))
          : null;
    const key = deductionRuleKey({
      rule_type: typeof row.rule_type === "string" ? row.rule_type : "",
      rule_name: typeof row.rule_name === "string" ? row.rule_name : "",
      bracket_min: Number.isFinite(bracketMin) ? bracketMin : null,
      bracket_max: Number.isFinite(bracketMax) ? bracketMax : null
    });
    const existingRuleId = existingByKey.get(key);

    if (!existingRuleId) {
      existingByKey.set(key, row.id);
    }
  }

  for (const rule of SEED_NIGERIA_DEDUCTION_RULES) {
    const payload = {
      org_id: orgId,
      country_code: rule.countryCode,
      rule_type: rule.ruleType,
      rule_name: rule.ruleName,
      bracket_min: rule.bracketMin,
      bracket_max: rule.bracketMax,
      rate: rule.rate,
      flat_amount: rule.flatAmount,
      employer_portion_rate: rule.employerPortionRate,
      effective_from: rule.effectiveFrom,
      effective_to: null,
      calculation_order: rule.calculationOrder,
      notes: rule.notes
    };

    const key = deductionRuleKey({
      rule_type: payload.rule_type,
      rule_name: payload.rule_name,
      bracket_min: payload.bracket_min,
      bracket_max: payload.bracket_max
    });
    const existingId = existingByKey.get(key);

    if (existingId) {
      const { error: updateError } = await client
        .from("deduction_rules")
        .update(payload)
        .eq("id", existingId)
        .eq("org_id", orgId);

      if (updateError) {
        throw new Error(`Unable to update deduction rule seed data: ${updateError.message}`);
      }
    } else {
      const { error: insertError } = await client.from("deduction_rules").insert(payload);

      if (insertError) {
        throw new Error(`Unable to insert deduction rule seed data: ${insertError.message}`);
      }
    }
  }
}

function reviewAssignmentKey({
  cycleId,
  employeeId,
  reviewerId
}: {
  cycleId: string;
  employeeId: string;
  reviewerId: string;
}): string {
  return `${cycleId}:${employeeId}:${reviewerId}`;
}

function reviewResponseKey({
  assignmentId,
  respondentId,
  responseType
}: {
  assignmentId: string;
  respondentId: string;
  responseType: SeedReviewResponseType;
}): string {
  return `${assignmentId}:${respondentId}:${responseType}`;
}

async function upsertSeedPerformance(
  client: SupabaseClient,
  orgId: string,
  userIdByKey: ReadonlyMap<string, string>
): Promise<void> {
  const templateNames = SEED_REVIEW_TEMPLATES.map((template) => template.name);

  const { data: existingTemplateRows, error: existingTemplateRowsError } = await client
    .from("review_templates")
    .select("id, name")
    .eq("org_id", orgId)
    .is("deleted_at", null)
    .in("name", templateNames);

  if (existingTemplateRowsError) {
    throw new Error(`Unable to query review templates seed data: ${existingTemplateRowsError.message}`);
  }

  const existingTemplateByName = new Map<string, string>();

  for (const row of existingTemplateRows ?? []) {
    if (typeof row.id !== "string" || typeof row.name !== "string") {
      continue;
    }

    if (!existingTemplateByName.has(row.name)) {
      existingTemplateByName.set(row.name, row.id);
    }
  }

  const templateIdByKey = new Map<string, string>();

  for (const template of SEED_REVIEW_TEMPLATES) {
    const createdById = userIdByKey.get(template.createdByKey);

    if (!createdById) {
      throw new Error(`Missing template creator id for performance seed (${template.createdByKey})`);
    }

    const payload = {
      org_id: orgId,
      name: template.name,
      sections: template.sections,
      created_by: createdById,
      deleted_at: null as string | null
    };

    const existingTemplateId = existingTemplateByName.get(template.name);

    if (existingTemplateId) {
      const { error: updateError } = await client
        .from("review_templates")
        .update(payload)
        .eq("id", existingTemplateId)
        .eq("org_id", orgId);

      if (updateError) {
        throw new Error(`Unable to update review template seed data: ${updateError.message}`);
      }

      templateIdByKey.set(template.key, existingTemplateId);
    } else {
      const { data: insertedRow, error: insertError } = await client
        .from("review_templates")
        .insert(payload)
        .select("id")
        .single();

      if (insertError || !insertedRow?.id) {
        throw new Error(`Unable to insert review template seed data: ${insertError?.message ?? "unknown error"}`);
      }

      templateIdByKey.set(template.key, insertedRow.id);
      existingTemplateByName.set(template.name, insertedRow.id);
    }
  }

  const cycleNames = SEED_REVIEW_CYCLES.map((cycle) => cycle.name);

  const { data: existingCycleRows, error: existingCycleRowsError } = await client
    .from("review_cycles")
    .select("id, name")
    .eq("org_id", orgId)
    .is("deleted_at", null)
    .in("name", cycleNames);

  if (existingCycleRowsError) {
    throw new Error(`Unable to query review cycles seed data: ${existingCycleRowsError.message}`);
  }

  const existingCycleByName = new Map<string, string>();

  for (const row of existingCycleRows ?? []) {
    if (typeof row.id !== "string" || typeof row.name !== "string") {
      continue;
    }

    if (!existingCycleByName.has(row.name)) {
      existingCycleByName.set(row.name, row.id);
    }
  }

  const cycleIdByKey = new Map<string, string>();

  for (const cycle of SEED_REVIEW_CYCLES) {
    const createdById = userIdByKey.get(cycle.createdByKey);

    if (!createdById) {
      throw new Error(`Missing cycle creator id for performance seed (${cycle.createdByKey})`);
    }

    const payload = {
      org_id: orgId,
      name: cycle.name,
      type: cycle.type,
      status: cycle.status,
      start_date: dateWithOffset(cycle.startOffsetDays),
      end_date: dateWithOffset(cycle.endOffsetDays),
      self_review_deadline:
        cycle.selfReviewDeadlineOffsetDays === null
          ? null
          : dateWithOffset(cycle.selfReviewDeadlineOffsetDays),
      manager_review_deadline:
        cycle.managerReviewDeadlineOffsetDays === null
          ? null
          : dateWithOffset(cycle.managerReviewDeadlineOffsetDays),
      created_by: createdById,
      deleted_at: null as string | null
    };

    const existingCycleId = existingCycleByName.get(cycle.name);

    if (existingCycleId) {
      const { error: updateError } = await client
        .from("review_cycles")
        .update(payload)
        .eq("id", existingCycleId)
        .eq("org_id", orgId);

      if (updateError) {
        throw new Error(`Unable to update review cycle seed data: ${updateError.message}`);
      }

      cycleIdByKey.set(cycle.key, existingCycleId);
    } else {
      const { data: insertedRow, error: insertError } = await client
        .from("review_cycles")
        .insert(payload)
        .select("id")
        .single();

      if (insertError || !insertedRow?.id) {
        throw new Error(`Unable to insert review cycle seed data: ${insertError?.message ?? "unknown error"}`);
      }

      cycleIdByKey.set(cycle.key, insertedRow.id);
      existingCycleByName.set(cycle.name, insertedRow.id);
    }
  }

  const cycleIds = [...cycleIdByKey.values()];
  const existingAssignmentByKey = new Map<string, string>();

  if (cycleIds.length > 0) {
    const { data: existingAssignmentRows, error: existingAssignmentRowsError } = await client
      .from("review_assignments")
      .select("id, cycle_id, employee_id, reviewer_id")
      .eq("org_id", orgId)
      .is("deleted_at", null)
      .in("cycle_id", cycleIds);

    if (existingAssignmentRowsError) {
      throw new Error(`Unable to query review assignments seed data: ${existingAssignmentRowsError.message}`);
    }

    for (const row of existingAssignmentRows ?? []) {
      if (
        typeof row.id !== "string" ||
        typeof row.cycle_id !== "string" ||
        typeof row.employee_id !== "string" ||
        typeof row.reviewer_id !== "string"
      ) {
        continue;
      }

      const key = reviewAssignmentKey({
        cycleId: row.cycle_id,
        employeeId: row.employee_id,
        reviewerId: row.reviewer_id
      });

      if (!existingAssignmentByKey.has(key)) {
        existingAssignmentByKey.set(key, row.id);
      }
    }
  }

  const assignmentIdByKey = new Map<string, string>();

  for (const assignment of SEED_REVIEW_ASSIGNMENTS) {
    const cycleId = cycleIdByKey.get(assignment.cycleKey);
    const templateId = templateIdByKey.get(assignment.templateKey);
    const employeeId = userIdByKey.get(assignment.employeeKey);
    const reviewerId = userIdByKey.get(assignment.reviewerKey);

    if (!cycleId) {
      throw new Error(`Missing cycle id for performance assignment seed (${assignment.cycleKey})`);
    }

    if (!templateId) {
      throw new Error(`Missing template id for performance assignment seed (${assignment.templateKey})`);
    }

    if (!employeeId) {
      throw new Error(`Missing employee id for performance assignment seed (${assignment.employeeKey})`);
    }

    if (!reviewerId) {
      throw new Error(`Missing reviewer id for performance assignment seed (${assignment.reviewerKey})`);
    }

    const key = reviewAssignmentKey({
      cycleId,
      employeeId,
      reviewerId
    });

    const payload = {
      org_id: orgId,
      cycle_id: cycleId,
      employee_id: employeeId,
      reviewer_id: reviewerId,
      template_id: templateId,
      status: assignment.status,
      due_at:
        assignment.dueOffsetDays === null ? null : dateWithOffset(assignment.dueOffsetDays),
      deleted_at: null as string | null
    };

    const existingAssignmentId = existingAssignmentByKey.get(key);

    if (existingAssignmentId) {
      const { error: updateError } = await client
        .from("review_assignments")
        .update(payload)
        .eq("id", existingAssignmentId)
        .eq("org_id", orgId);

      if (updateError) {
        throw new Error(`Unable to update review assignment seed data: ${updateError.message}`);
      }

      assignmentIdByKey.set(assignment.key, existingAssignmentId);
    } else {
      const { data: insertedRow, error: insertError } = await client
        .from("review_assignments")
        .insert(payload)
        .select("id")
        .single();

      if (insertError || !insertedRow?.id) {
        throw new Error(`Unable to insert review assignment seed data: ${insertError?.message ?? "unknown error"}`);
      }

      assignmentIdByKey.set(assignment.key, insertedRow.id);
      existingAssignmentByKey.set(key, insertedRow.id);
    }
  }

  const assignmentIds = [...assignmentIdByKey.values()];
  const existingResponseByKey = new Map<string, string>();

  if (assignmentIds.length > 0) {
    const { data: existingResponseRows, error: existingResponseRowsError } = await client
      .from("review_responses")
      .select("id, assignment_id, respondent_id, response_type")
      .eq("org_id", orgId)
      .is("deleted_at", null)
      .in("assignment_id", assignmentIds);

    if (existingResponseRowsError) {
      throw new Error(`Unable to query review responses seed data: ${existingResponseRowsError.message}`);
    }

    for (const row of existingResponseRows ?? []) {
      if (
        typeof row.id !== "string" ||
        typeof row.assignment_id !== "string" ||
        typeof row.respondent_id !== "string" ||
        (row.response_type !== "self" && row.response_type !== "manager")
      ) {
        continue;
      }

      const key = reviewResponseKey({
        assignmentId: row.assignment_id,
        respondentId: row.respondent_id,
        responseType: row.response_type
      });

      if (!existingResponseByKey.has(key)) {
        existingResponseByKey.set(key, row.id);
      }
    }
  }

  for (const response of SEED_REVIEW_RESPONSES) {
    const assignmentId = assignmentIdByKey.get(response.assignmentKey);
    const respondentId = userIdByKey.get(response.respondentKey);

    if (!assignmentId) {
      throw new Error(`Missing assignment id for review response seed (${response.assignmentKey})`);
    }

    if (!respondentId) {
      throw new Error(`Missing respondent id for review response seed (${response.respondentKey})`);
    }

    const payload = {
      org_id: orgId,
      assignment_id: assignmentId,
      respondent_id: respondentId,
      response_type: response.responseType,
      answers: response.answers,
      submitted_at:
        response.submittedOffsetDays === null
          ? null
          : timestampWithOffsetDays(response.submittedOffsetDays),
      deleted_at: null as string | null
    };

    const key = reviewResponseKey({
      assignmentId,
      respondentId,
      responseType: response.responseType
    });
    const existingResponseId = existingResponseByKey.get(key);

    if (existingResponseId) {
      const { error: updateError } = await client
        .from("review_responses")
        .update(payload)
        .eq("id", existingResponseId)
        .eq("org_id", orgId);

      if (updateError) {
        throw new Error(`Unable to update review response seed data: ${updateError.message}`);
      }
    } else {
      const { error: insertError } = await client.from("review_responses").insert(payload);

      if (insertError) {
        throw new Error(`Unable to insert review response seed data: ${insertError.message}`);
      }
    }
  }
}

function complianceItemKey({
  countryCode,
  authority,
  requirement
}: {
  countryCode: string;
  authority: string;
  requirement: string;
}): string {
  return [countryCode, authority, requirement].join("|").toLowerCase();
}

function complianceDeadlineKey({
  itemId,
  dueDate
}: {
  itemId: string;
  dueDate: string;
}): string {
  return `${itemId}|${dueDate}`;
}

async function upsertSeedCompliance(
  client: SupabaseClient,
  orgId: string,
  userIdByKey: ReadonlyMap<string, string>
): Promise<void> {
  const { data: existingItemRows, error: existingItemRowsError } = await client
    .from("compliance_items")
    .select("id, country_code, authority, requirement")
    .eq("org_id", orgId)
    .is("deleted_at", null);

  if (existingItemRowsError) {
    throw new Error(`Unable to query compliance items seed data: ${existingItemRowsError.message}`);
  }

  const existingItemByKey = new Map<string, string>();

  for (const row of existingItemRows ?? []) {
    if (
      typeof row.id !== "string" ||
      typeof row.country_code !== "string" ||
      typeof row.authority !== "string" ||
      typeof row.requirement !== "string"
    ) {
      continue;
    }

    const key = complianceItemKey({
      countryCode: row.country_code,
      authority: row.authority,
      requirement: row.requirement
    });

    if (!existingItemByKey.has(key)) {
      existingItemByKey.set(key, row.id);
    }
  }

  const itemIdByKey = new Map<string, string>();

  for (const item of SEED_COMPLIANCE_ITEMS) {
    const payload = {
      org_id: orgId,
      country_code: item.countryCode,
      authority: item.authority,
      requirement: item.requirement,
      description: item.description,
      cadence: item.cadence,
      category: item.category,
      notes: item.notes,
      deleted_at: null as string | null
    };

    const existingItemId = existingItemByKey.get(
      complianceItemKey({
        countryCode: item.countryCode,
        authority: item.authority,
        requirement: item.requirement
      })
    );

    if (existingItemId) {
      const { error: updateError } = await client
        .from("compliance_items")
        .update(payload)
        .eq("id", existingItemId)
        .eq("org_id", orgId);

      if (updateError) {
        throw new Error(`Unable to update compliance item seed data: ${updateError.message}`);
      }

      itemIdByKey.set(item.key, existingItemId);
    } else {
      const { data: insertedRow, error: insertError } = await client
        .from("compliance_items")
        .insert(payload)
        .select("id")
        .single();

      if (insertError || !insertedRow?.id) {
        throw new Error(`Unable to insert compliance item seed data: ${insertError?.message ?? "unknown error"}`);
      }

      itemIdByKey.set(item.key, insertedRow.id);
      existingItemByKey.set(
        complianceItemKey({
          countryCode: item.countryCode,
          authority: item.authority,
          requirement: item.requirement
        }),
        insertedRow.id
      );
    }
  }

  const itemIds = [...itemIdByKey.values()];
  const dueDates = [...new Set(SEED_COMPLIANCE_DEADLINES.map((deadline) => deadline.dueDate))];
  const existingDeadlineByKey = new Map<string, string>();

  if (itemIds.length > 0 && dueDates.length > 0) {
    const { data: existingDeadlineRows, error: existingDeadlineRowsError } = await client
      .from("compliance_deadlines")
      .select("id, item_id, due_date")
      .eq("org_id", orgId)
      .is("deleted_at", null)
      .in("item_id", itemIds)
      .in("due_date", dueDates);

    if (existingDeadlineRowsError) {
      throw new Error(`Unable to query compliance deadlines seed data: ${existingDeadlineRowsError.message}`);
    }

    for (const row of existingDeadlineRows ?? []) {
      if (
        typeof row.id !== "string" ||
        typeof row.item_id !== "string" ||
        typeof row.due_date !== "string"
      ) {
        continue;
      }

      const key = complianceDeadlineKey({
        itemId: row.item_id,
        dueDate: row.due_date
      });

      if (!existingDeadlineByKey.has(key)) {
        existingDeadlineByKey.set(key, row.id);
      }
    }
  }

  for (const deadline of SEED_COMPLIANCE_DEADLINES) {
    const itemId = itemIdByKey.get(deadline.itemKey);
    const assignedToId = userIdByKey.get(deadline.assignedToKey);

    if (!itemId) {
      throw new Error(`Missing compliance item id for deadline seed (${deadline.itemKey})`);
    }

    if (!assignedToId) {
      throw new Error(`Missing assignee id for compliance deadline seed (${deadline.assignedToKey})`);
    }

    const payload = {
      org_id: orgId,
      item_id: itemId,
      due_date: deadline.dueDate,
      status: deadline.status,
      assigned_to: assignedToId,
      proof_document_id: null as string | null,
      completed_at: deadline.completedAt,
      notes: deadline.notes,
      deleted_at: null as string | null
    };

    const deadlineKey = complianceDeadlineKey({
      itemId,
      dueDate: deadline.dueDate
    });
    const existingDeadlineId = existingDeadlineByKey.get(deadlineKey);

    if (existingDeadlineId) {
      const { error: updateError } = await client
        .from("compliance_deadlines")
        .update(payload)
        .eq("id", existingDeadlineId)
        .eq("org_id", orgId);

      if (updateError) {
        throw new Error(`Unable to update compliance deadline seed data: ${updateError.message}`);
      }
    } else {
      const { error: insertError } = await client
        .from("compliance_deadlines")
        .insert(payload);

      if (insertError) {
        throw new Error(`Unable to insert compliance deadline seed data: ${insertError.message}`);
      }
    }
  }
}

async function upsertSeedExpenses(
  client: SupabaseClient,
  orgId: string,
  userIdByKey: ReadonlyMap<string, string>
): Promise<void> {
  for (let index = 0; index < SEED_EXPENSES.length; index += 1) {
    const expense = SEED_EXPENSES[index];
    const employeeId = userIdByKey.get(expense.employeeKey);

    if (!employeeId) {
      throw new Error(`Missing employee user id for expense seed (${expense.employeeKey})`);
    }

    const approvedById = expense.approvedByKey
      ? userIdByKey.get(expense.approvedByKey) ?? null
      : null;
    const rejectedById = expense.rejectedByKey
      ? userIdByKey.get(expense.rejectedByKey) ?? null
      : null;
    const reimbursedById = expense.reimbursedByKey
      ? userIdByKey.get(expense.reimbursedByKey) ?? null
      : null;

    if (expense.approvedByKey && !approvedById) {
      throw new Error(`Missing approver id for expense seed (${expense.approvedByKey})`);
    }

    if (expense.rejectedByKey && !rejectedById) {
      throw new Error(`Missing rejector id for expense seed (${expense.rejectedByKey})`);
    }

    if (expense.reimbursedByKey && !reimbursedById) {
      throw new Error(`Missing reimburser id for expense seed (${expense.reimbursedByKey})`);
    }

    const expenseDate = dateWithOffset(expense.expenseDateOffsetDays);
    const approvedAt =
      expense.status === "approved" || expense.status === "reimbursed"
        ? timestampWithOffsetDays(expense.approvedOffsetDays ?? expense.expenseDateOffsetDays + 1)
        : null;
    const rejectedAt =
      expense.status === "rejected"
        ? timestampWithOffsetDays(expense.rejectedOffsetDays ?? expense.expenseDateOffsetDays + 1)
        : null;
    const reimbursedAt =
      expense.status === "reimbursed"
        ? timestampWithOffsetDays(expense.reimbursedOffsetDays ?? expense.expenseDateOffsetDays + 3)
        : null;
    const receiptFilePath = `${orgId}/seed/receipts/${expense.employeeKey}-${index + 1}.pdf`;

    const payload = {
      org_id: orgId,
      employee_id: employeeId,
      category: expense.category,
      description: expense.description,
      amount: expense.amount,
      currency: expense.currency,
      receipt_file_path: receiptFilePath,
      expense_date: expenseDate,
      status: expense.status,
      approved_by:
        expense.status === "approved" || expense.status === "reimbursed" ? approvedById : null,
      approved_at:
        expense.status === "approved" || expense.status === "reimbursed" ? approvedAt : null,
      rejected_by: expense.status === "rejected" ? rejectedById : null,
      rejected_at: expense.status === "rejected" ? rejectedAt : null,
      rejection_reason: expense.status === "rejected" ? expense.rejectionReason ?? null : null,
      reimbursed_by: expense.status === "reimbursed" ? reimbursedById : null,
      reimbursed_at: expense.status === "reimbursed" ? reimbursedAt : null,
      reimbursement_reference:
        expense.status === "reimbursed" ? expense.reimbursementReference ?? null : null,
      reimbursement_notes:
        expense.status === "reimbursed" ? expense.reimbursementNotes ?? null : null,
      deleted_at: null as string | null
    };

    const { data: existingRow, error: existingRowError } = await client
      .from("expenses")
      .select("id")
      .eq("org_id", orgId)
      .eq("employee_id", employeeId)
      .eq("category", expense.category)
      .eq("amount", expense.amount)
      .eq("description", expense.description)
      .eq("expense_date", expenseDate)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingRowError) {
      throw new Error(`Unable to query expense seed data: ${existingRowError.message}`);
    }

    if (existingRow?.id) {
      const { error: updateError } = await client
        .from("expenses")
        .update(payload)
        .eq("id", existingRow.id)
        .eq("org_id", orgId);

      if (updateError) {
        throw new Error(`Unable to update expense seed data: ${updateError.message}`);
      }
    } else {
      const { error: insertError } = await client.from("expenses").insert(payload);

      if (insertError) {
        throw new Error(`Unable to insert expense seed data: ${insertError.message}`);
      }
    }
  }
}

function notificationSeedKey({
  userId,
  type,
  title
}: {
  userId: string;
  type: string;
  title: string;
}): string {
  return `${userId}|${type}|${title}`.toLowerCase();
}

async function upsertSeedNotifications(
  client: SupabaseClient,
  orgId: string,
  userIdByKey: ReadonlyMap<string, string>
): Promise<void> {
  const targetUserIds = [...new Set(SEED_NOTIFICATIONS
    .map((row) => userIdByKey.get(row.userKey))
    .filter((value): value is string => typeof value === "string"))];

  if (targetUserIds.length === 0) {
    return;
  }

  const { data: existingRows, error: existingRowsError } = await client
    .from("notifications")
    .select("id, user_id, type, title")
    .eq("org_id", orgId)
    .is("deleted_at", null)
    .in("user_id", targetUserIds);

  if (existingRowsError) {
    throw new Error(`Unable to query notification seed data: ${existingRowsError.message}`);
  }

  const existingIdByKey = new Map<string, string>();

  for (const row of existingRows ?? []) {
    if (
      typeof row.id !== "string" ||
      typeof row.user_id !== "string" ||
      typeof row.type !== "string" ||
      typeof row.title !== "string"
    ) {
      continue;
    }

    const key = notificationSeedKey({
      userId: row.user_id,
      type: row.type,
      title: row.title
    });

    if (!existingIdByKey.has(key)) {
      existingIdByKey.set(key, row.id);
    }
  }

  for (const notification of SEED_NOTIFICATIONS) {
    const userId = userIdByKey.get(notification.userKey);

    if (!userId) {
      throw new Error(`Missing user id for notification seed (${notification.userKey})`);
    }

    const readAt = notification.isRead
      ? timestampWithOffsetDays(notification.createdOffsetDays)
      : null;

    const payload = {
      org_id: orgId,
      user_id: userId,
      type: notification.type,
      title: notification.title,
      body: notification.body,
      link: notification.link,
      is_read: notification.isRead,
      read_at: readAt,
      created_at: timestampWithOffsetDays(notification.createdOffsetDays),
      deleted_at: null as string | null
    };

    const key = notificationSeedKey({
      userId,
      type: notification.type,
      title: notification.title
    });
    const existingId = existingIdByKey.get(key);

    if (existingId) {
      const { error: updateError } = await client
        .from("notifications")
        .update(payload)
        .eq("id", existingId)
        .eq("org_id", orgId);

      if (updateError) {
        throw new Error(`Unable to update notification seed data: ${updateError.message}`);
      }
    } else {
      const { error: insertError } = await client
        .from("notifications")
        .insert(payload);

      if (insertError) {
        throw new Error(`Unable to insert notification seed data: ${insertError.message}`);
      }
    }
  }
}

async function main() {
  const client = createServiceRoleClient();
  const sharedPassword = process.env.SEED_TEST_PASSWORD ?? "CrewHub123!";

  const org = await ensureOrg(client);
  const existingUsersByEmail = await listUsersByEmail(client);

  const userIdByKey = new Map<string, string>();

  for (const member of SEED_MEMBERS) {
    const userId = await ensureAuthUser(client, existingUsersByEmail, member, sharedPassword);
    userIdByKey.set(member.key, userId);
  }

  const managementRows: ProfileRow[] = [];
  const employeeRows: ProfileRow[] = [];

  for (const member of SEED_MEMBERS) {
    const userId = userIdByKey.get(member.key);

    if (!userId) {
      throw new Error(`Missing auth user id for ${member.key}`);
    }

    const managerId = member.managerKey ? userIdByKey.get(member.managerKey) ?? null : null;

    if (member.managerKey && !managerId) {
      throw new Error(`Missing manager id for ${member.key}`);
    }

    const row: ProfileRow = {
      id: userId,
      org_id: org.id,
      email: member.email,
      full_name: member.fullName,
      roles: member.roles,
      department: member.department,
      title: member.title,
      country_code: member.countryCode,
      timezone: member.timezone,
      employment_type: "contractor",
      payroll_mode: "contractor_usd_no_withholding",
      primary_currency: "USD",
      manager_id: managerId,
      status: member.status,
      notification_preferences: {}
    };

    if (member.roles.includes("EMPLOYEE") && member.roles.length === 1) {
      employeeRows.push(row);
    } else {
      managementRows.push(row);
    }
  }

  await upsertProfiles(client, managementRows);
  await upsertProfiles(client, employeeRows);
  await upsertSeedAnnouncements(client, org.id, userIdByKey);
  await upsertSeedDocuments(client, org.id, userIdByKey);
  await upsertSeedOnboarding(client, org.id, userIdByKey);
  await upsertSeedTimeOff(client, org.id, userIdByKey);
  await upsertSeedCompensation(client, org.id, userIdByKey);
  await upsertSeedCompensationBands(client, org.id, userIdByKey);
  await upsertSeedDeductionRules(client, org.id);
  await upsertSeedPaymentDetails(client, org.id, userIdByKey);
  await upsertSeedPerformance(client, org.id, userIdByKey);
  await upsertSeedCompliance(client, org.id, userIdByKey);
  await upsertSeedExpenses(client, org.id, userIdByKey);
  await upsertSeedNotifications(client, org.id, userIdByKey);

  console.log("Seed completed successfully.");
  console.log(`Organization: ${org.name} (${org.id})`);
  console.log(`Profiles upserted: ${SEED_MEMBERS.length}`);
  console.log(`Announcements upserted: ${SEED_ANNOUNCEMENTS.length}`);
  console.log(`Documents upserted: ${SEED_DOCUMENTS.length}`);
  console.log(`Onboarding templates upserted: ${SEED_ONBOARDING_TEMPLATES.length}`);
  console.log(`Onboarding instances upserted: ${SEED_ONBOARDING_INSTANCES.length}`);
  console.log(`Leave policies upserted: ${SEED_LEAVE_POLICIES.length}`);
  console.log(`Leave balances upserted: ${SEED_LEAVE_BALANCES.length}`);
  console.log(`Leave requests upserted: ${SEED_LEAVE_REQUESTS.length}`);
  console.log(`Holidays upserted: ${SEED_HOLIDAYS.length}`);
  console.log(`Compensation records upserted: ${SEED_COMPENSATION_RECORDS.length}`);
  console.log(`Allowances upserted: ${SEED_ALLOWANCES.length}`);
  console.log(`Equity grants upserted: ${SEED_EQUITY_GRANTS.length}`);
  console.log(`Compensation bands upserted: ${SEED_COMPENSATION_BANDS.length}`);
  console.log(`Benchmark rows upserted: ${SEED_BENCHMARK_DATA.length}`);
  console.log(`Band assignments upserted: ${SEED_COMPENSATION_BAND_ASSIGNMENTS.length}`);
  console.log(`Nigeria deduction rules upserted: ${SEED_NIGERIA_DEDUCTION_RULES.length}`);
  console.log(`Payment details upserted: ${SEED_PAYMENT_DETAILS.length}`);
  console.log(`Performance cycles upserted: ${SEED_REVIEW_CYCLES.length}`);
  console.log(`Performance templates upserted: ${SEED_REVIEW_TEMPLATES.length}`);
  console.log(`Performance assignments upserted: ${SEED_REVIEW_ASSIGNMENTS.length}`);
  console.log(`Performance responses upserted: ${SEED_REVIEW_RESPONSES.length}`);
  console.log(`Compliance items upserted: ${SEED_COMPLIANCE_ITEMS.length}`);
  console.log(`Compliance deadlines upserted: ${SEED_COMPLIANCE_DEADLINES.length}`);
  console.log(`Expenses upserted: ${SEED_EXPENSES.length}`);
  console.log(`Notifications upserted: ${SEED_NOTIFICATIONS.length}`);
  console.log(`Shared test password: ${sharedPassword}`);
}

main().catch((error) => {
  console.error("Seed failed.", error);
  process.exitCode = 1;
});
