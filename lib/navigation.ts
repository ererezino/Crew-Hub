export const USER_ROLES = [
  "EMPLOYEE",
  "TEAM_LEAD",
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
  icon: string;
  description: string;
  shortcut: string;
};

export type NavGroup = {
  label: string;
  description?: string;
  requiredRoles?: UserRole[];
  adminOnly?: boolean;
  items: NavItem[];
};

export const NAV_GROUPS: NavGroup[] = [
  {
    label: "",
    items: [
      {
        label: "Home",
        href: "/dashboard",
        icon: "LayoutDashboard",
        description: "Your home base — updates, links, and insights.",
        shortcut: "G D"
      },
      {
        label: "Announcements",
        href: "/announcements",
        icon: "Megaphone",
        description: "Internal notices and company updates.",
        shortcut: "G A"
      }
    ]
  },
  {
    label: "My Stuff",
    items: [
      {
        label: "Time Off",
        href: "/time-off",
        icon: "CalendarOff",
        description: "Requests, balances, and leave calendar.",
        shortcut: "G T"
      },
      {
        label: "Expenses",
        href: "/expenses",
        icon: "Receipt",
        description: "Claims, approvals, and reimbursements.",
        shortcut: "G E"
      },
      {
        label: "Schedule",
        href: "/scheduling",
        icon: "CalendarClock",
        description: "My shifts, open shifts, and swap requests.",
        shortcut: "G S"
      },
      {
        label: "Hours",
        href: "/time-attendance",
        icon: "Clock",
        description: "Track clock-ins, worked hours, and weekly attendance totals.",
        shortcut: "G H"
      },
      {
        label: "Documents",
        href: "/documents",
        icon: "FileText",
        description: "Contracts, policies, and signed files.",
        shortcut: "G C"
      },
      {
        label: "Pay",
        href: "/me/pay",
        icon: "Wallet",
        description: "Payslips, payment details, and compensation in one place.",
        shortcut: "G Y"
      },
      {
        label: "Learning",
        href: "/learning",
        icon: "GraduationCap",
        description: "Courses, certificates, and surveys.",
        shortcut: "G L"
      },
      {
        label: "Reviews",
        href: "/performance",
        icon: "Star",
        description: "Review cycles, goals, and feedback.",
        shortcut: "G R"
      }
    ]
  },
  {
    label: "Approvals",
    description: "Review team requests",
    requiredRoles: ["MANAGER", "TEAM_LEAD", "HR_ADMIN", "FINANCE_ADMIN", "SUPER_ADMIN"],
    items: [
      {
        label: "Approvals",
        href: "/approvals",
        icon: "CheckCircle",
        description: "Unified approvals for time off, expenses, and timesheets.",
        shortcut: "G V"
      }
    ]
  },
  {
    label: "Manage",
    requiredRoles: ["MANAGER", "TEAM_LEAD", "HR_ADMIN", "SUPER_ADMIN"],
    items: [
      {
        label: "People",
        href: "/people",
        icon: "Users",
        description: "Directory, lifecycle, and people records.",
        shortcut: "G P"
      },
      {
        label: "Scheduling",
        href: "/scheduling/manage",
        icon: "Calendar",
        description: "Create schedules, assign shifts, and publish rotas.",
        shortcut: "G 2"
      },
      {
        label: "Onboarding",
        href: "/onboarding",
        icon: "Rocket",
        description: "Template-driven onboarding and offboarding workflows.",
        shortcut: "G O"
      }
    ]
  },
  {
    label: "Finance",
    description: "Payroll, expenses, and compensation",
    requiredRoles: ["FINANCE_ADMIN", "HR_ADMIN", "SUPER_ADMIN"],
    items: [
      {
        label: "Payroll",
        href: "/payroll",
        icon: "Calculator",
        description: "Payroll runs, approvals, and disbursement tracking.",
        shortcut: "F P"
      },
      {
        label: "Expense Reports",
        href: "/expenses/reports",
        icon: "FileBarChart",
        description: "Monthly expense analytics by category, employee, and department.",
        shortcut: "F E"
      },
      {
        label: "Compensation",
        href: "/admin/compensation",
        icon: "Coins",
        description: "Manage salary, allowances, and equity records.",
        shortcut: "F C"
      },
      {
        label: "Payment Details",
        href: "/admin/payment-details",
        icon: "CreditCard",
        description: "Review employee payout destinations and missing details.",
        shortcut: "F D"
      }
    ]
  },
  {
    label: "Insights",
    requiredRoles: ["HR_ADMIN", "FINANCE_ADMIN", "SUPER_ADMIN"],
    items: [
      {
        label: "Analytics",
        href: "/analytics",
        icon: "BarChart3",
        description: "Workforce, payroll, and operations trend reporting.",
        shortcut: "G N"
      },
      {
        label: "Compliance",
        href: "/compliance",
        icon: "ShieldCheck",
        description: "Regulatory deadlines and filing status monitoring.",
        shortcut: "G M"
      }
    ]
  },
  {
    label: "Admin",
    adminOnly: true,
    requiredRoles: ["HR_ADMIN", "FINANCE_ADMIN", "SUPER_ADMIN"],
    items: [
      {
        label: "Users & Roles",
        href: "/admin/users",
        icon: "UserCog",
        description: "Invite employees, assign roles, and manage account lifecycle.",
        shortcut: "A U"
      },
      {
        label: "Access Control",
        href: "/admin/access-control",
        icon: "Lock",
        description: "Control navigation and dashboard visibility by role.",
        shortcut: "A A"
      },
      {
        label: "Settings",
        href: "/settings",
        icon: "Settings",
        description: "Workspace preferences, organization, and audit logs.",
        shortcut: "A S"
      }
    ]
  }
];

export const ROUTE_ITEMS: NavItem[] = NAV_GROUPS.flatMap((group) => group.items);
