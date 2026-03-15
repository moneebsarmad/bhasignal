"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";

import type { UserRole } from "@/lib/auth";
import { APP_NAME } from "@/lib/brand";
import { cn } from "@/lib/cn";
import { getPageMeta, navSectionsByRole, shellAccentIcon as ShellAccentIcon } from "@/lib/navigation";
import { Button, StatusBadge, buttonStyles } from "@/components/ui";

export function AppShell({
  email,
  role,
  children
}: {
  email: string;
  role: UserRole;
  children: ReactNode;
  }) {
  const pathname = usePathname();
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const navSections = navSectionsByRole[role];
  const pageMeta = useMemo(() => getPageMeta(pathname), [pathname]);

  const sidebar = (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex items-center gap-3 px-1">
        <div className="rounded-xl bg-[var(--color-primary)] p-2.5 text-white shadow-card">
          <ShellAccentIcon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <p className="truncate font-display text-lg text-[var(--color-ink)]">{APP_NAME}</p>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--color-subtle)]">{role}</p>
        </div>
      </div>

      <nav className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
        {navSections.map((section) => (
          <div key={section.label} className="space-y-1.5">
            <p className="px-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--color-subtle)]">
              {section.label}
            </p>
            <div className="space-y-1.5">
              {section.items.map((item) => {
                const Icon = item.icon;
                const isActive = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "group flex items-center gap-3 rounded-[1rem] border px-3 py-2.5 transition",
                      isActive
                        ? "border-[var(--color-primary)] bg-[var(--color-primary-soft)] shadow-card"
                        : "border-transparent bg-transparent hover:border-[var(--color-line)] hover:bg-white"
                    )}
                    onClick={() => setIsMobileNavOpen(false)}
                  >
                    <div
                      className={cn(
                        "rounded-xl p-2 transition",
                        isActive
                          ? "bg-white text-[var(--color-primary)]"
                          : "bg-[var(--color-soft-surface)] text-[var(--color-muted)] group-hover:text-[var(--color-primary)]"
                      )}
                    >
                      <Icon className="h-4 w-4" />
                    </div>
                    <p className="text-sm font-semibold text-[var(--color-ink)]">{item.label}</p>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="shrink-0 border-t border-[var(--color-line)] px-1 pt-3">
        <p className="truncate text-sm font-medium text-[var(--color-ink)]">{email}</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[var(--color-canvas)] text-[var(--color-ink)]">
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(17,94,89,0.14),_transparent_36%),radial-gradient(circle_at_bottom_right,_rgba(173,124,44,0.11),_transparent_28%),linear-gradient(180deg,_rgba(248,246,240,0.96),_rgba(243,238,230,0.84))]" />
        <div className="absolute inset-0 bg-[linear-gradient(transparent_95%,rgba(90,96,104,0.03)_100%),linear-gradient(90deg,transparent_95%,rgba(90,96,104,0.03)_100%)] bg-[size:24px_24px]" />
      </div>

      <div className="mx-auto flex min-h-screen max-w-shell gap-4 px-4 py-4 sm:px-6 lg:px-8">
        <aside className="sticky top-4 hidden h-[calc(100vh-2rem)] w-64 shrink-0 overflow-hidden rounded-[1.5rem] border border-white/60 bg-[rgba(250,248,243,0.78)] p-4 shadow-hush backdrop-blur lg:block">
          {sidebar}
        </aside>

        <div className="flex min-h-[calc(100vh-2rem)] min-w-0 flex-1 flex-col gap-4">
          <header className="sticky top-4 z-30 rounded-[1.5rem] border border-white/70 bg-[rgba(255,255,255,0.82)] px-4 py-3 shadow-card backdrop-blur">
            <div className="flex items-center justify-between gap-4">
              <div className="flex min-w-0 items-center gap-3">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="lg:hidden"
                  onClick={() => setIsMobileNavOpen(true)}
                  aria-label="Open navigation"
                >
                  <Menu className="h-4 w-4" />
                </Button>
                <p className="truncate font-display text-[1.55rem] leading-none text-[var(--color-ink)]">
                  {pageMeta.title}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <StatusBadge tone={role === "admin" ? "info" : "neutral"} className="hidden sm:inline-flex">
                  {role}
                </StatusBadge>
                <a className={buttonStyles({ variant: "secondary", size: "sm" })} href="/api/auth/logout">
                  Sign out
                </a>
              </div>
            </div>
          </header>

          <main className="flex-1 min-w-0">{children}</main>
        </div>
      </div>

      {isMobileNavOpen ? (
        <div className="fixed inset-0 z-40 bg-[rgba(15,23,42,0.28)] backdrop-blur-sm lg:hidden">
          <div className="ml-auto h-full w-[18rem] max-w-[90vw] overflow-y-auto border-l border-white/60 bg-[rgba(247,244,237,0.96)] p-4 shadow-hush">
            <div className="mb-4 flex justify-end">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setIsMobileNavOpen(false)}
                aria-label="Close navigation"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            {sidebar}
          </div>
        </div>
      ) : null}
    </div>
  );
}
