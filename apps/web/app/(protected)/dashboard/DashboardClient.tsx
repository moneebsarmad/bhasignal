"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Activity, BellDot, Flag, RefreshCcw, ShieldCheck, Users } from "lucide-react";

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
    from: string;
    to: string;
    sourceType: string;
  };
  metrics: {
    totalStudents: number;
    incidentsInRange: number;
    countAtX: number;
    countAtX10: number;
    countAtX20: number;
    countAtX30: number;
    nearThresholdCount: number;
  };
  parseRunStatus: Record<string, number>;
  parseRunSourceCounts: Record<string, number>;
  incidentSourceCounts: Record<string, number>;
  interventionCounts: Record<string, number>;
  notificationCounts: Record<string, number>;
  topStudents: Array<{
    studentId: string;
    fullName: string;
    grade: string;
    totalPoints: number;
  }>;
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
    recentLogs: Array<{
      sycamoreLogId: string;
      studentId: string;
      studentRecordId: string | null;
      studentName: string | null;
      grade: string | null;
      incidentDate: string | null;
      points: number;
      level: number | null;
      violation: string | null;
      violationRaw: string | null;
      incidentType: string | null;
      resolution: string | null;
      consequence: string | null;
      authorName: string | null;
      syncedAt: string;
    }>;
  };
}

interface StatusSummaryRow {
  label: string;
  rawLabel: string;
  count: number;
}

function prettifyKey(value: string): string {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function badgeToneForKey(key: string): "neutral" | "info" | "success" | "warning" | "danger" {
  if (key === "success") {
    return "success";
  }
  if (key === "partial") {
    return "warning";
  }
  if (key === "running") {
    return "info";
  }
  if (key.includes("failed") || key.includes("dead")) {
    return "danger";
  }
  if (key.includes("queued") || key.includes("pending")) {
    return "warning";
  }
  if (key.includes("sent") || key.includes("complete") || key.includes("completed") || key.includes("approved")) {
    return "success";
  }
  if (key.includes("in_progress") || key.includes("open")) {
    return "info";
  }
  return "neutral";
}

function toRows(record: Record<string, number>): StatusSummaryRow[] {
  return Object.entries(record)
    .map(([rawLabel, count]) => ({ rawLabel, label: prettifyKey(rawLabel), count }))
    .sort((left, right) => right.count - left.count);
}

function sourceLabel(sourceType: string): string {
  return sourceType === "sycamore_api" ? "Sycamore API" : sourceType === "manual_pdf" ? "Fallback PDF" : "All sources";
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
      description: "Connect Sycamore to make SIS sync the primary intake path for dashboard and reporting."
    };
  }

  if (sycamore.error || sycamore.lastSync?.status === "failed") {
    return {
      label: "Needs attention",
      tone: "danger",
      description: "The primary discipline source needs intervention before its freshness can be trusted."
    };
  }

  if (sycamore.lastSync?.status === "partial") {
    return {
      label: "Warnings present",
      tone: "warning",
      description: "The latest primary-source sync completed with warnings that should be reviewed."
    };
  }

  if (sycamore.lastSync?.status === "running") {
    return {
      label: "Sync in progress",
      tone: "info",
      description: "Sycamore is actively refreshing the mirrored SIS dataset right now."
    };
  }

  if (sycamore.lastSync?.status === "success") {
    return {
      label: "Live",
      tone: "success",
      description: "Primary discipline source for dashboard and reporting."
    };
  }

  return {
    label: "Ready to sync",
    tone: "info",
    description: "Sycamore is configured and ready to become the active intake source for the next run."
  };
}

interface SycamoreSyncActionResponse {
  sycamoreSync?: {
    syncLogId: string;
    status: "running" | "success" | "partial" | "failed";
    syncMode: "initial_backfill" | "incremental" | "manual_range";
    window: {
      startDate: string;
      endDate: string;
    };
    recordsDiscovered: number;
    recordsUpserted: number;
    warnings: string[];
    startedAt: string;
    completedAt: string;
    triggeredBy: string;
  };
  error?: string;
}

