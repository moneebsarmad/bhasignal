"use client";

import { FormEvent, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, ShieldCheck } from "lucide-react";

import { Button, Input } from "@/components/ui";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = searchParams.get("next") || "/dashboard";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsLoading(true);
    setError(null);

    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error || "Login failed.");
      setIsLoading(false);
      return;
    }

    router.replace(nextPath);
    router.refresh();
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-[var(--color-canvas)] px-4 py-8 sm:px-6 lg:px-8">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(17,94,89,0.16),_transparent_34%),radial-gradient(circle_at_bottom_right,_rgba(173,124,44,0.12),_transparent_28%)]" />
      <div className="relative mx-auto grid min-h-[calc(100vh-4rem)] max-w-6xl items-center gap-10 lg:grid-cols-[1.05fr_0.95fr]">
        <section className="space-y-8">
          <div className="space-y-4">
            <p className="text-xs font-semibold uppercase tracking-[0.32em] text-[var(--color-primary)]">
              Sycamore Discipline Intelligence
            </p>
            <div className="space-y-4">
              <h1 className="max-w-2xl font-display text-5xl leading-[1.02] text-[var(--color-ink)] sm:text-6xl">
                Clean discipline operations, without spreadsheet drift.
              </h1>
              <p className="max-w-xl text-base leading-8 text-[var(--color-muted)]">
                Review parser output, track intervention thresholds, and manage notification workflows from a single
                calm admin workspace.
              </p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-[1.5rem] border border-white/70 bg-white/85 p-5 shadow-card backdrop-blur">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-subtle)]">Trust</p>
              <p className="mt-3 font-display text-2xl text-[var(--color-ink)]">Manual-first</p>
              <p className="mt-2 text-sm leading-7 text-[var(--color-muted)]">
                Human review remains in the loop before policy and notification actions are triggered.
              </p>
            </div>
            <div className="rounded-[1.5rem] border border-white/70 bg-white/85 p-5 shadow-card backdrop-blur">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-subtle)]">Audience</p>
              <p className="mt-3 font-display text-2xl text-[var(--color-ink)]">Admin focused</p>
              <p className="mt-2 text-sm leading-7 text-[var(--color-muted)]">
                Built for principals, discipline coordinators, and reviewers who need fast operational visibility.
              </p>
            </div>
          </div>
        </section>

        <section className="rounded-[2rem] border border-white/75 bg-[rgba(255,255,255,0.92)] p-6 shadow-hush backdrop-blur sm:p-8">
          <div className="mb-8 flex items-start justify-between gap-4">
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[var(--color-primary)]">
                Secure Sign In
              </p>
              <div className="space-y-2">
                <h2 className="font-display text-4xl text-[var(--color-ink)]">Access the console</h2>
                <p className="text-sm leading-7 text-[var(--color-muted)]">
                  Use your assigned admin or reviewer credentials to continue into the protected workspace.
                </p>
              </div>
            </div>
            <div className="rounded-2xl bg-[var(--color-primary-soft)] p-3 text-[var(--color-primary)]">
              <ShieldCheck className="h-5 w-5" />
            </div>
          </div>

          <form onSubmit={onSubmit} className="grid gap-5">
            <label className="grid gap-2">
              <span className="text-sm font-semibold text-[var(--color-ink)]">Email</span>
              <Input
                id="email"
                name="email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="name@school.org"
                required
              />
            </label>

            <label className="grid gap-2">
              <span className="text-sm font-semibold text-[var(--color-ink)]">Password</span>
              <Input
                id="password"
                name="password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="••••••••••"
                required
              />
            </label>

            {error ? (
              <div className="rounded-[1.25rem] border border-[#efc1b2] bg-[var(--color-danger-soft)] px-4 py-3 text-sm text-[var(--color-danger)]">
                {error}
              </div>
            ) : null}

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs uppercase tracking-[0.22em] text-[var(--color-subtle)]">Protected administrative environment</p>
              <Button type="submit" variant="primary" size="lg" disabled={isLoading}>
                {isLoading ? "Signing in..." : "Sign in"}
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </form>
        </section>
      </div>
    </main>
  );
}
