"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  BellDot,
  ChevronRight,
  RefreshCcw,
  ShieldCheck,
  Siren,
  Sparkles,
  Users
} from "lucide-react";

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
    parentOutreachDraftsPending: number;
    approvedParentOutreach: number;
    studentsMissingParentEmailAt10To19: number;
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

type ActionQueueRow = DashboardPayload["actionQueue"][number];

interface ActionQueueGradeGroup {
  grade: string;
  rows: ActionQueueRow[];
  studentCount: number;
  totalPoints: number;
  queuedNotifications: number;
  activeInterventions: number;
  criticalCount: number;
  highestBandLabel: string;
  highestBandTone: ActionQueueRow["currentBandTone"];
  latestIncidentAt: string | null;
}

function compareGradesAscending(left: string, right: string) {
  const leftGrade = Number(left);
  const rightGrade = Number(right);

  if (Number.isFinite(leftGrade) && Number.isFinite(rightGrade)) {
    return leftGrade - rightGrade;
  }

  return left.localeCompare(right, undefined, { numeric: true });
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

function incidentEpoch(value: string | null) {
  const epoch = Date.parse(value ?? "");
  return Number.isFinite(epoch) ? epoch : Number.NEGATIVE_INFINITY;
}

function sortActionQueueRows(left: ActionQueueRow, right: ActionQueueRow) {
  if (right.totalPoints !== left.totalPoints) {
    return right.totalPoints - left.totalPoints;
  }

  const rightIncidentEpoch = incidentEpoch(right.latestIncidentAt);
  const leftIncidentEpoch = incidentEpoch(left.latestIncidentAt);
  if (rightIncidentEpoch !== leftIncidentEpoch) {
    return rightIncidentEpoch - leftIncidentEpoch;
  }

  return left.fullName.localeCompare(right.fullName);
}

function buildActionQueueGroups(rows: ActionQueueRow[]): ActionQueueGradeGroup[] {
  const groups = new Map<string, ActionQueueGradeGroup>();

  for (const row of rows) {
    const currentGroup = groups.get(row.grade);
    if (currentGroup) {
      currentGroup.rows.push(row);
      currentGroup.studentCount += 1;
      currentGroup.totalPoints += row.totalPoints;
      currentGroup.queuedNotifications += row.queuedNotifications;
      currentGroup.activeInterventions += row.activeInterventions;
      currentGroup.criticalCount += row.currentBandTone === "danger" ? 1 : 0;
      if (incidentEpoch(row.latestIncidentAt) > incidentEpoch(currentGroup.latestIncidentAt)) {
        currentGroup.latestIncidentAt = row.latestIncidentAt;
      }
      continue;
    }

    groups.set(row.grade, {
      grade: row.grade,
      rows: [row],
      studentCount: 1,
      totalPoints: row.totalPoints,
      queuedNotifications: row.queuedNotifications,
      activeInterventions: row.activeInterventions,
      criticalCount: row.currentBandTone === "danger" ? 1 : 0,
      highestBandLabel: row.currentBandLabel,
      highestBandTone: row.currentBandTone,
      latestIncidentAt: row.latestIncidentAt
    });
  }

  return [...groups.values()]
    .map((group) => {
      const sortedRows = [...group.rows].sort(sortActionQueueRows);
      return {
        ...group,
        rows: sortedRows,
        highestBandLabel: sortedRows[0]?.currentBandLabel ?? group.highestBandLabel,
        highestBandTone: sortedRows[0]?.currentBandTone ?? group.highestBandTone
      };
    })
    .sort(
      (left, right) =>
        right.criticalCount - left.criticalCount ||
        right.studentCount - left.studentCount ||
        right.totalPoints - left.totalPoints ||
        compareGradesAscending(left.grade, right.grade)
    );
}

function hotspotTone(totalPoints: number): "neutral" | "info" | "success" | "warning" | "danger" {
  if (totalPoints >= 100) {
    return "danger";
  }
  if (totalPoints > 0) {
    return "warning";
  }
  if (totalPoints < 0) {
    return "success";
  }
  return "neutral";
}

function hotspotCloudSizeClass(incidentCount: number, maxIncidentCount: number) {
  const ratio = incidentCount / Math.max(maxIncidentCount, 1);

  if (ratio >= 0.82) {
    return "min-h-[6rem] max-w-[20rem] px-5 py-4";
  }
  if (ratio >= 0.58) {
    return "min-h-[5.35rem] max-w-[17rem] px-4 py-3.5";
  }
  if (ratio >= 0.36) {
    return "min-h-[4.75rem] max-w-[15rem] px-4 py-3";
  }
  return "min-h-[4.15rem] max-w-[13rem] px-3.5 py-2.5";
}

export function DashboardClient({ canManageSycamore }: { canManageSycamore: boolean }) {
  const [grade, setGrade] = useState("");
  const [sourceType, setSourceType] = useState(DEFAULT_SOURCE_TYPE);
  const [expandedQueueGrade, setExpandedQueueGrade] = useState<string | null>(null);
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

  const sortedGradePressure = useMemo(
    () =>
      data
        ? [...data.gradePressure].sort((left, right) => compareGradesAscending(left.grade, right.grade))
        : [],
    [data]
  );

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
  const actionQueueGroups = useMemo(() => buildActionQueueGroups(data?.actionQueue ?? []), [data]);
  const selectedActionQueueGroup = useMemo(
    () => actionQueueGroups.find((group) => group.grade === expandedQueueGrade) ?? actionQueueGroups[0] ?? null,
    [actionQueueGroups, expandedQueueGrade]
  );
  const interventionRows = useMemo(() => statusRows(data?.interventionCounts ?? {}), [data]);
  const notificationRows = useMemo(() => statusRows(data?.notificationCounts ?? {}), [data]);
  const parseRows = useMemo(() => statusRows(data?.parseRunStatus ?? {}), [data]);
  const trendMax = useMemo(
    () => Math.max(...(data?.recentTrend.map((row) => row.incidentCount) ?? [1]), 1),
    [data]
  );
  const hotspotCloudRows = useMemo(() => (data?.violationHotspots ?? []).slice(0, 10), [data]);
  const hotspotRankedRows = useMemo(() => (data?.violationHotspots ?? []).slice(0, 5), [data]);
  const hotspotMax = useMemo(
    () => Math.max(...hotspotCloudRows.map((row) => row.incidentCount), 1),
    [hotspotCloudRows]
  );

  useEffect(() => {
    if (!actionQueueGroups.length) {
      setExpandedQueueGrade(null);
      return;
    }

    setExpandedQueueGrade((current) =>
      current && actionQueueGroups.some((group) => group.grade === current) ? current : actionQueueGroups[0]?.grade ?? null
    );
  }, [actionQueueGroups]);

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

      <Panel className="space-y-5">
            <form onSubmit={onApplyFilters} className="grid gap-4 md:grid-cols-[1fr_auto] xl:grid-cols-[1fr_auto]">
              <Field label="Grade" hint="Leave blank for all grades.">
                <Input value={grade} onChange={(event) => setGrade(event.currentTarget.value)} placeholder="e.g. 8" />
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

              <section className="grid gap-5 md:grid-cols-2 xl:grid-cols-5">
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
                <SoftPanel className="space-y-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-subtle)]">
                    Parent drafts pending
                  </p>
                  <p className="font-display text-4xl text-[var(--color-ink)]">{data.metrics.parentOutreachDraftsPending}</p>
                </SoftPanel>
                <SoftPanel className="space-y-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-subtle)]">
                    Approved parent emails
                  </p>
                  <p className="font-display text-4xl text-[var(--color-ink)]">{data.metrics.approvedParentOutreach}</p>
                </SoftPanel>
              </section>

              {data.metrics.studentsMissingParentEmailAt10To19 > 0 ? (
                <InlineAlert tone="warning" title="Parent contact coverage is incomplete.">
                  {data.metrics.studentsMissingParentEmailAt10To19} student
                  {data.metrics.studentsMissingParentEmailAt10To19 === 1 ? "" : "s"} in the 10-19 band do not currently
                  have an email-enabled guardian contact on file.
                </InlineAlert>
              ) : null}

              <section className="space-y-5">
                <Panel className="space-y-5">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="space-y-1">
                      <h2 className="font-display text-2xl text-[var(--color-ink)]">Communication ladder</h2>
                      <p className="text-sm leading-6 text-[var(--color-muted)]">
                        Cumulative thresholds for the selected source mode.
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <StatusBadge tone="warning">{data.metrics.studentsAt10Plus} at 10+</StatusBadge>
                      <StatusBadge tone="info">{activeEscalationBands} active bands</StatusBadge>
                      <StatusBadge tone="danger">{data.metrics.studentsAt35Plus} at 35+</StatusBadge>
                    </div>
                  </div>

                  <div className="grid gap-3">
                    {data.bandCounts.map((band) => {
                      const styles = handbookBandToneStyles(band.tone);

                      return (
                        <article
                          key={band.id}
                          className={cn(
                            "rounded-[1.25rem] border px-4 py-4",
                            styles.card,
                            band.count === 0 ? "opacity-75" : ""
                          )}
                        >
                          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                            <div className="space-y-1">
                              <div className="flex items-center gap-2">
                                <span className={cn("h-2.5 w-2.5 rounded-full", styles.dot)} />
                                <p className="font-semibold text-[var(--color-ink)]">{band.label}</p>
                              </div>
                              <p className="text-sm text-[var(--color-muted)]">
                                {band.count} student{band.count === 1 ? "" : "s"}
                              </p>
                            </div>
                            <StatusBadge tone={band.tone}>{band.shortLabel}</StatusBadge>
                          </div>

                          <div className="mt-3 grid gap-2 text-sm leading-6 text-[var(--color-muted)] lg:grid-cols-2">
                            <p>
                              <span className="font-semibold text-[var(--color-ink)]">Parent:</span>{" "}
                              {band.parentCommunication}
                            </p>
                            <p>
                              <span className="font-semibold text-[var(--color-ink)]">Admin:</span> {band.adminAction}
                            </p>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </Panel>

                <Panel className="space-y-5">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--color-primary)]">
                        Needs action now
                      </p>
                      <h2 className="mt-2 font-display text-2xl text-[var(--color-ink)]">Admin action queue</h2>
                      <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--color-muted)]">
                        Grouped by grade so the dashboard stays short. Expand one grade here, then jump to Students for the full case list.
                      </p>
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
                    <div className="grid gap-4 xl:grid-cols-[minmax(18rem,22rem)_minmax(0,1fr)]">
                      <div className="grid gap-3">
                        {actionQueueGroups.map((group) => (
                          <button
                            key={group.grade}
                            type="button"
                            onClick={() => setExpandedQueueGrade(group.grade)}
                            className={cn(
                              "rounded-[1.35rem] border p-4 text-left transition",
                              selectedActionQueueGroup?.grade === group.grade
                                ? "border-[var(--color-primary)] bg-[var(--color-primary-soft)] shadow-card"
                                : "border-[var(--color-line)] bg-[var(--color-soft-surface)] hover:border-[var(--color-primary)] hover:bg-white"
                            )}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="space-y-1">
                                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-subtle)]">
                                  Grade {group.grade}
                                </p>
                                <p className="font-display text-3xl text-[var(--color-ink)]">{group.studentCount}</p>
                                <p className="text-sm text-[var(--color-muted)]">
                                  student{group.studentCount === 1 ? "" : "s"} currently above the ladder
                                </p>
                              </div>
                              <div className="flex items-center gap-2">
                                <StatusBadge tone={group.highestBandTone}>{group.highestBandLabel}</StatusBadge>
                                <ChevronRight
                                  className={cn(
                                    "h-4 w-4 text-[var(--color-subtle)] transition",
                                    selectedActionQueueGroup?.grade === group.grade ? "translate-x-1 text-[var(--color-primary)]" : ""
                                  )}
                                />
                              </div>
                            </div>

                            <div className="mt-4 flex flex-wrap gap-2">
                              <StatusBadge tone="neutral">{group.totalPoints} pts</StatusBadge>
                              <StatusBadge tone="warning">{group.queuedNotifications} queued</StatusBadge>
                              <StatusBadge tone="info">{group.activeInterventions} interventions</StatusBadge>
                              {group.criticalCount > 0 ? (
                                <StatusBadge tone="danger">{group.criticalCount} at 35+</StatusBadge>
                              ) : null}
                            </div>
                          </button>
                        ))}
                      </div>

                      {selectedActionQueueGroup ? (
                        <SoftPanel className="space-y-5 border-white/80 bg-[linear-gradient(140deg,rgba(17,94,89,0.08),rgba(255,255,255,0.96)_42%,rgba(173,124,44,0.08))]">
                          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                            <div className="space-y-1">
                              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-primary)]">
                                Expanded queue
                              </p>
                              <h3 className="font-display text-3xl text-[var(--color-ink)]">
                                Grade {selectedActionQueueGroup.grade}
                              </h3>
                              <p className="max-w-2xl text-sm leading-6 text-[var(--color-muted)]">
                                Previewing the highest-pressure students in this grade. Use Students for the full filtered roster and case-file view.
                              </p>
                            </div>
                            <Link
                              href={{
                                pathname: "/students",
                                query: {
                                  grade: selectedActionQueueGroup.grade,
                                  sourceType: data.filters.sourceType,
                                  mode: "risk"
                                }
                              }}
                              className={buttonStyles({ variant: "secondary" })}
                            >
                              Open grade in Students
                              <ArrowUpRight className="h-4 w-4" />
                            </Link>
                          </div>

                          <div className="grid gap-3 md:grid-cols-2">
                            {selectedActionQueueGroup.rows.slice(0, 4).map((row) => (
                              <article key={row.studentId} className="rounded-[1.2rem] border border-white/90 bg-white/90 p-4 shadow-card">
                                <div className="flex items-start justify-between gap-3">
                                  <div className="space-y-1">
                                    <p className="font-semibold text-[var(--color-ink)]">{row.fullName}</p>
                                    <p className="text-xs uppercase tracking-[0.16em] text-[var(--color-subtle)]">
                                      {row.totalPoints} pts • {row.latestIncidentAt
                                        ? new Date(row.latestIncidentAt).toLocaleDateString()
                                        : "No recent incident"}
                                    </p>
                                  </div>
                                  <StatusBadge tone={row.currentBandTone}>{row.currentBandLabel}</StatusBadge>
                                </div>

                                <div className="mt-4 space-y-3 text-sm leading-6">
                                  <div>
                                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-subtle)]">
                                      Parent
                                    </p>
                                    <p className="mt-1 text-[var(--color-ink)]">{row.parentCommunication}</p>
                                  </div>
                                  <div>
                                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-subtle)]">
                                      Admin
                                    </p>
                                    <p className="mt-1 font-semibold text-[var(--color-ink)]">{row.adminAction}</p>
                                    <p className="mt-1 text-[var(--color-muted)]">{row.adminMessage}</p>
                                  </div>
                                </div>

                                <div className="mt-4 flex flex-wrap gap-2">
                                  <StatusBadge tone="info">{row.activeInterventions} interventions</StatusBadge>
                                  <StatusBadge tone="warning">{row.queuedNotifications} queued</StatusBadge>
                                  {row.failedNotifications > 0 ? (
                                    <StatusBadge tone="danger">{row.failedNotifications} failed</StatusBadge>
                                  ) : null}
                                </div>
                              </article>
                            ))}
                          </div>

                          {selectedActionQueueGroup.rows.length > 4 ? (
                            <InlineAlert tone="info" title={`${selectedActionQueueGroup.rows.length - 4} more students are hidden in this preview.`}>
                              Open Grade {selectedActionQueueGroup.grade} in Students to review the full queue and drill into case files.
                            </InlineAlert>
                          ) : null}
                        </SoftPanel>
                      ) : (
                        <EmptyState
                          title="Select a grade"
                          description="Choose a grade from the left to preview the students who currently need communication or admin follow-through."
                        />
                      )}
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
                      <h2 className="mt-2 font-display text-2xl text-[var(--color-ink)]">Pressure by grade</h2>
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
                            {sortedGradePressure.map((row) => (
                              <tr key={row.grade}>
                                <td className={cn(tableCellClassName, "whitespace-nowrap")}>Grade {row.grade}</td>
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
                    <div className="flex flex-wrap gap-2">
                      <StatusBadge tone="info">{data.violationHotspots.length} rows</StatusBadge>
                      <Link href="/reports" className={buttonStyles({ variant: "ghost", size: "sm" })}>
                        Open analytics
                      </Link>
                    </div>
                  </div>

                  {data.violationHotspots.length === 0 ? (
                    <EmptyState
                      title="No violation hotspots"
                      description="Stored violations will appear once the selected source mode contains incident history."
                    />
                  ) : (
                    <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
                      <div className="dashboard-cloud-field">
                        <span className="dashboard-cloud-orb dashboard-cloud-orb-a" />
                        <span className="dashboard-cloud-orb dashboard-cloud-orb-b" />
                        <span className="dashboard-cloud-orb dashboard-cloud-orb-c" />

                        <div className="relative z-[1] space-y-4">
                          <div className="flex items-center gap-2 text-[var(--color-primary)]">
                            <Sparkles className="h-4 w-4" />
                            <p className="text-xs font-semibold uppercase tracking-[0.22em]">Concept cloud</p>
                          </div>
                          <div className="flex flex-wrap items-center gap-3">
                            {hotspotCloudRows.map((row, index) => (
                              <div
                                key={row.label}
                                className={cn(
                                  "dashboard-cloud-pill rounded-[1.3rem] border bg-white/85 shadow-[0_12px_30px_rgba(17,94,89,0.08)] backdrop-blur",
                                  hotspotCloudSizeClass(row.incidentCount, hotspotMax)
                                )}
                                style={{
                                  animationDelay: `${index * 0.45}s`,
                                  animationDuration: `${6.8 + (index % 4) * 0.9}s`
                                }}
                              >
                                <p className="text-balance font-semibold leading-6 text-[var(--color-ink)]">{row.label}</p>
                                <div className="mt-3 flex flex-wrap items-center gap-2">
                                  <StatusBadge tone="neutral">{row.incidentCount} incidents</StatusBadge>
                                  <StatusBadge tone={hotspotTone(row.totalPoints)}>{row.totalPoints} pts</StatusBadge>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>

                      <div className="space-y-3">
                        {hotspotRankedRows.map((row, index) => (
                          <SoftPanel key={row.label} className="space-y-3 border-white/80 bg-white/85">
                            <div className="flex items-start justify-between gap-3">
                              <div className="space-y-1">
                                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-subtle)]">
                                  #{index + 1} hotspot
                                </p>
                                <p className="font-semibold leading-6 text-[var(--color-ink)]">{row.label}</p>
                              </div>
                              <StatusBadge tone={hotspotTone(row.totalPoints)}>{row.totalPoints} pts</StatusBadge>
                            </div>
                            <div className="space-y-2">
                              <div className="flex items-center justify-between gap-3 text-sm text-[var(--color-muted)]">
                                <p>{row.incidentCount} incidents</p>
                                <p>{row.totalPoints} net pts</p>
                              </div>
                              <div className="h-2 rounded-full bg-[var(--color-soft-surface)]">
                                <div
                                  className="h-2 rounded-full bg-[linear-gradient(90deg,var(--color-primary),rgba(173,124,44,0.55))]"
                                  style={{
                                    width: `${Math.max((row.incidentCount / hotspotMax) * 100, row.incidentCount > 0 ? 12 : 0)}%`
                                  }}
                                />
                              </div>
                            </div>
                          </SoftPanel>
                        ))}
                      </div>
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

              <Panel className="space-y-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="space-y-2">
                    <div className="flex flex-wrap gap-2">
                      {sycamoreStatus ? <StatusBadge tone={sycamoreStatus.tone}>{sycamoreStatus.label}</StatusBadge> : null}
                      <StatusBadge tone={data.sycamore.configured ? "success" : "warning"}>
                        {data.sycamore.configured ? "Configured" : "Configuration required"}
                      </StatusBadge>
                    </div>
                    <div className="space-y-1">
                      <h2 className="font-display text-2xl text-[var(--color-ink)]">Source freshness</h2>
                      <p className="max-w-2xl text-sm leading-6 text-[var(--color-muted)]">
                        {sycamoreStatus?.description}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {canManageSycamore ? (
                      <Button
                        type="button"
                        variant="primary"
                        onClick={() => void onRunSycamoreSync()}
                        disabled={isSyncingSycamore || !data.sycamore.configured}
                      >
                        <RefreshCcw className={cn("h-4 w-4", isSyncingSycamore ? "animate-spin" : "")} />
                        {isSyncingSycamore ? "Syncing..." : "Sync"}
                      </Button>
                    ) : null}
                    <Link href="/ingestion" className={buttonStyles({ variant: "ghost" })}>
                      Jobs
                    </Link>
                    <Link href="/reports/reconciliation" className={buttonStyles({ variant: "secondary" })}>
                      Reconcile
                    </Link>
                  </div>
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

                <div className="grid gap-3 md:grid-cols-3">
                  <SoftPanel className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-subtle)]">
                      Mirrored rows
                    </p>
                    <p className="font-display text-3xl text-[var(--color-ink)]">{data.sycamore.totalLogs}</p>
                  </SoftPanel>
                  <SoftPanel className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-subtle)]">
                      Latest run
                    </p>
                    <p className="font-display text-3xl text-[var(--color-ink)]">
                      {data.sycamore.lastSync?.recordsUpserted ?? 0}
                    </p>
                    <p className="text-sm text-[var(--color-muted)]">
                      {data.sycamore.lastSync
                        ? `${syncModeLabel(data.sycamore.lastSync.syncMode)} ${data.sycamore.lastSync.status}`
                        : "No sync yet"}
                    </p>
                  </SoftPanel>
                  <SoftPanel className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-subtle)]">
                      Linked rows
                    </p>
                    <p className="font-display text-3xl text-[var(--color-ink)]">{data.sycamore.linkedLogs}</p>
                  </SoftPanel>
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
    </div>
  );
}