export function DashboardClient({ canManageSycamore }: { canManageSycamore: boolean }) {
  const [grade, setGrade] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sourceType, setSourceType] = useState("");
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSyncingSycamore, setIsSyncingSycamore] = useState(false);
  const [sycamoreNotice, setSycamoreNotice] = useState<string | null>(null);
  const [sycamoreError, setSycamoreError] = useState<string | null>(null);

  const loadMetrics = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (grade.trim()) {
      params.set("grade", grade.trim());
    }
    if (from) {
      params.set("from", from);
    }
    if (to) {
      params.set("to", to);
    }
    if (sourceType) {
      params.set("sourceType", sourceType);
    }

    const response = await fetch(`/api/dashboard/metrics?${params.toString()}`, { cache: "no-store" });
    const body = (await response.json().catch(() => null)) as DashboardPayload | { error?: string } | null;
    if (!response.ok) {
      setError((body as { error?: string } | null)?.error || "Failed to load dashboard metrics.");
      setIsLoading(false);
      return;
    }

    setData(body as DashboardPayload);
    setIsLoading(false);
  }, [from, grade, sourceType, to]);

  useEffect(() => {
    void loadMetrics();
  }, [loadMetrics]);

  async function onRunSycamoreSync() {
    setIsSyncingSycamore(true);
    setSycamoreError(null);
    setSycamoreNotice(null);

    try {
      const response = await fetch("/api/sycamore/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ triggered_by: "manual" })
      });
      const body = (await response.json().catch(() => null)) as SycamoreSyncActionResponse | null;
      if (!response.ok) {
        setSycamoreError(body?.error || "Sycamore sync failed.");
        setIsSyncingSycamore(false);
        return;
      }

      const result = body?.sycamoreSync;
      if (result) {
        setSycamoreNotice(
          `${syncModeLabel(result.syncMode)} sync ${result.window.startDate} to ${result.window.endDate} stored ${result.recordsUpserted} records${result.status === "partial" ? " with warnings" : ""}.`
        );
      }
      await loadMetrics();
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
    void loadMetrics();
  }

  const parseRows = useMemo(() => (data ? toRows(data.parseRunStatus) : []), [data]);
  const parseSourceRows = useMemo(() => (data ? toRows(data.parseRunSourceCounts) : []), [data]);
  const incidentSourceRows = useMemo(() => (data ? toRows(data.incidentSourceCounts) : []), [data]);
  const interventionRows = useMemo(() => (data ? toRows(data.interventionCounts) : []), [data]);
  const notificationRows = useMemo(() => (data ? toRows(data.notificationCounts) : []), [data]);
  const sycamoreStatus = useMemo(() => (data ? sycamoreStatusSummary(data.sycamore) : null), [data]);
  const maxPipelineCount = Math.max(
    ...parseRows.map((row) => row.count),
    ...parseSourceRows.map((row) => row.count),
    ...incidentSourceRows.map((row) => row.count),
    ...interventionRows.map((row) => row.count),
    ...notificationRows.map((row) => row.count),
    1
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Source of Record"
        title="Keep the discipline signal current"
        description="Monitor Sycamore freshness, threshold pressure, and the student signal that needs action next from one clean operational surface."
        actions={
          <Button type="button" variant="secondary" onClick={() => void loadMetrics()} disabled={isLoading}>
            <RefreshCcw className={cn("h-4 w-4", isLoading ? "animate-spin" : "")} />
            {isLoading ? "Refreshing..." : "Refresh data"}
          </Button>
        }
      />

      <Panel className="space-y-5">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--color-primary)]">Filter frame</p>
            <h2 className="mt-2 font-display text-2xl text-[var(--color-ink)]">Scope the signal</h2>
          </div>
          <p className="max-w-xl text-sm leading-7 text-[var(--color-muted)]">
            Use grade, date, and source filters to focus the incident signal. Ingestion job counts honor source/date filters but do not apply grade filtering.
          </p>
        </div>

        <form onSubmit={onApplyFilters} className="grid gap-4 md:grid-cols-2 xl:grid-cols-[1fr_1fr_1fr_1fr_auto]">
          <Field label="Grade" hint="Leave blank for all grades.">
            <Input value={grade} onChange={(event) => setGrade(event.currentTarget.value)} placeholder="e.g. 8" />
          </Field>
          <Field label="From">
            <Input type="date" value={from} onChange={(event) => setFrom(event.currentTarget.value)} />
          </Field>
          <Field label="To">
            <Input type="date" value={to} onChange={(event) => setTo(event.currentTarget.value)} />
          </Field>
          <Field label="Source">
            <Select value={sourceType} onChange={(event) => setSourceType(event.currentTarget.value)}>
              <option value="">All sources</option>
              <option value="sycamore_api">Sycamore API</option>
              <option value="manual_pdf">Fallback PDF</option>
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

      {!data && isLoading ? (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div
              key={index}
              className="h-48 animate-pulse rounded-[1.75rem] border border-white/80 bg-white/80 shadow-card"
            />
          ))}
        </div>
      ) : null}

      {data ? (
        <>
          <div className="flex flex-wrap gap-3">
            {data.filters.grade ? <StatusBadge tone="neutral">Grade {data.filters.grade}</StatusBadge> : null}
            {data.filters.from ? <StatusBadge tone="neutral">From {data.filters.from}</StatusBadge> : null}
            {data.filters.to ? <StatusBadge tone="neutral">To {data.filters.to}</StatusBadge> : null}
            {data.filters.sourceType ? (
              <StatusBadge tone="neutral">{sourceLabel(data.filters.sourceType)}</StatusBadge>
            ) : null}
          </div>

          <section className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Students in scope"
              value={data.metrics.totalStudents}
              description="Students represented in the selected grade, date, and source slice."
              icon={Users}
            />
            <StatCard
              label="Incidents in range"
              value={data.metrics.incidentsInRange}
              description="Unified discipline events inside the selected reporting frame."
              icon={Activity}
            />
            <StatCard
              label="Near threshold"
              value={data.metrics.nearThresholdCount}
              description="Students approaching the next policy checkpoint."
              icon={Flag}
            />
            <StatCard
              label="At base threshold"
              value={data.metrics.countAtX}
              description="Students sitting exactly on the current base milestone."
              icon={ShieldCheck}
            />
          </section>

          <section className="space-y-5">
            <Panel className="overflow-hidden border-white/80 bg-[linear-gradient(135deg,rgba(17,94,89,0.10),rgba(255,255,255,0.98)_44%,rgba(173,124,44,0.08))]">
              <div className="space-y-6">
                <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
                  <div className="max-w-3xl space-y-4">
                    <div className="flex flex-wrap items-center gap-3">
                      {sycamoreStatus ? <StatusBadge tone={sycamoreStatus.tone}>{sycamoreStatus.label}</StatusBadge> : null}
                      <StatusBadge tone={data.sycamore.configured ? "success" : "warning"}>
                        {data.sycamore.configured ? "Primary source configured" : "Configuration required"}
                      </StatusBadge>
                      {data.sycamore.lastSync?.windowStartDate && data.sycamore.lastSync?.windowEndDate ? (
                        <StatusBadge tone="neutral">
                          {data.sycamore.lastSync.windowStartDate} to {data.sycamore.lastSync.windowEndDate}
                        </StatusBadge>
                      ) : null}
                    </div>

                    <div className="space-y-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--color-primary)]">
                        Primary source
                      </p>
                      <h2 className="font-display text-3xl text-[var(--color-ink)] sm:text-[2.6rem]">
                        Sycamore is driving live discipline intake
                      </h2>
                      <p className="max-w-2xl text-sm leading-7 text-[var(--color-muted)]">
                        {sycamoreStatus?.description} Normal daily intake should start here; PDF upload remains available
                        only for backfill and exception handling.
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
                      <Link href="/reports/reconciliation" className={buttonStyles({ variant: "secondary" })}>
                        Open reconciliation
                      </Link>
                      <Link href="/ingestion" className={buttonStyles({ variant: "ghost" })}>
                        Manage fallback imports
                      </Link>
                    </div>

                    {sycamoreError ? (
                      <InlineAlert tone="danger" title="Sycamore sync failed.">
                        {sycamoreError}
                      </InlineAlert>
                    ) : null}

                    {sycamoreNotice ? (
                      <InlineAlert tone="success" title="Sycamore sync finished.">
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
                        Read-only Sycamore discipline rows stored for dashboard and reporting.
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
                        Student links
                      </p>
                      <p className="font-display text-4xl text-[var(--color-ink)]">{data.sycamore.linkedLogs}</p>
                      <p className="text-sm leading-7 text-[var(--color-muted)]">
                        Mirrored rows matched to local students through <code>external_id</code>.
                      </p>
                    </SoftPanel>
                  </div>
                </div>

                {data.sycamore.lastSync ? (
                  <Panel className="border-white/70 bg-[rgba(255,255,255,0.72)] p-4 shadow-none">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="space-y-2">
                        <p className="font-semibold text-[var(--color-ink)]">Latest sync window</p>
                        <p className="text-sm text-[var(--color-muted)]">
                          {data.sycamore.lastSync.windowStartDate && data.sycamore.lastSync.windowEndDate
                            ? `${data.sycamore.lastSync.windowStartDate} to ${data.sycamore.lastSync.windowEndDate}`
                            : "Window unavailable"}
                        </p>
                        <p className="text-sm text-[var(--color-muted)]">
                          {data.sycamore.lastSync.completedAt
                            ? `Completed ${new Date(data.sycamore.lastSync.completedAt).toLocaleString()}`
                            : `Started ${new Date(data.sycamore.lastSync.startedAt).toLocaleString()}`}
                        </p>
                        <p className="text-sm text-[var(--color-muted)]">
                          Discovered {data.sycamore.lastSync.recordsDiscovered} rows and upserted{" "}
                          {data.sycamore.lastSync.recordsUpserted}. PDF imports remain a fallback path.
                        </p>
                      </div>
                      <StatusBadge tone={badgeToneForKey(data.sycamore.lastSync.status)}>
                        {data.sycamore.lastSync.status}
                      </StatusBadge>
                    </div>
                  </Panel>
                ) : null}
              </div>
            </Panel>

            <Panel className="space-y-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--color-primary)]">
                    Primary-source records
                  </p>
                  <h2 className="mt-2 font-display text-2xl text-[var(--color-ink)]">Latest Sycamore records</h2>
                  <p className="mt-2 max-w-2xl text-sm leading-7 text-[var(--color-muted)]">
                    Recent mirrored rows from the SIS feed that now power the cleanest view of discipline activity.
                  </p>
                </div>
                <StatusBadge tone="info">{data.sycamore.recentLogs.length} visible</StatusBadge>
              </div>

              {data.sycamore.recentLogs.length === 0 ? (
                <EmptyState
                  title="No Sycamore records yet"
                  description="Run the primary Sycamore sync to populate the mirrored SIS dataset."
                />
              ) : (
                <div className={tableShellClassName}>
                  <div className="overflow-x-auto">
                    <table className={tableClassName}>
                      <thead>
                        <tr>
                          <th className={tableHeadCellClassName}>Incident date</th>
                          <th className={tableHeadCellClassName}>Student</th>
                          <th className={tableHeadCellClassName}>Level</th>
                          <th className={tableHeadCellClassName}>Violation</th>
                          <th className={tableHeadCellClassName}>Logged by</th>
                          <th className={tableHeadCellClassName}>Resolution</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--color-line)]">
                        {data.sycamore.recentLogs.map((row) => (
                          <tr key={row.sycamoreLogId}>
                            <td className={tableCellClassName}>
                              <div className="space-y-1">
                                <p className="font-semibold text-[var(--color-ink)]">{row.incidentDate ?? "Unknown date"}</p>
                                <p className="text-xs uppercase tracking-[0.16em] text-[var(--color-subtle)]">
                                  Synced {new Date(row.syncedAt).toLocaleString()}
                                </p>
                              </div>
                            </td>
                            <td className={tableCellClassName}>
                              <div className="space-y-1">
                                <p className="font-semibold text-[var(--color-ink)]">{row.studentName ?? row.studentId}</p>
                                <p className="text-xs uppercase tracking-[0.16em] text-[var(--color-subtle)]">
                                  {row.grade ? `Grade ${row.grade}` : row.studentId}
                                </p>
                              </div>
                            </td>
                            <td className={tableCellClassName}>{row.level !== null ? `Level ${row.level}` : "Unleveled"}</td>
                            <td className={tableCellClassName}>{row.violation ?? row.incidentType ?? "Unknown"}</td>
                            <td className={tableCellClassName}>{row.authorName ?? "Not provided"}</td>
                            <td className={tableCellClassName}>{row.resolution ?? row.consequence ?? "Not provided"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </Panel>
          </section>

          {incidentSourceRows.length > 0 ? (
            <section className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              {incidentSourceRows.map((row) => (
                <SoftPanel key={row.rawLabel} className="space-y-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-subtle)]">Incident source</p>
                  <p className="font-display text-3xl text-[var(--color-ink)]">{row.count}</p>
                  <p className="text-sm leading-7 text-[var(--color-muted)]">
                    {sourceLabel(row.rawLabel)} incidents inside the current frame.
                  </p>
                </SoftPanel>
              ))}
            </section>
          ) : null}

          <section className="grid gap-5 md:grid-cols-3">
            <SoftPanel className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-subtle)]">Escalation</p>
              <p className="font-display text-3xl text-[var(--color-ink)]">{data.metrics.countAtX10}</p>
              <p className="text-sm leading-7 text-[var(--color-muted)]">Students who have moved to the X+10 milestone.</p>
            </SoftPanel>
            <SoftPanel className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-subtle)]">High concern</p>
              <p className="font-display text-3xl text-[var(--color-ink)]">{data.metrics.countAtX20}</p>
              <p className="text-sm leading-7 text-[var(--color-muted)]">Students at X+20 who likely need close intervention follow-up.</p>
            </SoftPanel>
            <SoftPanel className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-subtle)]">Critical concentration</p>
              <p className="font-display text-3xl text-[var(--color-ink)]">{data.metrics.countAtX30}</p>
              <p className="text-sm leading-7 text-[var(--color-muted)]">Students already beyond X+30 in the current selected frame.</p>
            </SoftPanel>
          </section>

          <section className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
            <Panel className="space-y-5">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--color-primary)]">Action list</p>
                  <h2 className="mt-2 font-display text-2xl text-[var(--color-ink)]">Students requiring the most attention</h2>
                </div>
                <StatusBadge tone="warning">{data.topStudents.length} students surfaced</StatusBadge>
              </div>

              {data.topStudents.length === 0 ? (
                <EmptyState
                  title="No students in scope"
                  description="The current filters did not return any students with surfaced point totals."
                />
              ) : (
                <div className={tableShellClassName}>
                  <div className="overflow-x-auto">
                    <table className={tableClassName}>
                      <thead>
                        <tr>
                          <th className={tableHeadCellClassName}>Student</th>
                          <th className={tableHeadCellClassName}>Grade</th>
                          <th className={tableHeadCellClassName}>Total points</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--color-line)]">
                        {data.topStudents.map((row) => (
                          <tr key={row.studentId}>
                            <td className={tableCellClassName}>
                              <div className="space-y-1">
                                <p className="font-semibold text-[var(--color-ink)]">{row.fullName}</p>
                                <p className="text-xs uppercase tracking-[0.16em] text-[var(--color-subtle)]">
                                  {row.studentId}
                                </p>
                              </div>
                            </td>
                            <td className={tableCellClassName}>{row.grade}</td>
                            <td className={tableCellClassName}>
                              <span className="font-semibold text-[var(--color-ink)]">{row.totalPoints}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </Panel>

            <Panel className="space-y-6">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--color-primary)]">Pipeline</p>
                  <h2 className="mt-2 font-display text-2xl text-[var(--color-ink)]">Operational posture</h2>
                </div>
                <StatusBadge tone="info">Live counts</StatusBadge>
              </div>

              {[
                { title: "Parse runs", rows: parseRows, icon: Activity },
                { title: "Job sources", rows: parseSourceRows, icon: Activity },
                { title: "Interventions", rows: interventionRows, icon: ShieldCheck },
                { title: "Notifications", rows: notificationRows, icon: BellDot }
              ].map((group) => {
                const Icon = group.icon;
                return (
                  <div key={group.title} className="space-y-3">
                    <div className="flex items-center gap-3">
                      <div className="rounded-2xl bg-[var(--color-primary-soft)] p-2 text-[var(--color-primary)]">
                        <Icon className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="font-semibold text-[var(--color-ink)]">{group.title}</p>
                        <p className="text-xs uppercase tracking-[0.16em] text-[var(--color-subtle)]">
                          Status distribution
                        </p>
                      </div>
                    </div>
                    <div className="space-y-3">
                      {group.rows.length === 0 ? (
                        <p className="text-sm text-[var(--color-muted)]">No counts available yet.</p>
                      ) : (
                        group.rows.map((row) => (
                          <div key={`${group.title}-${row.label}`} className="space-y-2">
                            <div className="flex items-center justify-between gap-3">
                              <StatusBadge tone={badgeToneForKey(row.rawLabel)}>{row.label}</StatusBadge>
                              <span className="text-sm font-semibold text-[var(--color-ink)]">{row.count}</span>
                            </div>
                            <div className="h-2 rounded-full bg-[var(--color-soft-surface)]">
                              <div
                                className="h-2 rounded-full bg-[linear-gradient(90deg,var(--color-primary),rgba(17,94,89,0.45))]"
                                style={{ width: `${Math.max((row.count / maxPipelineCount) * 100, row.count > 0 ? 8 : 0)}%` }}
                              />
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                );
              })}
            </Panel>
          </section>
        </>
      ) : null}
    </div>
  );
}
