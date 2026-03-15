"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { RefreshCcw, Server, ShieldAlert, Workflow } from "lucide-react";

import {
  Button,
  InlineAlert,
  PageHeader,
  Panel,
  StatCard,
  StatusBadge,
  tableCellClassName,
  tableClassName,
  tableHeadCellClassName,
  tableShellClassName
} from "@/components/ui";
import { cn } from "@/lib/cn";

interface DataOpsSnapshot {
  generatedAt: string;
  storage: {
    mode: "supabase" | "google_sheets" | "local_file";
    label: string;
    detail: string;
  };
  parser: {
    configured: boolean;
    ok: boolean | null;
    baseUrl: string | null;
    status?: number;
    error?: string;
  };
  ingestion: {
    totalJobs: number;
    failedJobs: number;
    reviewRequiredJobs: number;
    activeJobs: number;
    flaggedRows: number;
    lastCompletedAt: string | null;
    bySource: Record<
      string,
      {
        totalJobs: number;
        failedJobs: number;
        reviewRequiredJobs: number;
        activeJobs: number;
        flaggedRows: number;
        lastCompletedAt: string | null;
      }
    >;
  };
  sycamore: {
    configured: boolean;
    baseUrl: string;
    schoolId: string | null;
    pathTemplate: string;
    totalLogs: number;
    linkedLogs: number;
    totalSyncs: number;
    failedSyncs: number;
    lastCompletedAt: string | null;
    lastSuccessfulCompletedAt: string | null;
    lastFailedAt: string | null;
    lastWindow: {
      startDate: string;
      endDate: string;
    } | null;
    lastSuccessfulWindow: {
      startDate: string;
      endDate: string;
    } | null;
    lastRecordsDiscovered: number | null;
    lastRecordsUpserted: number | null;
    lastSyncMode: "initial_backfill" | "manual_range" | "incremental" | null;
    error?: string;
  };
  review: {
    open: number;
    approved: number;
    edited: number;
    rejected: number;
  };
  backlog: {
    queuedNotifications: number;
    overdueInterventions: number;
    activeInterventions: number;
  };
  recentFailures: Array<{
    id: string;
    kind: "parse_run" | "notification";
    label: string;
    createdAt: string;
  }>;
}

function sourceLabel(sourceType: string): string {
  return sourceType === "sycamore_api" ? "Sycamore sync" : sourceType === "manual_pdf" ? "Legacy PDF import" : sourceType;
}

