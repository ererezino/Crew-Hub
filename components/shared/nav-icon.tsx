"use client";

import {
  LayoutDashboard,
  Megaphone,
  CalendarOff,
  Receipt,
  CalendarClock,
  Clock,
  FileText,
  Wallet,
  GraduationCap,
  Star,
  CheckCircle,
  Users,
  Calendar,
  Rocket,
  BarChart3,
  ShieldCheck,
  UserCog,
  Coins,
  Calculator,
  CreditCard,
  Lock,
  Settings,
  PenTool,
  BookOpen,
  Building,
  ScrollText,
  type LucideIcon,
} from "lucide-react";

const ICON_MAP: Record<string, LucideIcon> = {
  LayoutDashboard,
  Megaphone,
  CalendarOff,
  Receipt,
  CalendarClock,
  Clock,
  FileText,
  Wallet,
  GraduationCap,
  Star,
  CheckCircle,
  Users,
  Calendar,
  Rocket,
  BarChart3,
  ShieldCheck,
  UserCog,
  Coins,
  Calculator,
  CreditCard,
  Lock,
  Settings,
  PenTool,
  BookOpen,
  Building,
  ScrollText,
};

type NavIconProps = {
  name: string;
  size?: number;
  className?: string;
};

export function NavIcon({ name, size = 18, className }: NavIconProps) {
  const IconComponent = ICON_MAP[name];

  if (!IconComponent) {
    return (
      <span
        className={className}
        style={{
          width: size,
          height: size,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: "currentColor",
            opacity: 0.5,
          }}
        />
      </span>
    );
  }

  return <IconComponent size={size} className={className} strokeWidth={1.8} />;
}
