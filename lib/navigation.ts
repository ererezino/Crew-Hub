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
  /** Optional link to the feature state system for nav visibility control */
  moduleId?: import("./feature-state").ModuleId;
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
        description: "Your personal home in Crew Hub. See what needs attention and jump to your most-used actions.",
        shortcut: "G H"
      },
      {
        label: "Announcements",
        href: "/announcements",
        icon: "Megaphone",
        description: "Company updates and news since your last visit.",
        shortcut: "G A"
      }
    ]
  },
  {
    label: "MY WORK",
    items: [
      {
        label: "Time Off",
        href: "/time-off",
        icon: "CalendarOff",
        description: "Request time off, check balances, and track approval status.",
        shortcut: "G T"
      },
      {
        label: "My Pay",
        href: "/me/pay",
        icon: "Wallet",
        description: "Pay statements, payout setup, and compensation in one view.",
        shortcut: "G Y"
      },
      {
        label: "Documents",
        href: "/documents",
        icon: "FileText",
        description: "Your documents, required records, and expiry reminders.",
        shortcut: "G D"
      },
      {
        label: "Learning",
        href: "/learning",
        icon: "GraduationCap",
        description: "Courses, certificates, and surveys assigned to you.",
        shortcut: "G L",
        moduleId: "learning"
      }
    ]
  },
  {
    label: "TEAM",
    requiredRoles: ["MANAGER", "TEAM_LEAD", "HR_ADMIN", "FINANCE_ADMIN", "SUPER_ADMIN"],
    items: [
      {
        label: "Approvals",
        href: "/approvals",
        icon: "CheckCircle",
        description: "Review and act on pending team requests.",
        shortcut: "G V"
      },
      {
        label: "People",
        href: "/people",
        icon: "Users",
        description: "Find people, review roles, and open full profiles.",
        shortcut: "G P"
      },
      {
        label: "Scheduling",
        href: "/scheduling",
        icon: "Calendar",
        description: "Build, publish, and manage team shift schedules.",
        shortcut: "G S",
        moduleId: "scheduling"
      },
      {
        label: "Onboarding",
        href: "/onboarding",
        icon: "Rocket",
        description: "Launch onboarding plans, track progress, and resolve blockers.",
        shortcut: "G O"
      },
      {
        label: "Team Hub",
        href: "/team-hub",
        icon: "BookOpen",
        description: "Your department's knowledge base: guides, contacts, and resources.",
        shortcut: "G B",
        moduleId: "team_hub"
      }
    ]
  },
  {
    label: "FINANCE",
    requiredRoles: ["FINANCE_ADMIN", "HR_ADMIN", "SUPER_ADMIN"],
    items: [
      {
        label: "Payroll",
        href: "/payroll",
        icon: "Calculator",
        description: "Run payroll with staged approvals and clear payout status.",
        shortcut: "F P",
        moduleId: "payroll"
      },
      {
        label: "Expenses",
        href: "/expenses",
        icon: "Receipt",
        description: "Submit expenses, upload receipts, and track reimbursement.",
        shortcut: "F E"
      },
      {
        label: "Compensation",
        href: "/admin/compensation",
        icon: "Coins",
        description: "Manage salary, allowances, and equity for team members.",
        shortcut: "F C"
      }
    ]
  },
  {
    label: "OPERATIONS",
    requiredRoles: ["HR_ADMIN", "SUPER_ADMIN"],
    items: [
      {
        label: "Performance",
        href: "/performance",
        icon: "Star",
        description: "Run review cycles, track completion, and calibrate fairly.",
        shortcut: "G R",
        moduleId: "performance"
      },
      {
        label: "Compliance",
        href: "/compliance",
        icon: "ShieldCheck",
        description: "Statutory filings with due dates, proof, and country tracking.",
        shortcut: "G M"
      },
      {
        label: "Analytics",
        href: "/analytics",
        icon: "BarChart3",
        description: "Workforce and operations trends with filters and exports.",
        shortcut: "G N",
        moduleId: "analytics"
      },
      {
        label: "Signatures",
        href: "/signatures",
        icon: "PenTool",
        description: "Request, sign, and track documents with signer timelines.",
        shortcut: "G I",
        moduleId: "signatures"
      }
    ]
  },
  {
    label: "ADMIN",
    adminOnly: true,
    requiredRoles: ["SUPER_ADMIN"],
    items: [
      {
        label: "Organization",
        href: "/settings?tab=organization",
        icon: "Building",
        description: "Company name, logo, countries, and currencies.",
        shortcut: "A O"
      },
      {
        label: "Roles & Access",
        href: "/admin/access-control",
        icon: "Lock",
        description: "Default role permissions and per-person overrides.",
        shortcut: "A A"
      },
      {
        label: "Audit Log",
        href: "/settings?tab=audit",
        icon: "ScrollText",
        description: "Who did what, when, and to which record.",
        shortcut: "A L"
      }
    ]
  }
];

export const ROUTE_ITEMS: NavItem[] = NAV_GROUPS.flatMap((group) => group.items);
