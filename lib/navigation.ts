export const USER_ROLES = [
  "EMPLOYEE",
  "TEAM_LEAD",
  "MANAGER",
  "HR_ADMIN",
  "FINANCE_ADMIN",
  "FINANCE_APPROVER",
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
  /** Translation key for the label in the `nav` namespace (e.g. "home", "scheduling") */
  labelKey: string;
  /** Optional link to the feature state system for nav visibility control */
  moduleId?: import("./feature-state").ModuleId;
};

export type NavGroup = {
  label: string;
  /** Translation key for the group label in the `nav.group` namespace (e.g. "myWork", "team") */
  labelKey?: string;
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
        labelKey: "home",
        href: "/dashboard",
        icon: "LayoutDashboard",
        description: "Your personal home in Crew Hub: see what needs attention and jump to your most-used actions",
        shortcut: "G H"
      },
      {
        label: "Updates",
        labelKey: "announcements",
        href: "/announcements",
        icon: "Megaphone",
        description: "Announcements, alerts, and workflow updates in one inbox",
        shortcut: "G C"
      },
      {
        label: "The Crew",
        labelKey: "theCrew",
        href: "/the-crew",
        icon: "Heart",
        description: "Meet your teammates: photos, bios, and what makes everyone tick",
        shortcut: "G W",
        moduleId: "the_crew"
      },
      {
        label: "Crew Games",
        labelKey: "crewGames",
        href: "/crew-games",
        icon: "Gamepad2",
        description: "Games Night and Presentation Night: results, leaderboards, and fun",
        shortcut: "G G",
        moduleId: "crew_games"
      }
    ]
  },
  {
    label: "My work",
    labelKey: "myWork",
    items: [
      {
        label: "Time off",
        labelKey: "timeOff",
        href: "/time-off",
        icon: "CalendarDays",
        description: "Request time off, check balances, and track approval status",
        shortcut: "G T"
      },
      {
        label: "My pay",
        labelKey: "myPay",
        href: "/me/pay",
        icon: "Wallet",
        description: "Pay statements, payout setup, and compensation in one view",
        shortcut: "G Y"
      },
      {
        label: "Documents",
        labelKey: "documents",
        href: "/me/documents",
        icon: "FileText",
        description: "Your documents, required records, and expiry reminders",
        shortcut: "G D"
      },
      {
        label: "Expenses",
        labelKey: "expenses",
        href: "/expenses",
        icon: "Receipt",
        description: "Submit expenses, upload receipts, and track reimbursement",
        shortcut: "G E"
      },
      {
        label: "Learning",
        labelKey: "learning",
        href: "/learning",
        icon: "GraduationCap",
        description: "Courses, certificates, and surveys assigned to you",
        shortcut: "G L",
        moduleId: "learning"
      }
    ]
  },
  {
    label: "Team",
    labelKey: "team",
    requiredRoles: ["MANAGER", "TEAM_LEAD", "HR_ADMIN", "FINANCE_ADMIN", "FINANCE_APPROVER", "SUPER_ADMIN"],
    items: [
      {
        label: "Approvals",
        labelKey: "approvals",
        href: "/approvals",
        icon: "CheckCircle2",
        description: "Review and act on pending team requests",
        shortcut: "G V"
      },
      {
        label: "Scheduling",
        labelKey: "scheduling",
        href: "/scheduling",
        icon: "CalendarClock",
        description: "Build, publish, and manage team shift schedules",
        shortcut: "G S",
        moduleId: "scheduling"
      },
      {
        label: "Onboarding",
        labelKey: "onboarding",
        href: "/onboarding",
        icon: "Rocket",
        description: "Launch onboarding plans, track progress, and resolve blockers",
        shortcut: "G O"
      },
      {
        label: "Team hub",
        labelKey: "teamHub",
        href: "/team-hub",
        icon: "Users2",
        description: "Your department's knowledge base: guides, contacts, and resources",
        shortcut: "G B",
        moduleId: "team_hub"
      }
    ]
  },
  {
    label: "Finance",
    labelKey: "finance",
    requiredRoles: ["FINANCE_ADMIN", "FINANCE_APPROVER", "SUPER_ADMIN"],
    items: [
      {
        label: "Payroll",
        labelKey: "payroll",
        href: "/payroll",
        icon: "Banknote",
        description: "Monthly payroll worksheet with semimonthly cycle approval",
        shortcut: "F P",
        moduleId: "payroll"
      },
      {
        label: "Finance oversight",
        labelKey: "financeOversight",
        href: "/payroll/oversight",
        icon: "ShieldAlert",
        description: "Cycles awaiting approval, payout blockers, and audit status",
        shortcut: "F O"
      },
      {
        label: "Compensation",
        labelKey: "compensation",
        href: "/admin/compensation",
        icon: "Coins",
        description: "Manage salary, allowances, and equity for team members",
        shortcut: "F C"
      }
    ]
  },
  {
    label: "Operations",
    labelKey: "operations",
    requiredRoles: ["HR_ADMIN", "SUPER_ADMIN"],
    items: [
      {
        label: "People",
        labelKey: "people",
        href: "/people",
        icon: "Users",
        description: "Manage employee records, roles, and access",
        shortcut: "G P"
      },
      {
        label: "Performance",
        labelKey: "performance",
        href: "/performance",
        icon: "Target",
        description: "Run review cycles, track completion, and calibrate fairly",
        shortcut: "G R",
        moduleId: "performance"
      },
      {
        label: "Compliance",
        labelKey: "compliance",
        href: "/compliance",
        icon: "ShieldCheck",
        description: "Statutory filings with due dates, proof, and country tracking",
        shortcut: "G M"
      },
      {
        label: "Analytics",
        labelKey: "analytics",
        href: "/analytics",
        icon: "BarChart3",
        description: "Workforce and operations trends with filters and exports",
        shortcut: "G N",
        moduleId: "analytics"
      },
      {
        label: "Document management",
        labelKey: "documentManagement",
        href: "/documents",
        icon: "FolderOpen",
        description: "Manage employee documents, policies, and organization records",
        shortcut: "G O"
      },
      {
        label: "Signatures",
        labelKey: "signatures",
        href: "/signatures",
        icon: "PenLine",
        description: "Request, sign, and track documents with signer timelines",
        shortcut: "G I",
        moduleId: "signatures"
      }
    ]
  },
  {
    label: "Admin",
    labelKey: "admin",
    adminOnly: true,
    requiredRoles: ["SUPER_ADMIN"],
    items: [
      {
        label: "Roles & access",
        labelKey: "rolesAccess",
        href: "/admin/access-control",
        icon: "Lock",
        description: "Default role permissions and per-person overrides",
        shortcut: "A A"
      },
      {
        label: "Audit log",
        labelKey: "auditLog",
        href: "/settings?tab=audit",
        icon: "ScrollText",
        description: "Who did what, when, and to which record",
        shortcut: "A L"
      },
      {
        label: "Expense routing",
        labelKey: "expenseRouting",
        href: "/admin/expense-routing",
        icon: "Route",
        description: "Configure additional approval routing rules for expenses",
        shortcut: "A E"
      }
    ]
  }
];

export const ROUTE_ITEMS: NavItem[] = NAV_GROUPS.flatMap((group) => group.items);
