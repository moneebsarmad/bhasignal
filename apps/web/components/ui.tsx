import Link from "next/link";
import type { ComponentPropsWithoutRef, HTMLAttributes, ReactNode } from "react";
import { forwardRef } from "react";
import { AlertCircle, CheckCircle2, Info, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/cn";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg";
type StatusTone = "neutral" | "info" | "success" | "warning" | "danger";

const buttonVariantClassName: Record<ButtonVariant, string> = {
  primary:
    "bg-[var(--color-primary)] text-white shadow-card hover:bg-[var(--color-primary-strong)] border-transparent",
  secondary:
    "border-[var(--color-line)] bg-white/90 text-[var(--color-ink)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]",
  ghost: "border-transparent bg-transparent text-[var(--color-muted)] hover:bg-white hover:text-[var(--color-ink)]",
  danger: "border-transparent bg-[var(--color-danger-soft)] text-[var(--color-danger)] hover:bg-[#fde2db]"
};

const buttonSizeClassName: Record<ButtonSize, string> = {
  sm: "h-9 rounded-full px-3.5 text-sm",
  md: "h-11 rounded-full px-5 text-sm",
  lg: "h-12 rounded-full px-6 text-sm"
};

const statusToneClassName: Record<StatusTone, string> = {
  neutral: "border-[var(--color-line)] bg-white text-[var(--color-muted)]",
  info: "border-[#b8d7d1] bg-[#eef8f5] text-[var(--color-primary)]",
  success: "border-[#b8e3cc] bg-[#eef9f1] text-[var(--color-success)]",
  warning: "border-[#ead7aa] bg-[#fdf7e6] text-[var(--color-warning)]",
  danger: "border-[#efc1b2] bg-[#fff0ea] text-[var(--color-danger)]"
};

export function buttonStyles({
  variant = "secondary",
  size = "md",
  className
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
}) {
  return cn(
    "inline-flex items-center justify-center gap-2 border font-semibold tracking-[0.02em] transition duration-200 disabled:cursor-not-allowed disabled:opacity-60",
    buttonVariantClassName[variant],
    buttonSizeClassName[size],
    className
  );
}

export function Button({
  className,
  variant,
  size,
  ...props
}: ComponentPropsWithoutRef<"button"> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <button className={buttonStyles({ variant, size, className })} {...props} />;
}

export const Input = forwardRef<HTMLInputElement, ComponentPropsWithoutRef<"input">>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "h-11 w-full rounded-2xl border border-[var(--color-line)] bg-white px-4 text-sm text-[var(--color-ink)] outline-none transition placeholder:text-[var(--color-subtle)] focus:border-[var(--color-primary)] focus:ring-4 focus:ring-[var(--color-ring)]",
        className
      )}
      {...props}
    />
  )
);

Input.displayName = "Input";

export const Textarea = forwardRef<HTMLTextAreaElement, ComponentPropsWithoutRef<"textarea">>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        "min-h-[8rem] w-full rounded-[1.5rem] border border-[var(--color-line)] bg-white px-4 py-3 text-sm text-[var(--color-ink)] outline-none transition placeholder:text-[var(--color-subtle)] focus:border-[var(--color-primary)] focus:ring-4 focus:ring-[var(--color-ring)]",
        className
      )}
      {...props}
    />
  )
);

Textarea.displayName = "Textarea";

export const Select = forwardRef<HTMLSelectElement, ComponentPropsWithoutRef<"select">>(
  ({ className, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        "h-11 w-full rounded-2xl border border-[var(--color-line)] bg-white px-4 text-sm text-[var(--color-ink)] outline-none transition focus:border-[var(--color-primary)] focus:ring-4 focus:ring-[var(--color-ring)]",
        className
      )}
      {...props}
    />
  )
);

Select.displayName = "Select";

export const Checkbox = forwardRef<HTMLInputElement, ComponentPropsWithoutRef<"input">>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      type="checkbox"
      className={cn(
        "h-4 w-4 rounded border-[var(--color-line-strong)] text-[var(--color-primary)] focus:ring-[var(--color-ring)]",
        className
      )}
      {...props}
    />
  )
);

Checkbox.displayName = "Checkbox";

export function Field({
  label,
  hint,
  className,
  children
}: {
  label: string;
  hint?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={cn("grid gap-2", className)}>
      <span className="text-sm font-semibold text-[var(--color-ink)]">{label}</span>
      {children}
      {hint ? <span className="text-xs text-[var(--color-subtle)]">{hint}</span> : null}
    </label>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className
}: {
  eyebrow?: string;
  title: string;
  description: string;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between", className)}>
      <div className="max-w-3xl space-y-3">
        {eyebrow ? (
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[var(--color-primary)]">{eyebrow}</p>
        ) : null}
        <div className="space-y-2">
          <h1 className="font-display text-3xl leading-tight text-[var(--color-ink)] sm:text-[2.35rem]">{title}</h1>
          <p className="max-w-2xl text-sm leading-7 text-[var(--color-muted)] sm:text-[0.96rem]">{description}</p>
        </div>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-3">{actions}</div> : null}
    </div>
  );
}

