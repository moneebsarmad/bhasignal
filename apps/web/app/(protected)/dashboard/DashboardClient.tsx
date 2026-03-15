"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, BellDot, RefreshCcw, ShieldCheck, Siren, Users } from "lucide-react";

import {
  Button,
  EmptyState,
  Field,
  InlineAlert,
  Input,
  PageHeader,
  Panel,
  Select,
  SoftPanel,
  StatCard,
  StatusBadge,
  buttonStyles,
  tableCellClassName,
  tableClassName,
  tableHeadCellClassName,
  tableShellClassName
} from "@/components/ui";
import { cn } from "@/lib/cn";
import { DeepAnalytics } from "@/components/deep-analytics";

interface DashboardPayload {
  filters: {
    grade: string;
    sourceType: string;
  };
  metrics: {
    studentsTracked: number;
    incidentsTracked: number;
    totalPoints: number;
    studentsAt10Plus: number;
    studentsAt35Plus: number;
    openInterventions: number;
    queuedNotifications: number;
    failedNotifications: number;
  };
  bandCounts: Array<{
    id: string;
    label: string;
    shortLabel: string;
    tone: "neutral" | "info" | "success" | "warning" | "danger";
    count: number;
    parentCommunication: string;
    adminAction: string;
  }>;
  actionQueue: Array<{
    studentId: string;
    fullName: string;
    grade: string;
    totalPoints: number;
    currentBandId: string;
    currentBandLabel: string;
    currentBandTone: "neutral" | "info" | "success" | "warning" | "danger";
    parentCommunication: string;
    adminAction: string;
    adminMessage: string;
    policyImpact: string;
    latestIncidentAt: string | null;
    activeInterventions: number;
    queuedNotifications: number;
    failedNotifications: number;
  }>;
  gradePressure: Array<{
    grade: string;
    studentCount: number;
    incidentCount: number;
    totalPoints: number;
    escalatedCount: number;
    criticalCount: number;
  }>;
  violationHotspots: Array<{
    label: string;
    incidentCount: number;
    totalPoints: number;
  }>;
  recentTrend: Array<{
    period: string;
    incidentCount: number;
    totalPoints: number;
  }>;
  interventionCounts: Record<string, number>;
  notificationCounts: Record<string, number>;
  parseRunStatus: Record<string, number>;
  parseRunSourceCounts: Record<string, number>;
  sycamore: {
    configured: boolean;
    error?: string;
    totalLogs: number;
    linkedLogs: number;
    lastSync: {
      id: string;
      triggeredBy: string;
      startedAt: string;
      completedAt: string | null;
      recordsSynced: number;
      recordsDiscovered: number;
      recordsUpserted: number;
      status: "running" | "success" | "partial" | "failed";
      errorMessage: string | null;
      syncMode: "initial_backfill" | "incremental" | "manual_range" | null;
      windowStartDate: string | null;
      windowEndDate: string | null;
    } | null;
  };
}

interface SycamoreSyncBatchSummary {
  syncLogId: string | null;
  status: "queued" | "running" | "success" | "partial" | "failed";
  syncMode: "initial_backfill" | "incremental" | "manual_range";
  window: {
    startDate: string;
    endDate: string;
  };
  totalChunks: number;
  completedChunks: number;
  recordsDiscovered: number;
  recordsUpserted: number;
  warnings: string[];
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  activeJobStartedAt: string | null;
  lastHeartbeatAt: string | null;
  staleAfterMinutes: number;
  isStalled: boolean;
  triggeredBy: string;
}

interface SycamoreSyncActionResponse {
  sycamoreSync?: SycamoreSyncBatchSummary;
  alreadyQueued?: boolean;
  error?: string;
}

type DashboardTab = "command" | "analytics";

const DEFAULT_SOURCE_TYPE = "sycamore_api";

