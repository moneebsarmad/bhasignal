"use client";

import { FormEvent, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, ShieldCheck } from "lucide-react";

import { APP_NAME } from "@/lib/brand";
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
      <div className="relative mx-auto flex min-h-[calc(100vh-4rem)] max-w-md items-center">
        <section className="w-full rounded-[1.5rem] border border-white/75 bg-[rgba(255,255,255,0.92)] p-6 shadow-hush backdrop-blur sm:p-7">
          <div className="mb-6 flex items-start justify-between gap-4">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[var(--color-primary)]">
                {APP_NAME}
              </p>
              <h1 className="font-display text-4xl text-[var(--color-ink)]">Sign in</h1>
              <p className="text-sm leading-6 text-[var(--color-muted)]">
                Use your admin or reviewer credentials to continue.
              </p>
            </div>
            <div className="rounded-xl bg-[var(--color-primary-soft)] p-2.5 text-[var(--color-primary)]">
              <ShieldCheck className="h-4 w-4" />
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

            <div className="flex justify-end">
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