export function Panel({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-[1.75rem] border border-[var(--color-line)] bg-white/95 p-5 shadow-card backdrop-blur sm:p-6",
        className
      )}
      {...props}
    />
  );
}

export function SoftPanel({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-[1.5rem] border border-[var(--color-line)] bg-[var(--color-soft-surface)] p-5 sm:p-6",
        className
      )}
      {...props}
    />
  );
}

export function SectionHeader({
  title,
  description,
  actions,
  className
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between", className)}>
      <div className="space-y-1">
        <h2 className="font-display text-2xl text-[var(--color-ink)]">{title}</h2>
        {description ? <p className="text-sm text-[var(--color-muted)]">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-3">{actions}</div> : null}
    </div>
  );
}

export function InlineAlert({
  tone = "info",
  title,
  children,
  className
}: {
  tone?: StatusTone;
  title: string;
  children?: ReactNode;
  className?: string;
}) {
  const Icon = tone === "success" ? CheckCircle2 : tone === "danger" ? AlertCircle : Info;

  return (
    <div className={cn("flex items-start gap-3 rounded-[1.35rem] border p-4", statusToneClassName[tone], className)}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="space-y-1">
        <p className="text-sm font-semibold">{title}</p>
        {children ? <div className="text-sm leading-6">{children}</div> : null}
      </div>
    </div>
  );
}

export function InsightPanel({
  eyebrow = "Insight",
  title,
  description,
  className,
  children
}: {
  eyebrow?: string;
  title: string;
  description: string;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <Panel
      className={cn(
        "overflow-hidden bg-[linear-gradient(135deg,rgba(17,94,89,0.08),rgba(255,255,255,0.98)_42%,rgba(173,124,44,0.08))]",
        className
      )}
    >
      <div className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--color-primary)]">{eyebrow}</p>
        <div className="space-y-2">
          <h3 className="font-display text-2xl text-[var(--color-ink)]">{title}</h3>
          <p className="max-w-3xl text-sm leading-7 text-[var(--color-muted)]">{description}</p>
        </div>
      </div>
      {children ? <div className="mt-5">{children}</div> : null}
    </Panel>
  );
}

export function StatusBadge({
  tone = "neutral",
  className,
  children
}: {
  tone?: StatusTone;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em]",
        statusToneClassName[tone],
        className
      )}
    >
      {children}
    </span>
  );
}

export function StatCard({
  label,
  value,
  description,
  icon: Icon,
  href,
  linkLabel = "Open",
  className
}: {
  label: string;
  value: ReactNode;
  description: string;
  icon?: LucideIcon;
  href?: string;
  linkLabel?: string;
  className?: string;
}) {
  return (
    <Panel className={cn("relative overflow-hidden", className)}>
      <div className="absolute right-0 top-0 h-24 w-24 rounded-full bg-[radial-gradient(circle_at_center,_rgba(17,94,89,0.10),_transparent_70%)]" />
      <div className="relative flex items-start justify-between gap-4">
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--color-subtle)]">{label}</p>
          <p className="font-display text-4xl text-[var(--color-ink)]">{value}</p>
          <p className="text-sm leading-6 text-[var(--color-muted)]">{description}</p>
          {href ? (
            <div className="pt-1">
              <Link
                href={href}
                className="text-sm font-semibold text-[var(--color-primary)] transition hover:text-[var(--color-primary-strong)]"
              >
                {linkLabel}
              </Link>
            </div>
          ) : null}
        </div>
        {Icon ? (
          <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-soft-surface)] p-3 text-[var(--color-primary)]">
            <Icon className="h-5 w-5" />
          </div>
        ) : null}
      </div>
    </Panel>
  );
}

export function EmptyState({
  title,
  description,
  action,
  className
}: {
  title: string;
  description: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-h-[13rem] flex-col items-center justify-center rounded-[1.5rem] border border-dashed border-[var(--color-line-strong)] bg-[var(--color-soft-surface)] px-6 py-10 text-center",
        className
      )}
    >
      <div className="space-y-3">
        <p className="font-display text-2xl text-[var(--color-ink)]">{title}</p>
        <p className="mx-auto max-w-md text-sm leading-7 text-[var(--color-muted)]">{description}</p>
      </div>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export const tableShellClassName =
  "overflow-hidden rounded-[1.5rem] border border-[var(--color-line)] bg-white";
export const tableClassName = "min-w-full divide-y divide-[var(--color-line)] text-left text-sm";
export const tableHeadCellClassName =
  "bg-[var(--color-soft-surface)] px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-subtle)]";
export const tableCellClassName = "px-4 py-3.5 align-top text-sm text-[var(--color-muted)]";