function prettifyKey(value: string): string {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function badgeToneForKey(key: string): "neutral" | "info" | "success" | "warning" | "danger" {
  if (key === "success" || key === "completed" || key === "sent") {
    return "success";
  }
  if (key === "partial" || key === "queued" || key === "open" || key === "review_required") {
    return "warning";
  }
  if (key === "running" || key === "in_progress" || key === "processing") {
    return "info";
  }
  if (key.includes("failed") || key === "overdue") {
    return "danger";
  }
  return "neutral";
}

function sourceLabel(sourceType: string): string {
  return sourceType === "manual_pdf" ? "PDF exception mode" : "Sycamore primary";
}

function syncModeLabel(value: "initial_backfill" | "incremental" | "manual_range" | null): string {
  if (value === "initial_backfill") {
    return "Initial backfill";
  }
  if (value === "incremental") {
    return "Incremental";
  }
  if (value === "manual_range") {
    return "Manual range";
  }
  return "Not run yet";
}

function sycamoreStatusSummary(sycamore: DashboardPayload["sycamore"]): {
  label: string;
  tone: "neutral" | "info" | "success" | "warning" | "danger";
  description: string;
} {
  if (!sycamore.configured) {
    return {
      label: "Not configured",
      tone: "warning",
      description: "Connect Sycamore so the command center can trust the primary source."
    };
  }

  if (sycamore.error || sycamore.lastSync?.status === "failed") {
    return {
      label: "Needs attention",
      tone: "danger",
      description: "The primary discipline source needs admin attention before the dashboard can be trusted."
    };
  }

  if (sycamore.lastSync?.status === "partial") {
    return {
      label: "Warnings present",
      tone: "warning",
      description: "The latest sync completed with warnings that should be reviewed before acting on the data."
    };
  }

  if (sycamore.lastSync?.status === "running") {
    return {
      label: "Sync in progress",
      tone: "info",
      description: "Sycamore is actively refreshing the mirrored discipline dataset."
    };
  }

  if (sycamore.lastSync?.status === "success") {
    return {
      label: "Live",
      tone: "success",
      description: "The command center is using the current primary discipline source."
    };
  }

  return {
    label: "Ready to sync",
    tone: "info",
    description: "Sycamore is configured and ready for the next manual or scheduled refresh."
  };
}

function handbookBandToneStyles(tone: "neutral" | "info" | "success" | "warning" | "danger") {
  switch (tone) {
    case "info":
      return {
        dot: "bg-sky-500",
        card: "border-sky-200/80 bg-[linear-gradient(135deg,rgba(14,165,233,0.08),rgba(255,255,255,0.96)_46%,rgba(14,165,233,0.03))]",
        chip: "bg-sky-100 text-sky-800"
      };
    case "success":
      return {
        dot: "bg-emerald-500",
        card: "border-emerald-200/80 bg-[linear-gradient(135deg,rgba(16,185,129,0.08),rgba(255,255,255,0.96)_46%,rgba(16,185,129,0.03))]",
        chip: "bg-emerald-100 text-emerald-800"
      };
    case "warning":
      return {
        dot: "bg-amber-500",
        card: "border-amber-200/80 bg-[linear-gradient(135deg,rgba(245,158,11,0.10),rgba(255,255,255,0.96)_46%,rgba(245,158,11,0.04))]",
        chip: "bg-amber-100 text-amber-800"
      };
    case "danger":
      return {
        dot: "bg-rose-500",
        card: "border-rose-200/80 bg-[linear-gradient(135deg,rgba(244,63,94,0.10),rgba(255,255,255,0.96)_46%,rgba(244,63,94,0.04))]",
        chip: "bg-rose-100 text-rose-800"
      };
    default:
      return {
        dot: "bg-slate-400",
        card: "border-slate-200/80 bg-[linear-gradient(135deg,rgba(148,163,184,0.08),rgba(255,255,255,0.96)_46%,rgba(148,163,184,0.03))]",
        chip: "bg-slate-100 text-slate-700"
      };
  }
}

function statusRows(record: Record<string, number>) {
  return Object.entries(record)
    .map(([key, count]) => ({
      key,
      label: prettifyKey(key),
      count
    }))
    .sort((left, right) => right.count - left.count);
}

export function DashboardClient({ canManageSycamore }: { canManageSycamore: boolean }) {
  const [activeTab, setActiveTab] = useState<DashboardTab>("command");
  const [grade, setGrade] = useState("");
  const [sourceType, setSourceType] = useState(DEFAULT_SOURCE_TYPE);
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSyncingSycamore, setIsSyncingSycamore] = useState(false);
  const [sycamoreNotice, setSycamoreNotice] = useState<string | null>(null);
  const [sycamoreNoticeTone, setSycamoreNoticeTone] = useState<"info" | "success">("success");
  const [sycamoreNoticeTitle, setSycamoreNoticeTitle] = useState("Sycamore sync updated.");
  const [sycamoreError, setSycamoreError] = useState<string | null>(null);
  const filtersRef = useRef({ grade: "", sourceType: DEFAULT_SOURCE_TYPE });
  filtersRef.current = { grade, sourceType };

  const loadMetrics = useCallback(async (nextFilters = filtersRef.current) => {
    setIsLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (nextFilters.grade.trim()) {
      params.set("grade", nextFilters.grade.trim());
    }
    if (nextFilters.sourceType) {
      params.set("sourceType", nextFilters.sourceType);
    }

    const response = await fetch(`/api/dashboard/metrics?${params.toString()}`, { cache: "no-store" });
    const body = (await response.json().catch(() => null)) as DashboardPayload | { error?: string } | null;
    if (!response.ok) {
      setError((body as { error?: string } | null)?.error || "Failed to load dashboard metrics.");
      setIsLoading(false);
      return;
    }

    const snapshot = body as DashboardPayload;
    setData(snapshot);
    setGrade(snapshot.filters.grade);
    setSourceType(snapshot.filters.sourceType || DEFAULT_SOURCE_TYPE);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    void loadMetrics();
  }, [loadMetrics]);

  async function onRunSycamoreSync() {
    setIsSyncingSycamore(true);
    setSycamoreError(null);
    setSycamoreNotice(null);
    setSycamoreNoticeTitle("Sycamore sync updated.");
    setSycamoreNoticeTone("success");

    try {
      const response = await fetch("/api/sycamore/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      });
      const body = (await response.json().catch(() => null)) as SycamoreSyncActionResponse | null;
      if (!response.ok) {
        setSycamoreError(body?.error || "Sycamore sync failed.");
        setIsSyncingSycamore(false);
        return;
      }

      const result = body?.sycamoreSync;
      if (result) {
        if (result.status === "queued") {
          setSycamoreNoticeTitle(body?.alreadyQueued ? "Sycamore sync already queued." : "Sycamore sync queued.");
          setSycamoreNoticeTone("info");
          setSycamoreNotice(
            `${syncModeLabel(result.syncMode)} sync ${result.window.startDate} to ${result.window.endDate} is queued in the background as ${result.totalChunks} job${result.totalChunks === 1 ? "" : "s"}.`
          );
        } else if (result.status === "running") {
          setSycamoreNoticeTitle("Sycamore sync running.");
          setSycamoreNoticeTone("info");
          setSycamoreNotice(
            `${syncModeLabel(result.syncMode)} sync ${result.window.startDate} to ${result.window.endDate} is running in the background. ${result.completedChunks} of ${result.totalChunks} job${result.totalChunks === 1 ? "" : "s"} finished so far.`
          );
        } else {
          setSycamoreNoticeTitle("Sycamore sync finished.");
          setSycamoreNoticeTone("success");
          setSycamoreNotice(
            `${syncModeLabel(result.syncMode)} sync ${result.window.startDate} to ${result.window.endDate} stored ${result.recordsUpserted} records${result.status === "partial" ? " with warnings" : ""}.`
          );
        }
      }
      if (result?.status !== "queued" && result?.status !== "running") {
        await loadMetrics();
      }
    } catch (syncError) {
      setSycamoreError(
        syncError instanceof Error && syncError.message.trim() ? syncError.message : "Sycamore sync failed."
      );
    } finally {
      setIsSyncingSycamore(false);
    }
  }

  function onApplyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void loadMetrics({ grade, sourceType });
  }

  const sycamoreStatus = useMemo(() => (data ? sycamoreStatusSummary(data.sycamore) : null), [data]);
  const activeEscalationBands = useMemo(
    () => data?.bandCounts.filter((band) => band.count > 0).length ?? 0,
    [data]
  );
  const interventionRows = useMemo(() => statusRows(data?.interventionCounts ?? {}), [data]);
  const notificationRows = useMemo(() => statusRows(data?.notificationCounts ?? {}), [data]);
  const parseRows = useMemo(() => statusRows(data?.parseRunStatus ?? {}), [data]);
  const trendMax = useMemo(
    () => Math.max(...(data?.recentTrend.map((row) => row.incidentCount) ?? [1]), 1),
    [data]
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Admin decision center"
        title="Discipline command center"
        description="Use current cumulative demerit totals to see which students need parent communication now, what the admin action is at each threshold, and which discipline patterns are changing across the school."
        actions={
          <Button type="button" variant="secondary" onClick={() => void loadMetrics()} disabled={isLoading}>
            <RefreshCcw className={cn("h-4 w-4", isLoading ? "animate-spin" : "")} />
            {isLoading ? "Refreshing..." : "Refresh data"}
          </Button>
        }
      />

      <div className="flex flex-wrap gap-2 rounded-[1.4rem] border border-[var(--color-line)] bg-[var(--color-soft-surface)] p-2">
        {[
          { key: "command" as const, label: "Command Center" },
          { key: "analytics" as const, label: "Deep Analytics" }
        ].map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={cn(
              "rounded-full px-4 py-2 text-sm font-semibold transition",
              activeTab === tab.key
                ? "bg-[var(--color-primary)] text-white shadow-card"
                : "text-[var(--color-muted)] hover:bg-white hover:text-[var(--color-ink)]"
            )}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "analytics" ? <DeepAnalytics embedded /> : null}

      {activeTab === "command" ? (
        <>
          <Panel className="space-y-5">
            <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--color-primary)]">
                  Live posture filters
                </p>
                <h2 className="mt-2 font-display text-2xl text-[var(--color-ink)]">Scope the command center</h2>
              </div>
              <p className="max-w-2xl text-sm leading-7 text-[var(--color-muted)]">
                This view uses stored cumulative demerit totals for the selected source mode. It is intentionally
                operational, not date-windowed, so the parent communication ladder stays accurate.
              </p>
            </div>

            <form onSubmit={onApplyFilters} className="grid gap-4 md:grid-cols-2 xl:grid-cols-[1fr_1fr_auto]">
              <Field label="Grade" hint="Leave blank for all grades.">
                <Input value={grade} onChange={(event) => setGrade(event.currentTarget.value)} placeholder="e.g. 8" />
              </Field>
              <Field label="Dataset mode">
                <Select value={sourceType} onChange={(event) => setSourceType(event.currentTarget.value)}>
                  <option value="sycamore_api">Sycamore primary</option>
                  <option value="manual_pdf">PDF exception mode</option>
                </Select>
              </Field>
              <div className="flex items-end">
                <Button type="submit" variant="primary" className="w-full xl:w-auto" disabled={isLoading}>
                  {isLoading ? "Applying..." : "Apply filters"}
                </Button>
              </div>
            </form>
          </Panel>

          {error ? (
            <InlineAlert tone="danger" title="Dashboard metrics could not be loaded.">
              {error}
            </InlineAlert>
          ) : null}

          {data?.filters.sourceType === "manual_pdf" ? (
            <InlineAlert tone="warning" title="PDF exception mode is active.">
              This command center is showing fallback import data instead of the Sycamore primary dataset.
            </InlineAlert>
          ) : null}

          {data ? (
            <>
              <section className="grid gap-5 md:grid-cols-2 xl:grid-cols-5">
                <StatCard
                  label="Students tracked"
                  value={data.metrics.studentsTracked}
                  icon={Users}
                />
                <StatCard
                  label="Incidents tracked"
                  value={data.metrics.incidentsTracked}
                  icon={Siren}
                />
                <StatCard
                  label="Total points"
                  value={data.metrics.totalPoints}
                  icon={AlertTriangle}
                />
                <StatCard
                  label="Students at 10+"
                  value={data.metrics.studentsAt10Plus}
                  icon={BellDot}
                />
                <StatCard
                  label="Students at 35+"
                  value={data.metrics.studentsAt35Plus}
                  icon={ShieldCheck}
                />
              </section>

              <section className="grid gap-5 md:grid-cols-3">
                <SoftPanel className="space-y-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-subtle)]">
                    Open interventions
                  </p>
                  <p className="font-display text-4xl text-[var(--color-ink)]">{data.metrics.openInterventions}</p>
                </SoftPanel>
                <SoftPanel className="space-y-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-subtle)]">
                    Queued notifications
                  </p>
                  <p className="font-display text-4xl text-[var(--color-ink)]">{data.metrics.queuedNotifications}</p>
                </SoftPanel>
                <SoftPanel className="space-y-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-subtle)]">
                    Failed notifications
                  </p>
                  <p className="font-display text-4xl text-[var(--color-ink)]">{data.metrics.failedNotifications}</p>
                </SoftPanel>
              </section>

              <section className="space-y-5">
                <Panel className="space-y-5">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--color-primary)]">
                        Handbook ladder
                      </p>
                      <h2 className="mt-2 font-display text-2xl text-[var(--color-ink)]">
                        Demerit thresholds that trigger parent communication
                      </h2>
                    </div>
                    <StatusBadge tone="warning">{data.metrics.studentsAt10Plus} students currently escalated</StatusBadge>
                  </div>

                  <div className="grid gap-5 xl:grid-cols-[minmax(16rem,19rem)_minmax(0,1fr)]">
                    <SoftPanel className="space-y-5 border-white/80 bg-[linear-gradient(145deg,rgba(17,94,89,0.10),rgba(255,255,255,0.97)_48%,rgba(173,124,44,0.08))]">
                      <div className="space-y-3">
                        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-subtle)]">
                          Operational view
                        </p>
                        <h3 className="font-display text-3xl text-[var(--color-ink)]">Escalation timeline</h3>
                        <p className="text-sm leading-7 text-[var(--color-muted)]">
                          This ladder stays cumulative for the selected source mode, so each threshold reflects the
                          next family communication and follow-through step the team owes right now.
                        </p>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
                        <div className="rounded-[1.2rem] border border-[var(--color-line)] bg-white/85 p-4">
                          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-subtle)]">
                            Students escalated
                          </p>
                          <p className="mt-2 font-display text-3xl text-[var(--color-ink)]">
                            {data.metrics.studentsAt10Plus}
                          </p>
                          <p className="mt-1 text-sm text-[var(--color-muted)]">Currently at 10 points or more.</p>
                        </div>
                        <div className="rounded-[1.2rem] border border-[var(--color-line)] bg-white/85 p-4">
                          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-subtle)]">
                            Bands populated
                          </p>
                          <p className="mt-2 font-display text-3xl text-[var(--color-ink)]">{activeEscalationBands}</p>
                          <p className="mt-1 text-sm text-[var(--color-muted)]">
                            Thresholds with at least one student right now.
                          </p>
                        </div>
                        <div className="rounded-[1.2rem] border border-[var(--color-line)] bg-white/85 p-4">
                          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-subtle)]">
                            Critical tier
                          </p>
                          <p className="mt-2 font-display text-3xl text-[var(--color-ink)]">
                            {data.metrics.studentsAt35Plus}
                          </p>
                          <p className="mt-1 text-sm text-[var(--color-muted)]">Students already at 35 points or above.</p>
                        </div>
                      </div>
                    </SoftPanel>

                    <div className="relative ml-3 border-l border-[var(--color-line-strong)] pl-7 md:pl-9">
                      <div className="space-y-4">
                        {data.bandCounts.map((band) => {
                          const styles = handbookBandToneStyles(band.tone);

                          return (
                            <article
                              key={band.id}
                              className={cn(
                                "relative overflow-hidden rounded-[1.6rem] border p-5 transition",
                                styles.card,
                                band.count === 0 ? "opacity-75" : "shadow-card"
                              )}
                            >
                              <span
                                className={cn(
                                  "absolute -left-[2.18rem] top-7 h-4 w-4 rounded-full border-4 border-white shadow-sm",
                                  styles.dot
                                )}
                              />
                              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                                <div className="space-y-1">
                                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-subtle)]">
                                    Threshold
                                  </p>
                                  <h3 className="font-display text-3xl text-[var(--color-ink)]">{band.shortLabel}</h3>
                                  <p className="text-sm leading-6 text-[var(--color-muted)]">{band.label}</p>
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <StatusBadge tone={band.tone}>{band.label}</StatusBadge>
                                  <span
                                    className={cn(
                                      "rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em]",
                                      styles.chip
                                    )}
                                  >
                                    {band.count} student{band.count === 1 ? "" : "s"}
                                  </span>
                                </div>
                              </div>

                              <div className="mt-5 grid gap-3 md:grid-cols-2">
                                <div className="rounded-[1.15rem] border border-white/80 bg-white/88 p-4">
                                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-subtle)]">
                                    Parent communication
                                  </p>
                                  <p className="mt-2 text-sm font-semibold leading-7 text-[var(--color-ink)]">
                                    {band.parentCommunication}
                                  </p>
                                </div>
                                <div className="rounded-[1.15rem] border border-white/80 bg-white/72 p-4">
                                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-subtle)]">
                                    Admin follow-through
                                  </p>
                                  <p className="mt-2 text-sm leading-7 text-[var(--color-ink)]">{band.adminAction}</p>
                                </div>
                              </div>
                            </article>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </Panel>

                <Panel className="space-y-5">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--color-primary)]">
                        Needs action now
                      </p>
                      <h2 className="mt-2 font-display text-2xl text-[var(--color-ink)]">Admin action queue</h2>
                    </div>
                    <div className="flex flex-wrap gap-3">
                      <Link href="/students" className={buttonStyles({ variant: "secondary" })}>
                        Open students
                      </Link>
                      <Link href="/notifications" className={buttonStyles({ variant: "ghost" })}>
                        Manage notifications
                      </Link>
                    </div>
                  </div>

                  {data.actionQueue.length === 0 ? (
                    <EmptyState
                      title="No students above the communication ladder"
                      description="This filtered operational slice currently has no students at 10 or more stored points."
                    />
                  ) : (
                    <div className={tableShellClassName}>
                      <div className="overflow-x-auto">
                        <table className={tableClassName}>
                          <thead>
                            <tr>
                              <th className={tableHeadCellClassName}>Student</th>
                              <th className={tableHeadCellClassName}>Current band</th>
                              <th className={tableHeadCellClassName}>Parent communication</th>
                              <th className={tableHeadCellClassName}>Admin action</th>
                              <th className={tableHeadCellClassName}>Follow-through</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[var(--color-line)]">
                            {data.actionQueue.map((row) => (
                              <tr key={row.studentId}>
                                <td className={tableCellClassName}>
                                  <div className="space-y-1">
                                    <p className="font-semibold text-[var(--color-ink)]">{row.fullName}</p>
                                    <p className="text-xs uppercase tracking-[0.16em] text-[var(--color-subtle)]">
                                      Grade {row.grade} • {row.totalPoints} pts
                                    </p>
                                    <p className="text-sm text-[var(--color-muted)]">
                                      {row.latestIncidentAt
                                        ? `Latest incident ${new Date(row.latestIncidentAt).toLocaleDateString()}`
                                        : "No recent incident date"}
                                    </p>
                                  </div>
                                </td>
                                <td className={tableCellClassName}>
                                  <div className="space-y-2">
                                    <StatusBadge tone={row.currentBandTone}>{row.currentBandLabel}</StatusBadge>
                                    <p className="text-sm leading-7 text-[var(--color-muted)]">{row.policyImpact}</p>
                                  </div>
                                </td>
                                <td className={tableCellClassName}>
                                  <p className="text-sm leading-7 text-[var(--color-ink)]">{row.parentCommunication}</p>
                                </td>
                                <td className={tableCellClassName}>
                                  <div className="space-y-2">
                                    <p className="text-sm font-semibold text-[var(--color-ink)]">{row.adminAction}</p>
                                    <p className="text-sm leading-7 text-[var(--color-muted)]">{row.adminMessage}</p>
                                  </div>
                                </td>
                                <td className={tableCellClassName}>
                                  <div className="space-y-1 text-sm text-[var(--color-muted)]">
                                    <p>{row.activeInterventions} active interventions</p>
                                    <p>{row.queuedNotifications} queued notifications</p>
                                    <p>{row.failedNotifications} failed notifications</p>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </Panel>
              </section>

              <section className="grid gap-5 xl:grid-cols-[1fr_1fr]">
                <Panel className="space-y-5">
                  <div className="flex items-end justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--color-primary)]">
                        Grade pressure
                      </p>
                      <h2 className="mt-2 font-display text-2xl text-[var(--color-ink)]">Where the burden is highest</h2>
                    </div>
                    <StatusBadge tone="info">{data.gradePressure.length} grades</StatusBadge>
                  </div>

                  {data.gradePressure.length === 0 ? (
                    <EmptyState
                      title="No grade pressure yet"
                      description="No stored discipline totals were returned for the selected operational slice."
                    />
                  ) : (
                    <div className={tableShellClassName}>
                      <div className="overflow-x-auto">
                        <table className={tableClassName}>
                          <thead>
                            <tr>
                              <th className={tableHeadCellClassName}>Grade</th>
                              <th className={tableHeadCellClassName}>Students</th>
                              <th className={tableHeadCellClassName}>Incidents</th>
                              <th className={tableHeadCellClassName}>Points</th>
                              <th className={tableHeadCellClassName}>10+ students</th>
                              <th className={tableHeadCellClassName}>35+ students</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[var(--color-line)]">
                            {data.gradePressure.map((row) => (
                              <tr key={row.grade}>
                                <td className={tableCellClassName}>Grade {row.grade}</td>
                                <td className={tableCellClassName}>{row.studentCount}</td>
                                <td className={tableCellClassName}>{row.incidentCount}</td>
                                <td className={tableCellClassName}>{row.totalPoints}</td>
                                <td className={tableCellClassName}>{row.escalatedCount}</td>
                                <td className={tableCellClassName}>{row.criticalCount}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </Panel>

                <Panel className="space-y-5">
                  <div className="flex items-end justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--color-primary)]">
                        Behavior hotspots
                      </p>
                      <h2 className="mt-2 font-display text-2xl text-[var(--color-ink)]">Most common stored violations</h2>
                    </div>
                    <StatusBadge tone="info">{data.violationHotspots.length} rows</StatusBadge>
                  </div>

                  {data.violationHotspots.length === 0 ? (
                    <EmptyState
                      title="No violation hotspots"
                      description="Stored violations will appear once the selected source mode contains incident history."
                    />
                  ) : (
                    <div className="space-y-3">
                      {data.violationHotspots.map((row) => (
                        <SoftPanel key={row.label} className="space-y-2">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="font-semibold text-[var(--color-ink)]">{row.label}</p>
                              <p className="text-sm text-[var(--color-muted)]">{row.incidentCount} incidents</p>
                            </div>
                            <StatusBadge tone="warning">{row.totalPoints} pts</StatusBadge>
                          </div>
                        </SoftPanel>
                      ))}
                    </div>
                  )}
                </Panel>
              </section>

              <section className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
                <Panel className="space-y-5">
                  <div className="flex items-end justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--color-primary)]">
                        Recent momentum
                      </p>
                      <h2 className="mt-2 font-display text-2xl text-[var(--color-ink)]">Stored incident trend</h2>
                    </div>
                    <StatusBadge tone="info">{data.recentTrend.length} weeks</StatusBadge>
                  </div>

                  {data.recentTrend.length === 0 ? (
                    <EmptyState
                      title="No trend data"
                      description="Stored incidents are needed before the weekly trend can be graphed."
                    />
                  ) : (
                    <div className="space-y-3">
                      {data.recentTrend.map((row) => (
                        <div key={row.period} className="space-y-2">
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-sm font-semibold text-[var(--color-ink)]">{row.period}</p>
                            <p className="text-sm text-[var(--color-muted)]">
                              {row.incidentCount} incidents • {row.totalPoints} pts
                            </p>
                          </div>
                          <div className="h-2 rounded-full bg-[var(--color-soft-surface)]">
                            <div
                              className="h-2 rounded-full bg-[linear-gradient(90deg,var(--color-primary),rgba(17,94,89,0.45))]"
                              style={{
                                width: `${Math.max((row.incidentCount / trendMax) * 100, row.incidentCount > 0 ? 8 : 0)}%`
                              }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </Panel>

                <Panel className="space-y-6">
                  <div className="flex items-end justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--color-primary)]">
                        Workflow pulse
                      </p>
                      <h2 className="mt-2 font-display text-2xl text-[var(--color-ink)]">Operational posture</h2>
                    </div>
                    <StatusBadge tone="info">Live counts</StatusBadge>
                  </div>

                  {[
                    { title: "Parse runs", rows: parseRows },
                    { title: "Interventions", rows: interventionRows },
                    { title: "Notifications", rows: notificationRows }
                  ].map((group) => (
                    <div key={group.title} className="space-y-3">
                      <p className="font-semibold text-[var(--color-ink)]">{group.title}</p>
                      {group.rows.length === 0 ? (
                        <p className="text-sm text-[var(--color-muted)]">No current counts available.</p>
                      ) : (
                        group.rows.map((row) => (
                          <div key={`${group.title}-${row.key}`} className="flex items-center justify-between gap-3">
                            <StatusBadge tone={badgeToneForKey(row.key)}>{row.label}</StatusBadge>
                            <span className="text-sm font-semibold text-[var(--color-ink)]">{row.count}</span>
                          </div>
                        ))
                      )}
                    </div>
                  ))}
                </Panel>
              </section>

              <Panel className="space-y-5 overflow-hidden border-white/80 bg-[linear-gradient(135deg,rgba(17,94,89,0.10),rgba(255,255,255,0.98)_44%,rgba(173,124,44,0.08))]">
                <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
                  <div className="max-w-3xl space-y-4">
                    <div className="flex flex-wrap items-center gap-3">
                      {sycamoreStatus ? <StatusBadge tone={sycamoreStatus.tone}>{sycamoreStatus.label}</StatusBadge> : null}
                      <StatusBadge tone={data.sycamore.configured ? "success" : "warning"}>
                        {data.sycamore.configured ? "Primary source configured" : "Configuration required"}
                      </StatusBadge>
                    </div>

                    <div className="space-y-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--color-primary)]">
                        Source freshness
                      </p>
                      <h2 className="font-display text-3xl text-[var(--color-ink)] sm:text-[2.6rem]">
                        Trust the data before acting on it
                      </h2>
                      <p className="max-w-2xl text-sm leading-7 text-[var(--color-muted)]">
                        {sycamoreStatus?.description}
                      </p>
                    </div>

                    <div className="flex flex-wrap gap-3">
                      {canManageSycamore ? (
                        <Button
                          type="button"
                          variant="primary"
                          onClick={() => void onRunSycamoreSync()}
                          disabled={isSyncingSycamore || !data.sycamore.configured}
                        >
                          <RefreshCcw className={cn("h-4 w-4", isSyncingSycamore ? "animate-spin" : "")} />
                          {isSyncingSycamore ? "Syncing Sycamore..." : "Sync from Sycamore"}
                        </Button>
                      ) : null}
                      <Link href="/ingestion" className={buttonStyles({ variant: "ghost" })}>
                        Monitor sync jobs
                      </Link>
                      <Link href="/reports/reconciliation" className={buttonStyles({ variant: "secondary" })}>
                        Open reconciliation
                      </Link>
                    </div>

                    {sycamoreError ? (
                      <InlineAlert tone="danger" title="Sycamore sync failed.">
                        {sycamoreError}
                      </InlineAlert>
                    ) : null}

                    {sycamoreNotice ? (
                      <InlineAlert tone={sycamoreNoticeTone} title={sycamoreNoticeTitle}>
                        {sycamoreNotice}
                      </InlineAlert>
                    ) : null}

                    {data.sycamore.error ? (
                      <InlineAlert tone="warning" title="Sycamore summary is unavailable.">
                        {data.sycamore.error}
                      </InlineAlert>
                    ) : null}
                  </div>

                  <div className="grid gap-4 md:grid-cols-3 xl:w-[21rem] xl:grid-cols-1">
                    <SoftPanel className="space-y-3 border-white/70 bg-white/80">
                      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-subtle)]">
                        Mirrored rows
                      </p>
                      <p className="font-display text-4xl text-[var(--color-ink)]">{data.sycamore.totalLogs}</p>
                      <p className="text-sm leading-7 text-[var(--color-muted)]">
                        Read-only Sycamore rows currently stored for command-center decision making.
                      </p>
                    </SoftPanel>
                    <SoftPanel className="space-y-3 border-white/70 bg-white/80">
                      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-subtle)]">
                        Latest run
                      </p>
                      <p className="font-display text-4xl text-[var(--color-ink)]">
                        {data.sycamore.lastSync?.recordsUpserted ?? 0}
                      </p>
                      <p className="text-sm leading-7 text-[var(--color-muted)]">
                        {data.sycamore.lastSync
                          ? `${syncModeLabel(data.sycamore.lastSync.syncMode)} sync ${data.sycamore.lastSync.status}.`
                          : "No Sycamore sync has run yet."}
                      </p>
                    </SoftPanel>
                    <SoftPanel className="space-y-3 border-white/70 bg-white/80">
                      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-subtle)]">
                        Linked rows
                      </p>
                      <p className="font-display text-4xl text-[var(--color-ink)]">{data.sycamore.linkedLogs}</p>
                      <p className="text-sm leading-7 text-[var(--color-muted)]">
                        Mirrored rows matched to local students through <code>external_id</code>.
                      </p>
                    </SoftPanel>
                  </div>
                </div>
              </Panel>
            </>
          ) : isLoading ? (
            <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
              {Array.from({ length: 4 }).map((_, index) => (
                <div
                  key={index}
                  className="h-48 animate-pulse rounded-[1.75rem] border border-white/80 bg-white/80 shadow-card"
                />
              ))}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
