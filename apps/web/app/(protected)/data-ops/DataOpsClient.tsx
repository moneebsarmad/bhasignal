"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Database, RefreshCcw, Server, ShieldAlert, Workflow } from "lucide-react";

import {
  Button,
  InlineAlert,
  InsightPanel,
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
    ok: boolean;
    baseUrl: string;
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
  return sourceType === "sycamore_api" ? "Sycamore API" : sourceType === "manual_pdf" ? "Manual PDF" : sourceType;
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

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Admin controls"
        title="Data operations and system health"
        description="Monitor storage mode, parser reachability, workflow backlog, and recent operational failures without dropping into backend implementation details."
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
          <InsightPanel
            eyebrow="System posture"
            title={data.parser.ok ? "Operational surfaces are reachable" : "One or more system surfaces need attention"}
            description={
              data.parser.ok
                ? `Parser connectivity is healthy, storage is running in ${data.storage.label.toLowerCase()} mode, and the latest snapshot was captured at ${new Date(data.generatedAt).toLocaleString()}.`
                : `Parser connectivity is degraded. Storage remains in ${data.storage.label.toLowerCase()} mode, but ingestion reliability should be treated as at risk until the parser is restored.`
            }
          >
            <div className="flex flex-wrap gap-3">
              <StatusBadge tone={data.parser.ok ? "success" : "danger"}>
                Parser {data.parser.ok ? "online" : "offline"}
              </StatusBadge>
              <StatusBadge tone="info">{data.storage.label}</StatusBadge>
            </div>
          </InsightPanel>

          <section className="grid gap-5 md:grid-cols-2 xl:grid-cols-5">
            <StatCard
              label="Active jobs"
              value={data.ingestion.activeJobs}
              description="Parse runs currently pending or processing."
              icon={Workflow}
              href="/ingestion"
            />
            <StatCard
              label="Open review tasks"
              value={data.review.open}
              description="Queue items waiting on a human decision."
              icon={ShieldAlert}
              href="/review?status=open"
            />
            <StatCard
              label="Queued notifications"
              value={data.backlog.queuedNotifications}
              description="Messages waiting for dispatch."
              icon={Server}
              href="/notifications"
            />
            <StatCard
              label="Overdue interventions"
              value={data.backlog.overdueInterventions}
              description="Interventions already past due."
              icon={ShieldAlert}
              href="/students"
            />
            <StatCard
              label="Failed parse runs"
              value={data.ingestion.failedJobs}
              description="Jobs that need retry or parser investigation."
              icon={Database}
              href="/ingestion"
            />
          </section>

          <section className="grid gap-5 xl:grid-cols-[1fr_1fr]">
            <Panel className="space-y-5">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--color-primary)]">Dependencies</p>
                <h2 className="mt-2 font-display text-2xl text-[var(--color-ink)]">Storage and parser</h2>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
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
                      <p className="font-semibold text-[var(--color-ink)]">Parser service</p>
                      <p className="mt-2 text-sm leading-7 text-[var(--color-muted)]">{data.parser.baseUrl}</p>
                      {data.parser.error ? <p className="mt-2 text-sm text-[var(--color-danger)]">{data.parser.error}</p> : null}
                    </div>
                    <StatusBadge tone={data.parser.ok ? "success" : "danger"}>
                      {data.parser.ok ? "healthy" : "degraded"}
                    </StatusBadge>
                  </div>
                </Panel>

                <Panel className="border-[var(--color-line)] bg-[var(--color-soft-surface)] p-4 shadow-none">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-[var(--color-ink)]">Sycamore sync</p>
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
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-subtle)]">Review backlog</p>
                  <p className="mt-2 font-display text-3xl text-[var(--color-ink)]">{data.review.open}</p>
                  <p className="mt-2 text-sm text-[var(--color-muted)]">Tasks still open in the review queue.</p>
                </Panel>
                <Panel className="border-[var(--color-line)] bg-[var(--color-soft-surface)] p-4 shadow-none">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-subtle)]">Flagged rows</p>
                  <p className="mt-2 font-display text-3xl text-[var(--color-ink)]">{data.ingestion.flaggedRows}</p>
                  <p className="mt-2 text-sm text-[var(--color-muted)]">Rows surfaced for manual confirmation so far.</p>
                </Panel>
                <Panel className="border-[var(--color-line)] bg-[var(--color-soft-surface)] p-4 shadow-none">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-subtle)]">Last completed job</p>
                  <p className="mt-2 text-sm font-semibold text-[var(--color-ink)]">
                    {data.ingestion.lastCompletedAt ? new Date(data.ingestion.lastCompletedAt).toLocaleString() : "No completed jobs yet"}
                  </p>
                </Panel>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                {Object.entries(data.ingestion.bySource).map(([key, summary]) => (
                  <Panel key={key} className="border-[var(--color-line)] bg-[var(--color-soft-surface)] p-4 shadow-none">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-[var(--color-ink)]">{sourceLabel(key)}</p>
                        <p className="mt-2 text-sm text-[var(--color-muted)]">{summary.totalJobs} jobs recorded.</p>
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

              {data.sycamore.configured ? (
                <Panel className="border-[var(--color-line)] bg-[var(--color-soft-surface)] p-4 shadow-none">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-[var(--color-ink)]">Sycamore sync posture</p>
                      <p className="mt-2 text-sm leading-7 text-[var(--color-muted)]">
                        {data.sycamore.totalSyncs} direct sync runs recorded, {data.sycamore.failedSyncs} failed.
                      </p>
                      <p className="mt-2 text-sm text-[var(--color-muted)]">
                        Dataset holds {data.sycamore.totalLogs} logs, with {data.sycamore.linkedLogs} linked to local students.
                      </p>
                      <p className="mt-2 text-sm text-[var(--color-muted)]">
                        Default sync mode {data.sycamore.lastSyncMode === "initial_backfill" ? "initial backfill" : data.sycamore.lastSyncMode === "incremental" ? "incremental" : data.sycamore.lastSyncMode === "manual_range" ? "manual range" : "not run yet"}.
                      </p>
                      {data.sycamore.lastRecordsDiscovered !== null ? (
                        <p className="mt-2 text-sm text-[var(--color-muted)]">
                          Last sync discovered {data.sycamore.lastRecordsDiscovered} rows and upserted {data.sycamore.lastRecordsUpserted ?? 0}.
                        </p>
                      ) : null}
                      {data.sycamore.lastSuccessfulWindow ? (
                        <p className="mt-2 text-sm text-[var(--color-muted)]">
                          Last successful window {data.sycamore.lastSuccessfulWindow.startDate} to {data.sycamore.lastSuccessfulWindow.endDate}
                        </p>
                      ) : null}
                      {data.sycamore.lastSuccessfulCompletedAt ? (
                        <p className="mt-2 text-sm text-[var(--color-muted)]">
                          Last successful sync {new Date(data.sycamore.lastSuccessfulCompletedAt).toLocaleString()}
                        </p>
                      ) : null}
                      {data.sycamore.lastFailedAt ? (
                        <p className="mt-2 text-sm text-[var(--color-muted)]">
                          Last failed sync {new Date(data.sycamore.lastFailedAt).toLocaleString()}
                        </p>
                      ) : null}
                    </div>
                    <StatusBadge tone={data.sycamore.failedSyncs > 0 ? "warning" : "success"}>
                      {data.sycamore.failedSyncs > 0 ? "needs attention" : "stable"}
                    </StatusBadge>
                  </div>
                </Panel>
              ) : null}
            </Panel>

            <Panel className="space-y-5">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--color-primary)]">Failures</p>
                  <h2 className="mt-2 font-display text-2xl text-[var(--color-ink)]">Recent operational failures</h2>
                </div>
                <StatusBadge tone={data.recentFailures.length > 0 ? "warning" : "success"}>
                  {data.recentFailures.length} surfaced
                </StatusBadge>
              </div>

              {data.recentFailures.length === 0 ? (
                <Panel className="border-[var(--color-line)] bg-[var(--color-soft-surface)] p-4 shadow-none">
                  <p className="text-sm leading-7 text-[var(--color-muted)]">
                    No recent failed parse runs or failed notifications are currently visible in this environment.
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
                                {failure.kind.replace(/_/g, " ")}
                              </StatusBadge>
                            </td>
                            <td className={tableCellClassName}>{failure.label}</td>
                            <td className={tableCellClassName}>
                              <Link
                                href={
                                  failure.kind === "parse_run"
                                    ? `/review?status=all&parseRunId=${encodeURIComponent(failure.id)}`
                                    : "/notifications"
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
