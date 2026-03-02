export const USER_ROLES = [
  "EMPLOYEE",
  "MANAGER",
  "HR_ADMIN",
  "FINANCE_ADMIN",
  "SUPER_ADMIN"
] as const;

export type UserRole = (typeof USER_ROLES)[number];

export function isUserRole(value: string): value is UserRole {
  return USER_ROLES.includes(value as UserRole);
}

export function normalizeUserRoles(
  roles: readonly string[] | null | undefined
): UserRole[] {
  if (!roles) {
    return [];
  }

  return roles.filter(isUserRole);
}

export type NavItem = {
  label: string;
  href: string;
  description: string;
  shortcut: string;
};

export type NavGroup = {
  label: string;
  adminOnly?: boolean;
  items: NavItem[];
};

export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Core",
    items: [
      {
        label: "Dashboard",
        href: "/dashboard",
        description: "Operations overview and quick health metrics.",
        shortcut: "G D"
      }
    ]
  },
  {
    label: "People Ops",
    items: [
      {
        label: "People",
        href: "/people",
        description: "Directory, lifecycle, and people records.",
        shortcut: "G P"
      },
      {
        label: "Onboarding",
        href: "/onboarding",
        description: "Task checklists and onboarding progress.",
        shortcut: "G O"
      },
      {
        label: "My Onboarding",
        href: "/me/onboarding",
        description: "Personal onboarding tasks and progress tracking.",
        shortcut: "G I"
      },
      {
        label: "Time Off",
        href: "/time-off",
        description: "Requests, balances, and approval queues.",
        shortcut: "G T"
      },
      {
        label: "Time Off Approvals",
        href: "/time-off/approvals",
        description: "Approve or reject pending leave requests.",
        shortcut: "G V"
      },
      {
        label: "Time Off Calendar",
        href: "/time-off/calendar",
        description: "Monthly team leave calendar with filters.",
        shortcut: "G K"
      },
      {
        label: "Documents",
        href: "/documents",
        description: "Contracts, policies, and signed files.",
        shortcut: "G C"
      },
      {
        label: "Signatures",
        href: "/signatures",
        description: "Send and sign document requests with status tracking.",
        shortcut: "G F"
      },
      {
        label: "My Documents",
        href: "/me/documents",
        description: "Personal ID and tax forms for self-service.",
        shortcut: "G M"
      },
      {
        label: "My Compensation",
        href: "/me/compensation",
        description: "Salary, allowances, equity, and compensation history.",
        shortcut: "G B"
      },
      {
        label: "Payments",
        href: "/me/payslips",
        description: "View and download monthly payment statements.",
        shortcut: "G J"
      },
      {
        label: "My Payment Details",
        href: "/me/payment-details",
        description: "Manage payout method details with masked destination view.",
        shortcut: "G W"
      }
    ]
  },
  {
    label: "Finance",
    items: [
      {
        label: "Payroll",
        href: "/payroll",
        description: "Run preparation and payout tracking.",
        shortcut: "G Y"
      },
      {
        label: "Payroll Settings",
        href: "/payroll/settings/deductions",
        description: "View country-by-country tax withholding rollout status.",
        shortcut: "G Q"
      },
      {
        label: "New Payroll Run",
        href: "/payroll/runs/new",
        description: "Create a payroll run for the current pay period.",
        shortcut: "G U"
      },
      {
        label: "Expenses",
        href: "/expenses",
        description: "Claims, approvals, and reimbursements.",
        shortcut: "G E"
      },
      {
        label: "Expense Approvals",
        href: "/expenses/approvals",
        description: "Review and approve pending expense submissions.",
        shortcut: "G X"
      },
      {
        label: "Expense Reports",
        href: "/expenses/reports",
        description: "View monthly expense analytics and export CSV.",
        shortcut: "G Z"
      }
    ]
  },
  {
    label: "Performance & Risk",
    items: [
      {
        label: "Performance",
        href: "/performance",
        description: "Review cycles, goals, and feedback.",
        shortcut: "G R"
      },
      {
        label: "Compliance",
        href: "/compliance",
        description: "Policy tracking and due-date monitoring.",
        shortcut: "G M"
      },
      {
        label: "Analytics",
        href: "/analytics",
        description: "Workforce insights and trend reporting.",
        shortcut: "G A"
      }
    ]
  },
  {
    label: "Comms",
    items: [
      {
        label: "Announcements",
        href: "/announcements",
        description: "Internal notices and company updates.",
        shortcut: "G N"
      }
    ]
  },
  {
    label: "System",
    items: [
      {
        label: "Settings",
        href: "/settings",
        description: "Workspace preferences and controls.",
        shortcut: "G S"
      },
      {
        label: "Notifications",
        href: "/notifications",
        description: "Inbox for workflow and approval updates.",
        shortcut: "G H"
      },
      {
        label: "Login",
        href: "/login",
        description: "Authentication entry screen placeholder.",
        shortcut: "G L"
      }
    ]
  },
  {
    label: "Admin",
    adminOnly: true,
    items: [
      {
        label: "Compensation Admin",
        href: "/admin/compensation",
        description: "Manage salary, allowances, equity grants, and approvals.",
        shortcut: "A C"
      },
      {
        label: "Compensation Bands",
        href: "/admin/compensation-bands",
        description: "Define salary bands, benchmark market ranges, and review out-of-band alerts.",
        shortcut: "A B"
      },
      {
        label: "Performance Admin",
        href: "/performance/admin",
        description: "Create review cycles, assign reviewers, and track completion.",
        shortcut: "A F"
      },
      {
        label: "Payment Details",
        href: "/admin/payment-details",
        description: "Review masked employee payout destinations and missing details.",
        shortcut: "A P"
      },
      {
        label: "Admin Users",
        href: "/admin/users",
        description: "Manage platform-level user access.",
        shortcut: "A U"
      },
      {
        label: "Admin Roles",
        href: "/admin/roles",
        description: "Configure role assignment controls.",
        shortcut: "A R"
      },
      {
        label: "System Config",
        href: "/admin/system-config",
        description: "Global configuration and feature flags.",
        shortcut: "A S"
      }
    ]
  }
];

export const ROUTE_ITEMS: NavItem[] = NAV_GROUPS.flatMap((group) => group.items);
