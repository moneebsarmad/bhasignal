import type { LucideIcon } from "lucide-react";
import {
  Activity,
  BarChart3,
  BellDot,
  FileSpreadsheet,
  LayoutDashboard,
  Scale,
  ScrollText,
  ShieldCheck,
  Upload,
  Users
} from "lucide-react";

import type { UserRole } from "@/lib/auth";
import { APP_DESCRIPTION, APP_NAME } from "@/lib/brand";

export interface NavItem {
  href: string;
  label: string;
  description: string;
  icon: LucideIcon;
  roles: UserRole[];
}

export interface NavSection {
  label: string;
  items: NavItem[];
}

export interface PageMeta {
  title: string;
  description: string;
}

function personalizeNavItem(item: NavItem, role: UserRole): NavItem {
  if (role === "admin" && item.href === "/review") {
    return {
      ...item,
      label: "Exceptions",
      description: "Fallback PDF review when imported rows need manual correction."
    };
  }

  return item;
}

const allNavItems: NavItem[] = [
  {
    href: "/dashboard",
    label: "Dashboard",
    description: "Live intervention posture and pipeline health.",
    icon: LayoutDashboard,
    roles: ["admin", "reviewer"]
  },
  {
    href: "/ingestion",
    label: "Data Intake",
    description: "Manage Sycamore syncs and fallback imports.",
    icon: Upload,
    roles: ["admin", "reviewer"]
  },
  {
    href: "/review",
    label: "Review",
    description: "Resolve low-confidence records before promotion.",
    icon: ShieldCheck,
    roles: ["admin", "reviewer"]
  },
  {
    href: "/students",
    label: "Students",
    description: "Inspect student timelines, interventions, and history.",
    icon: Users,
    roles: ["admin", "reviewer"]
  },
  {
    href: "/policies",
    label: "Policies",
    description: "Version thresholds and run evaluation cycles.",
    icon: Scale,
    roles: ["admin"]
  },
  {
    href: "/notifications",
    label: "Notifications",
    description: "Configure recipients, templates, and queue dispatch.",
    icon: BellDot,
    roles: ["admin"]
  },
  {
    href: "/audit",
    label: "Audit",
    description: "Trace every important workflow event.",
    icon: ScrollText,
    roles: ["admin", "reviewer"]
  },
  {
    href: "/reports",
    label: "Analytics",
    description: "Explore deep discipline trends, filters, and stored-data patterns.",
    icon: BarChart3,
    roles: ["admin", "reviewer"]
  },
  {
    href: "/data-ops",
    label: "Data Ops",
    description: "Monitor parser, storage, and workflow system health.",
    icon: Activity,
    roles: ["admin"]
  }
];

const navSectionConfigByRole: Record<UserRole, ReadonlyArray<{ label: string; hrefs: readonly string[] }>> = {
  admin: [
    {
      label: "Operations",
      hrefs: ["/dashboard", "/ingestion", "/students"]
    },
    {
      label: "Analysis",
      hrefs: ["/reports"]
    },
    {
      label: "Controls",
      hrefs: ["/policies", "/notifications", "/data-ops"]
    },
    {
      label: "Governance",
      hrefs: ["/audit"]
    },
    {
      label: "Exceptions",
      hrefs: ["/review"]
    }
  ],
  reviewer: [
    {
      label: "Operations",
      hrefs: ["/dashboard", "/ingestion", "/review", "/students"]
    },
    {
      label: "Analysis",
      hrefs: ["/reports"]
    },
    {
      label: "Governance",
      hrefs: ["/audit"]
    }
  ]
};

function itemsForRole(role: UserRole): NavItem[] {
  return allNavItems.filter((item) => item.roles.includes(role)).map((item) => personalizeNavItem(item, role));
}

function sectionsForRole(role: UserRole): NavSection[] {
  const items = itemsForRole(role);
  return navSectionConfigByRole[role]
    .map((section) => ({
      label: section.label,
      items: section.hrefs
        .map((href) => items.find((item) => item.href === href))
        .filter((item): item is NavItem => Boolean(item))
    }))
    .filter((section) => section.items.length > 0);
}

export const navSectionsByRole: Record<UserRole, NavSection[]> = {
  admin: sectionsForRole("admin"),
  reviewer: sectionsForRole("reviewer")
};

export const pageMetaByPath: Record<string, PageMeta> = {
  "/dashboard": {
    title: "Discipline Dashboard",
    description: "Watch source freshness, threshold pressure, and the discipline signal that needs action next."
  },
  "/ingestion": {
    title: "Data Intake",
    description: "Run primary Sycamore syncs, manage fallback PDF imports, and keep intake operations orderly."
  },
  "/review": {
    title: "Exception Review",
    description: "Work through fallback-import and other low-confidence records before anything is promoted."
  },
  "/students": {
    title: "Student Profiles",
    description: "Search students, inspect timelines, and update interventions without leaving the context."
  },
  "/policies": {
    title: "Policy Engine",
    description: "Define thresholds, intervention templates, and evaluation runs with a clear audit trail."
  },
  "/notifications": {
    title: "Notification Operations",
    description: "Manage who receives alerts, what gets sent, and how the dispatch queue is behaving."
  },
  "/audit": {
    title: "Audit Explorer",
    description: "Follow ingestion, review, policy, and notification activity at a row-by-row level."
  },
  "/reports": {
    title: "Deep Analytics",
    description: "Explore stored discipline patterns, escalation pressure, and filtered trends that support school decisions."
  },
  "/data-ops": {
    title: "Data Operations",
    description: "Inspect parser health, storage mode, job failures, and workflow backlogs without exposing database internals."
  }
};

export function getPageMeta(pathname: string): PageMeta {
  return (
    pageMetaByPath[pathname] ?? {
      title: APP_NAME,
      description: APP_DESCRIPTION
    }
  );
}

export const shellAccentIcon = FileSpreadsheet;
