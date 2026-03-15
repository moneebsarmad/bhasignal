"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  BellDot,
  RefreshCcw,
  ShieldCheck,
  Siren,
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

interface ActionQueueGradeGroup {
  grade: string;
  studentCount: number;
  totalPoints: number;
  queuedNotifications: number;
  activeInterventions: number;
  criticalCount: number;
  highestBandLabel: DashboardPayload["actionQueue"][number]["currentBandLabel"];
  highestBandTone: DashboardPayload["actionQueue"][number]["currentBandTone"];
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

const DEFAULT_SOURCE_TYPE = "sycamore_api";

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

function incidentEpoch(value: string | null) {
  const epoch = Date.parse(value ?? "");
  return Number.isFinite(epoch) ? epoch : Number.NEGATIVE_INFINITY;
}

function bandToneRank(tone: DashboardPayload["actionQueue"][number]["currentBandTone"]) {
  switch (tone) {
    case "danger":
      return 4;
    case "warning":
      return 3;
    case "info":
      return 2;
    case "success":
      return 1;
    default:
      return 0;
  }
}

function buildActionQueueGroups(rows: DashboardPayload["actionQueue"]): ActionQueueGradeGroup[] {
  const groups = new Map<string, ActionQueueGradeGroup>();

  for (const row of rows) {
    const currentGroup = groups.get(row.grade);
    if (currentGroup) {
      currentGroup.studentCount += 1;
      currentGroup.totalPoints += row.totalPoints;
      currentGroup.queuedNotifications += row.queuedNotifications;
      currentGroup.activeInterventions += row.activeInterventions;
      currentGroup.criticalCount += row.currentBandTone === "danger" ? 1 : 0;
      if (bandToneRank(row.currentBandTone) > bandToneRank(currentGroup.highestBandTone)) {
        currentGroup.highestBandLabel = row.currentBandLabel;
        currentGroup.highestBandTone = row.currentBandTone;
      }
      if (incidentEpoch(row.latestIncidentAt) > incidentEpoch(currentGroup.latestIncidentAt)) {
        currentGroup.latestIncidentAt = row.latestIncidentAt;
      }
      continue;
    }

    groups.set(row.grade, {
      grade: row.grade,
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
    .sort(
      (left, right) =>
        right.criticalCount - left.criticalCount ||
        right.studentCount - left.studentCount ||
        right.totalPoints - left.totalPoints ||
        compareGradesAscending(left.grade, right.grade)
    );
}

export function DashboardClient({ canManageSycamore: _canManageSycamore }: { canManageSycamore: boolean }) {
  const [grade, setGrade] = useState("");
  const [sourceType, setSourceType] = useState(DEFAULT_SOURCE_TYPE);
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
  const topPressureGrade = useMemo(
    () =>
      data
        ? [...data.gradePressure].sort(
            (left, right) =>
              right.criticalCount - left.criticalCount ||
              right.escalatedCount - left.escalatedCount ||
              right.totalPoints - left.totalPoints ||
              compareGradesAscending(left.grade, right.grade)
          )[0] ?? null
        : null,
    [data]
  );
  const topHotspot = useMemo(() => data?.violationHotspots[0] ?? null, [data]);
  const recentTrendSummary = useMemo(() => {
    const rows = data?.recentTrend ?? [];
    if (!rows.length) {
      return null;
    }
    const latest = rows[rows.length - 1] ?? null;
    if (!latest) {
      return null;
    }
    const previous = rows.length > 1 ? rows[rows.length - 2] ?? null : null;
    const delta = previous ? latest.incidentCount - previous.incidentCount : null;
    return { latest, delta };
  }, [data]);

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
                      <h2 className="mt-2 font-display text-2xl text-[var(--color-ink)]">Action queue snapshot</h2>
                      <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--color-muted)]">
                        Counts only. Use Students for triage and case files, and Notifications for outreach review and dispatch.
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
                    <>
                      <div className="grid gap-4 md:grid-cols-4">
                        <SoftPanel className="space-y-2">
                          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-subtle)]">
                            Students above ladder
                          </p>
                          <p className="font-display text-3xl text-[var(--color-ink)]">{data.actionQueue.length}</p>
                          <p className="text-sm text-[var(--color-muted)]">Students currently requiring communication or admin follow-through.</p>
                        </SoftPanel>
                        <SoftPanel className="space-y-2">
                          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-subtle)]">
                            Grades represented
                          </p>
                          <p className="font-display text-3xl text-[var(--color-ink)]">{actionQueueGroups.length}</p>
                          <p className="text-sm text-[var(--color-muted)]">How many grades currently have students above the ladder.</p>
                        </SoftPanel>
                        <SoftPanel className="space-y-2">
                          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-subtle)]">
                            Parent drafts pending
                          </p>
                          <p className="font-display text-3xl text-[var(--color-ink)]">{data.metrics.parentOutreachDraftsPending}</p>
                          <p className="text-sm text-[var(--color-muted)]">Draft parent emails waiting in the notifications workflow.</p>
                        </SoftPanel>
                        <SoftPanel className="space-y-2">
                          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-subtle)]">
                            Students at 35+
                          </p>
                          <p className="font-display text-3xl text-[var(--color-ink)]">{data.metrics.studentsAt35Plus}</p>
                          <p className="text-sm text-[var(--color-muted)]">Critical cases that need the fastest admin attention.</p>
                        </SoftPanel>
                      </div>

                      <div className={tableShellClassName}>
                        <div className="overflow-x-auto">
                          <table className={tableClassName}>
                            <thead>
                              <tr>
                                <th className={tableHeadCellClassName}>Grade</th>
                                <th className={tableHeadCellClassName}>Students</th>
                                <th className={tableHeadCellClassName}>Highest band</th>
                                <th className={tableHeadCellClassName}>Queued notifications</th>
                                <th className={tableHeadCellClassName}>Active interventions</th>
                                <th className={tableHeadCellClassName}>Action</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-[var(--color-line)]">
                              {actionQueueGroups.map((group) => (
                                <tr key={group.grade}>
                                  <td className={cn(tableCellClassName, "whitespace-nowrap")}>Grade {group.grade}</td>
                                  <td className={tableCellClassName}>{group.studentCount}</td>
                                  <td className={tableCellClassName}>
                                    <StatusBadge tone={group.highestBandTone}>{group.highestBandLabel}</StatusBadge>
                                  </td>
                                  <td className={tableCellClassName}>{group.queuedNotifications}</td>
                                  <td className={tableCellClassName}>{group.activeInterventions}</td>
                                  <td className={tableCellClassName}>
                                    <Link
                                      href={{
                                        pathname: "/students",
                                        query: {
                                          grade: group.grade,
                                          sourceType: data.filters.sourceType,
                                          mode: "risk"
                                        }
                                      }}
                                      className="font-semibold text-[var(--color-primary)] transition hover:text-[var(--color-primary-strong)]"
                                    >
                                      Open in Students
                                    </Link>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </>
                  )}
                </Panel>
              </section>

              <Panel className="space-y-5">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--color-primary)]">
                      Analysis preview
                    </p>
                    <h2 className="mt-2 font-display text-2xl text-[var(--color-ink)]">School signal at a glance</h2>
                    <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--color-muted)]">
                      Lightweight prompts only. Use Analytics for the full grade, behavior, and trend breakdowns.
                    </p>
                  </div>
                  <Link href="/reports" className={buttonStyles({ variant: "secondary" })}>
                    Open analytics
                  </Link>
                </div>

                <div className="grid gap-4 md:grid-cols-3">
                  <SoftPanel className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-subtle)]">
                      Pressure by grade
                    </p>
                    {topPressureGrade ? (
                      <>
                        <p className="font-display text-3xl text-[var(--color-ink)]">Grade {topPressureGrade.grade}</p>
                        <p className="text-sm text-[var(--color-muted)]">
                          {topPressureGrade.escalatedCount} students at 10+ and {topPressureGrade.criticalCount} at 35+.
                        </p>
                      </>
                    ) : (
                      <p className="text-sm text-[var(--color-muted)]">No grade pressure signal yet.</p>
                    )}
                  </SoftPanel>
                  <SoftPanel className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-subtle)]">
                      Behavior hotspot
                    </p>
                    {topHotspot ? (
                      <>
                        <p className="font-semibold text-[var(--color-ink)]">{topHotspot.label}</p>
                        <p className="text-sm text-[var(--color-muted)]">
                          {topHotspot.incidentCount} incidents and {topHotspot.totalPoints} net points in the active slice.
                        </p>
                      </>
                    ) : (
                      <p className="text-sm text-[var(--color-muted)]">No behavior hotspot is visible in this slice.</p>
                    )}
                  </SoftPanel>
                  <SoftPanel className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-subtle)]">
                      Recent momentum
                    </p>
                    {recentTrendSummary ? (
                      <>
                        <p className="font-semibold text-[var(--color-ink)]">{recentTrendSummary.latest.period}</p>
                        <p className="text-sm text-[var(--color-muted)]">
                          {recentTrendSummary.latest.incidentCount} incidents and {recentTrendSummary.latest.totalPoints} points
                          {recentTrendSummary.delta === null
                            ? "."
                            : recentTrendSummary.delta === 0
                              ? ", flat versus the prior period."
                              : recentTrendSummary.delta > 0
                                ? `, up ${recentTrendSummary.delta} from the prior period.`
                                : `, down ${Math.abs(recentTrendSummary.delta)} from the prior period.`}
                        </p>
                      </>
                    ) : (
                      <p className="text-sm text-[var(--color-muted)]">No trend data is available yet.</p>
                    )}
                  </SoftPanel>
                </div>
              </Panel>

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
                    <Link href="/ingestion" className={buttonStyles({ variant: "secondary" })}>
                      Open intake
                    </Link>
                    <Link href="/reports/reconciliation" className={buttonStyles({ variant: "ghost" })}>
                      Reconcile
                    </Link>
                  </div>
                </div>

                {data.sycamore.error ? (
                  <InlineAlert tone="warning" title="Sycamore summary is unavailable.">
                    {data.sycamore.error}
                  </InlineAlert>
                ) : null}

                <div className="grid gap-3 md:grid-cols-3">
                  <SoftPanel className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-subtle)]">
                      Last successful sync
                    </p>
                    <p className="text-sm font-semibold text-[var(--color-ink)]">
                      {data.sycamore.lastSync?.completedAt
                        ? new Date(data.sycamore.lastSync.completedAt).toLocaleString()
                        : "No completed sync yet"}
                    </p>
                    <p className="text-sm text-[var(--color-muted)]">
                      {data.sycamore.lastSync
                        ? `${syncModeLabel(data.sycamore.lastSync.syncMode)} ${data.sycamore.lastSync.status}`
                        : "Open Intake to run or inspect background jobs."}
                    </p>
                  </SoftPanel>
                  <SoftPanel className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-subtle)]">
                      Latest sync window
                    </p>
                    <p className="text-sm font-semibold text-[var(--color-ink)]">
                      {data.sycamore.lastSync
                        ? `${data.sycamore.lastSync.windowStartDate ?? "Unknown"} to ${data.sycamore.lastSync.windowEndDate ?? "Unknown"}`
                        : "No sync window recorded"}
                    </p>
                    <p className="text-sm text-[var(--color-muted)]">
                      {data.sycamore.lastSync
                        ? `${data.sycamore.lastSync.recordsUpserted} rows stored in the latest run`
                        : "The dashboard has not yet received a Sycamore refresh."}
                    </p>
                  </SoftPanel>
                  <SoftPanel className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-subtle)]">
                      Current mirrored coverage
                    </p>
                    <p className="font-display text-3xl text-[var(--color-ink)]">{data.sycamore.totalLogs}</p>
                    <p className="text-sm text-[var(--color-muted)]">
                      {data.sycamore.linkedLogs} linked to local students for downstream workflows.
                    </p>
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