export function DataOpsClient() {
  const [data, setData] = useState<DataOpsSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    const response = await fetch("/api/data-ops/status", { cache: "no-store" });
    const body = (await response.json().catch(() => null)) as DataOpsSnapshot | { error?: string } | null;
    if (!response.ok) {
      setError((body as { error?: string } | null)?.error || "Failed to load data operations status.");
      setIsLoading(false);
      return;
    }

    setData(body as DataOpsSnapshot);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const sycamoreNeedsAttention = Boolean(data?.sycamore.error);
  const systemsNeedAttention = sycamoreNeedsAttention;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Admin controls"
        title="Data operations and system health"
        description="Track dependency health, workflow backlog, and failure signals without turning this page into a second intake dashboard."
        actions={
          <Button type="button" variant="secondary" onClick={() => void loadStatus()} disabled={isLoading}>
            <RefreshCcw className={cn("h-4 w-4", isLoading ? "animate-spin" : "")} />
            {isLoading ? "Refreshing..." : "Refresh status"}
          </Button>
        }
      />

      {error ? (
        <InlineAlert tone="danger" title="Data operations status could not be loaded.">
          {error}
        </InlineAlert>
      ) : null}

      {data ? (
        <>
          <Panel className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-1">
              <h2 className="font-display text-2xl text-[var(--color-ink)]">
                {systemsNeedAttention ? "Systems need attention" : "Systems reachable"}
              </h2>
              <p className="text-sm text-[var(--color-muted)]">
                Snapshot from {new Date(data.generatedAt).toLocaleString()}.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <StatusBadge tone={data.sycamore.configured ? "success" : "warning"}>
                {data.sycamore.configured ? "Sycamore configured" : "Sycamore not configured"}
              </StatusBadge>
              <StatusBadge tone="info">{data.storage.label}</StatusBadge>
            </div>
          </Panel>

          <section className="grid gap-5 md:grid-cols-2 xl:grid-cols-5">
            <StatCard
              label="Failed syncs"
              value={data.sycamore.failedSyncs}
              description="Sycamore runs needing follow-up."
              icon={Workflow}
              href="/ingestion"
            />
            <StatCard
              label="Queued notifications"
              value={data.backlog.queuedNotifications}
              description="Waiting for dispatch."
              icon={Server}
              href="/notifications"
            />
            <StatCard
              label="Overdue interventions"
              value={data.backlog.overdueInterventions}
              description="Past due."
              icon={ShieldAlert}
              href="/students"
            />
            <StatCard
              label="Review-required imports"
              value={data.ingestion.reviewRequiredJobs}
              description="Legacy/manual jobs still needing attention."
              icon={Workflow}
              href="/ingestion"
            />
            <StatCard
              label="Recent failures"
              value={data.recentFailures.length}
              description="Surfaced across sync and notification workflows."
              icon={ShieldAlert}
              href="/audit"
            />
          </section>

          <section className="grid gap-5 xl:grid-cols-[1fr_1fr]">
            <Panel className="space-y-5">
              <div>
                <h2 className="font-display text-2xl text-[var(--color-ink)]">Dependencies</h2>
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                <Panel className="border-[var(--color-line)] bg-[var(--color-soft-surface)] p-4 shadow-none">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-[var(--color-ink)]">{data.storage.label}</p>
                      <p className="mt-2 text-sm leading-7 text-[var(--color-muted)]">{data.storage.detail}</p>
                    </div>
                    <StatusBadge tone="info">{data.storage.mode}</StatusBadge>
                  </div>
                </Panel>

                <Panel className="border-[var(--color-line)] bg-[var(--color-soft-surface)] p-4 shadow-none">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-[var(--color-ink)]">Parser health</p>
                      <p className="mt-2 text-sm leading-7 text-[var(--color-muted)]">
                        {data.parser.configured
                          ? data.parser.baseUrl ?? "Parser URL configured"
                          : "Parser is not configured in this environment."}
                      </p>
                      <p className="mt-2 text-sm leading-7 text-[var(--color-muted)]">
                        {data.parser.ok === null
                          ? "Health has not been checked."
                          : data.parser.ok
                            ? "Parser health probe succeeded."
                            : data.parser.error || `Health probe failed${data.parser.status ? ` with status ${data.parser.status}` : ""}.`}
                      </p>
                    </div>
                    <StatusBadge
                      tone={
                        !data.parser.configured ? "warning" : data.parser.ok === null ? "neutral" : data.parser.ok ? "success" : "danger"
                      }
                    >
                      {!data.parser.configured ? "not configured" : data.parser.ok === null ? "unknown" : data.parser.ok ? "healthy" : "failing"}
                    </StatusBadge>
                  </div>
                </Panel>

                <Panel className="border-[var(--color-line)] bg-[var(--color-soft-surface)] p-4 shadow-none">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-[var(--color-ink)]">Sycamore connection</p>
                      <p className="mt-2 text-sm leading-7 text-[var(--color-muted)]">{data.sycamore.baseUrl}</p>
                      <p className="mt-2 text-sm leading-7 text-[var(--color-muted)]">
                        {data.sycamore.schoolId ? `School ${data.sycamore.schoolId}` : "School ID not configured"}
                      </p>
                      <p className="mt-2 text-sm leading-7 text-[var(--color-muted)]">
                        Discipline path {data.sycamore.pathTemplate}
                      </p>
                      {data.sycamore.lastWindow ? (
                        <p className="mt-2 text-sm text-[var(--color-muted)]">
                          Last sync window {data.sycamore.lastWindow.startDate} to {data.sycamore.lastWindow.endDate}
                        </p>
                      ) : null}
                      {data.sycamore.error ? <p className="mt-2 text-sm text-[var(--color-danger)]">{data.sycamore.error}</p> : null}
                    </div>
                    <StatusBadge tone={data.sycamore.configured ? "success" : "warning"}>
                      {data.sycamore.configured ? "configured" : "not configured"}
                    </StatusBadge>
                  </div>
                </Panel>
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                <Panel className="border-[var(--color-line)] bg-[var(--color-soft-surface)] p-4 shadow-none">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-subtle)]">Last successful sync</p>
                  <p className="mt-2 text-sm font-semibold text-[var(--color-ink)]">
                    {data.sycamore.lastSuccessfulCompletedAt
                      ? new Date(data.sycamore.lastSuccessfulCompletedAt).toLocaleString()
                      : "No successful sync yet"}
                  </p>
                  <p className="mt-2 text-sm text-[var(--color-muted)]">
                    {data.sycamore.lastSuccessfulWindow
                      ? `Window ${data.sycamore.lastSuccessfulWindow.startDate} to ${data.sycamore.lastSuccessfulWindow.endDate}.`
                      : "No successful window recorded yet."}
                  </p>
                </Panel>
                <Panel className="border-[var(--color-line)] bg-[var(--color-soft-surface)] p-4 shadow-none">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-subtle)]">Active interventions</p>
                  <p className="mt-2 font-display text-3xl text-[var(--color-ink)]">{data.backlog.activeInterventions}</p>
                  <p className="mt-2 text-sm text-[var(--color-muted)]">Students currently carrying intervention work.</p>
                </Panel>
                <Panel className="border-[var(--color-line)] bg-[var(--color-soft-surface)] p-4 shadow-none">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-subtle)]">Legacy backlog</p>
                  <p className="mt-2 font-display text-3xl text-[var(--color-ink)]">{data.ingestion.flaggedRows}</p>
                  <p className="mt-2 text-sm text-[var(--color-muted)]">
                    Flagged rows across historical parse/import jobs that may still need cleanup.
                  </p>
                </Panel>
              </div>

              {Object.keys(data.ingestion.bySource).length > 0 ? (
                <div className="grid gap-4 md:grid-cols-2">
                  {Object.entries(data.ingestion.bySource).map(([key, summary]) => (
                    <Panel key={key} className="border-[var(--color-line)] bg-[var(--color-soft-surface)] p-4 shadow-none">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold text-[var(--color-ink)]">{sourceLabel(key)}</p>
                          <p className="mt-2 text-sm text-[var(--color-muted)]">
                            {summary.totalJobs} historical jobs recorded.
                          </p>
                        </div>
                        <StatusBadge tone={summary.failedJobs > 0 ? "warning" : "info"}>
                          {summary.failedJobs} failed
                        </StatusBadge>
                      </div>
                      <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        <div>
                          <p className="text-xs uppercase tracking-[0.16em] text-[var(--color-subtle)]">Review required</p>
                          <p className="mt-1 text-lg font-semibold text-[var(--color-ink)]">{summary.reviewRequiredJobs}</p>
                        </div>
                        <div>
                          <p className="text-xs uppercase tracking-[0.16em] text-[var(--color-subtle)]">Flagged rows</p>
                          <p className="mt-1 text-lg font-semibold text-[var(--color-ink)]">{summary.flaggedRows}</p>
                        </div>
                      </div>
                      {summary.lastCompletedAt ? (
                        <p className="mt-4 text-sm text-[var(--color-muted)]">
                          Last completed {new Date(summary.lastCompletedAt).toLocaleString()}
                        </p>
                      ) : null}
                    </Panel>
                  ))}
                </div>
              ) : null}
            </Panel>

            <Panel className="space-y-5">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--color-primary)]">Failures</p>
                  <h2 className="mt-2 font-display text-2xl text-[var(--color-ink)]">Recent workflow failures</h2>
                </div>
                <StatusBadge tone={data.recentFailures.length > 0 ? "warning" : "success"}>
                  {data.recentFailures.length} surfaced
                </StatusBadge>
              </div>

              {data.recentFailures.length === 0 ? (
                <Panel className="border-[var(--color-line)] bg-[var(--color-soft-surface)] p-4 shadow-none">
                  <p className="text-sm leading-7 text-[var(--color-muted)]">
                    No recent Sycamore sync issues or failed notifications are currently visible in this environment.
                  </p>
                </Panel>
              ) : (
                <div className={tableShellClassName}>
                  <div className="overflow-x-auto">
                    <table className={tableClassName}>
                      <thead>
                        <tr>
                          <th className={tableHeadCellClassName}>Time</th>
                          <th className={tableHeadCellClassName}>Kind</th>
                          <th className={tableHeadCellClassName}>Label</th>
                          <th className={tableHeadCellClassName}>Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--color-line)]">
                        {data.recentFailures.map((failure) => (
                          <tr key={failure.id}>
                            <td className={tableCellClassName}>{new Date(failure.createdAt).toLocaleString()}</td>
                            <td className={tableCellClassName}>
                              <StatusBadge tone={failure.kind === "parse_run" ? "danger" : "warning"}>
                                {failure.kind === "parse_run" ? "legacy import" : failure.kind.replace(/_/g, " ")}
                              </StatusBadge>
                            </td>
                            <td className={tableCellClassName}>{failure.label}</td>
                            <td className={tableCellClassName}>
                              <Link
                                href={
                                  failure.kind === "parse_run" ? "/ingestion" : "/notifications"
                                }
                                className="font-semibold text-[var(--color-primary)] hover:text-[var(--color-primary-strong)]"
                              >
                                Open
                              </Link>
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
        </>
      ) : null}
    </div>
  );
}
