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
        label: "Time Off",
        href: "/time-off",
        description: "Requests, balances, and approval queues.",
        shortcut: "G T"
      },
      {
        label: "Documents",
        href: "/documents",
        description: "Contracts, policies, and signed files.",
        shortcut: "G C"
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
        label: "Expenses",
        href: "/expenses",
        description: "Claims, approvals, and reimbursements.",
        shortcut: "G E"
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
