"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";

import type { UserRole } from "@/lib/auth";
import { APP_CATEGORY, APP_DESCRIPTION, APP_NAME } from "@/lib/brand";
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
    <div className="flex h-full flex-col gap-6">
      <div className="rounded-[1.75rem] border border-white/60 bg-[linear-gradient(160deg,rgba(255,255,255,0.98),rgba(244,240,232,0.96))] p-5 shadow-card">
        <div className="mb-4 flex items-center gap-3">
          <div className="rounded-2xl bg-[var(--color-primary)] p-3 text-white shadow-card">
            <ShellAccentIcon className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[var(--color-primary)]">{APP_CATEGORY}</p>
            <p className="font-display text-xl text-[var(--color-ink)]">{APP_NAME}</p>
          </div>
        </div>
        <p className="text-sm leading-7 text-[var(--color-muted)]">{APP_DESCRIPTION}</p>
      </div>

      <nav className="flex-1 space-y-5">
        {navSections.map((section) => (
          <div key={section.label} className="space-y-2">
            <p className="px-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--color-subtle)]">
              {section.label}
            </p>
            <div className="space-y-2">
              {section.items.map((item) => {
                const Icon = item.icon;
                const isActive = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "group flex items-start gap-3 rounded-[1.4rem] border px-4 py-3 transition",
                      isActive
                        ? "border-[var(--color-primary)] bg-[var(--color-primary-soft)] shadow-card"
                        : "border-transparent bg-transparent hover:border-[var(--color-line)] hover:bg-white"
                    )}
                    onClick={() => setIsMobileNavOpen(false)}
                  >
                    <div
                      className={cn(
                        "rounded-2xl p-2.5 transition",
                        isActive
                          ? "bg-white text-[var(--color-primary)]"
                          : "bg-[var(--color-soft-surface)] text-[var(--color-muted)] group-hover:text-[var(--color-primary)]"
                      )}
                    >
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="space-y-1">
                      <p className="text-sm font-semibold text-[var(--color-ink)]">{item.label}</p>
                      <p className="text-xs leading-5 text-[var(--color-muted)]">{item.description}</p>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="rounded-[1.4rem] border border-[var(--color-line)] bg-white/90 p-4">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-subtle)]">Session</p>
        <p className="mt-2 text-sm font-semibold text-[var(--color-ink)]">{email}</p>
        <p className="mt-1 text-sm text-[var(--color-muted)]">
          {role === "admin" ? "Administrator access" : "Reviewer access"}
        </p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[var(--color-canvas)] text-[var(--color-ink)]">
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(17,94,89,0.14),_transparent_36%),radial-gradient(circle_at_bottom_right,_rgba(173,124,44,0.11),_transparent_28%),linear-gradient(180deg,_rgba(248,246,240,0.96),_rgba(243,238,230,0.84))]" />
        <div className="absolute inset-0 bg-[linear-gradient(transparent_95%,rgba(90,96,104,0.03)_100%),linear-gradient(90deg,transparent_95%,rgba(90,96,104,0.03)_100%)] bg-[size:24px_24px]" />
      </div>

      <div className="mx-auto flex min-h-screen max-w-shell gap-5 px-4 py-4 sm:px-6 lg:px-8">
        <aside className="sticky top-4 hidden h-[calc(100vh-2rem)] w-80 shrink-0 rounded-[2rem] border border-white/60 bg-[rgba(250,248,243,0.78)] p-5 shadow-hush backdrop-blur lg:block">
          {sidebar}
        </aside>

        <div className="flex min-h-[calc(100vh-2rem)] min-w-0 flex-1 flex-col gap-5">
          <header className="sticky top-4 z-30 rounded-[1.75rem] border border-white/70 bg-[rgba(255,255,255,0.82)] px-4 py-4 shadow-card backdrop-blur sm:px-5">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
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
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.26em] text-[var(--color-primary)]">
                    {APP_NAME}
                  </p>
                  <div>
                    <p className="font-display text-[1.9rem] leading-none text-[var(--color-ink)]">
                      {pageMeta.title}
                    </p>
                    <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--color-muted)]">
                      {pageMeta.description}
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-end gap-3">
                <StatusBadge tone={role === "admin" ? "info" : "neutral"}>{role}</StatusBadge>
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
          <div className="ml-auto h-full w-[22rem] max-w-[90vw] border-l border-white/60 bg-[rgba(247,244,237,0.96)] p-4 shadow-hush">
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
